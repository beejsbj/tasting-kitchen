import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chefTextFindings, publicTextFindings, RANKING_LANGUAGE } from "./public-text.mjs";

export { chefTextFindings, publicTextFindings, RANKING_LANGUAGE };

export function assertRelativePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty portable relative path: ${String(value)}`);
  }
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} contains an unsafe segment: ${value}`);
  }
  return value;
}

export function within(root, relative, label = "path") {
  assertRelativePath(relative, label);
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...relative.split("/"));
  if (resolved === base || !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`${label} escapes its root: ${relative}`);
  }
  return resolved;
}

export async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmodBestEffort(directory, 0o700);
  const agents = path.join(directory, "AGENTS.md");
  try {
    await stat(agents);
    throw new Error(`Dedicated Codex home must not contain AGENTS.md: ${agents}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function chmodBestEffort(target, mode) {
  const { chmod } = await import("node:fs/promises");
  try {
    await chmod(target, mode);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

export async function copyTree(source, destination) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${source}`);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const names = (await readdir(source)).sort();
    for (const name of names) await copyTree(path.join(source, name), path.join(destination, name));
    return;
  }
  if (!info.isFile()) throw new Error(`Only regular files and directories are allowed: ${source}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source), { flag: "wx" });
}

export async function walkFiles(root, relative = "") {
  const directory = relative ? within(root, relative) : root;
  const names = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of names) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in artifacts: ${child}`);
    if (entry.isDirectory()) files.push(...await walkFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Unsupported artifact entry: ${child}`);
  }
  return files;
}

function globRegex(glob) {
  assertRelativePath(glob.replace(/\*+/g, "x"), "include glob");
  let expression = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        expression += ".*";
      } else expression += "[^/]*";
    } else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`);
}

export function matchesAny(relative, includes) {
  return includes.some((glob) => globRegex(glob).test(relative));
}

/** The model's output broke the Recipe's contract: no entry, too many files or too many bytes. Any other selection error is Kitchen's (a symlink, a filesystem failure). */
export class ArtifactContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactContractError";
  }
}

/**
 * Walk only the top-level entries an include glob could reach. Equipment a
 * Run uses but never delivers (a mounted engine with node_modules symlinks)
 * is not walked; anything an include could select is still strict.
 */
async function walkDeliverable(workspace, includes) {
  const tops = new Set(includes.map((glob) => glob.split("/")[0]));
  if ([...tops].some((top) => top.includes("*"))) return walkFiles(workspace);
  const names = (await readdir(workspace, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of names) {
    if (!tops.has(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in artifacts: ${entry.name}`);
    if (entry.isDirectory()) files.push(...await walkFiles(workspace, entry.name));
    else if (entry.isFile()) files.push(entry.name);
    else throw new Error(`Unsupported artifact entry: ${entry.name}`);
  }
  return files;
}

export async function selectArtifactFiles(workspace, output) {
  const all = await walkDeliverable(workspace, output.include);
  const files = all.filter((relative) => matchesAny(relative, output.include)).sort();
  if (!files.includes(output.entry)) throw new ArtifactContractError(`Artifact entry is missing or excluded: ${output.entry}`);
  if (files.length > output.limits.maxFiles) {
    throw new ArtifactContractError(`Artifact has ${files.length} files; limit is ${output.limits.maxFiles}`);
  }
  const metadata = [];
  let totalBytes = 0;
  for (const relative of files) {
    const bytes = (await stat(within(workspace, relative))).size;
    totalBytes += bytes;
    metadata.push({ path: relative, bytes });
  }
  if (totalBytes > output.limits.maxBytes) {
    throw new ArtifactContractError(`Artifact has ${totalBytes} bytes; limit is ${output.limits.maxBytes}`);
  }
  return { files, totalBytes, metadata };
}

export async function copySelectedFiles(workspace, destination, selection) {
  for (const relative of selection.files) {
    await copyTree(within(workspace, relative), within(destination, relative));
  }
}

export async function describeTree(root) {
  const paths = await walkFiles(root);
  const files = [];
  for (const relative of paths) {
    const contents = await readFile(within(root, relative));
    files.push({ path: relative, sha256: createHash("sha256").update(contents).digest("hex"), bytes: contents.byteLength });
  }
  const treeHash = `sha256:${createHash("sha256").update(JSON.stringify(files)).digest("hex")}`;
  return { files, treeHash };
}

const PUBLIC_TEXT_EXTENSIONS = new Set([
  ".css", ".csv", ".html", ".htm", ".js", ".json", ".jsx", ".md", ".mjs", ".svg", ".text", ".txt", ".ts", ".tsx", ".xml", ".yaml", ".yml", ".strudel",
]);

function assertNoFindings(findings, label) {
  if (findings.length) throw new Error(`Public artifact scan failed: ${findings.map((reason) => `${label} (${reason})`).join(", ")}`);
}

/** `chefAuthored` marks text the model wrote (see chefTextFindings); everything else gets every rule. */
export function assertPublicTextSafe(text, label = "public text", { chefAuthored = false } = {}) {
  assertNoFindings(chefAuthored === true ? chefTextFindings(text) : publicTextFindings(text), label);
  return text;
}

/** Every key and string value in parsed JSON, depth first. */
function jsonStrings(value) {
  const strings = [];
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === "string") strings.push(item);
    else if (Array.isArray(item)) stack.push(...item);
    else if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) stack.push(key, child);
  }
  return strings;
}

/**
 * `finder` over JSON text read two ways: raw, and each decoded key and string
 * value. In raw JSON a newline in a string is the two characters `\n`, so a
 * token that starts a line reads as `n<token>` and a `\b` rule misses it; an
 * escaped `\/` hides a slash. Each reason is reported once. Text that does not
 * parse is read raw only.
 */
function jsonFindings(text, finder) {
  const findings = new Set(finder(text));
  let value;
  try { value = JSON.parse(text); }
  catch { return [...findings]; }
  for (const string of jsonStrings(value)) for (const reason of finder(string)) findings.add(reason);
  return [...findings];
}

/** publicTextFindings for JSON text, raw and decoded (see jsonFindings). */
export function publicJsonFindings(text) {
  return jsonFindings(text, publicTextFindings);
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Findings for Kitchen's JSON that carries fields the model chose. Every leak
 * rule covers the whole text, raw and decoded. The ranking-language rule skips
 * only the text fields `withoutChefFields` clears. Text that is not the
 * expected shape (`withoutChefFields` returns null) gets every rule.
 */
function chefFieldFindings(text, withoutChefFields) {
  let value;
  try { value = JSON.parse(text); }
  catch { return publicTextFindings(text); }
  const kitchen = withoutChefFields(value);
  if (kitchen === null) return publicJsonFindings(text);
  const findings = jsonFindings(text, chefTextFindings);
  if (publicJsonFindings(JSON.stringify(kitchen)).includes(RANKING_LANGUAGE)) findings.push(RANKING_LANGUAGE);
  return findings;
}

/** An entry whose text `path` is a name the model chose, with that name cleared. */
function withoutChefPath(entry) {
  return isRecord(entry) && typeof entry.path === "string" ? { ...entry, path: null } : entry;
}

/** A trace without what the model wrote or named: each turn's text `response` and each action's `path`. */
function traceWithoutChefFields(trace) {
  if (!isRecord(trace) || !Array.isArray(trace.turns)) return null;
  return {
    ...trace,
    turns: trace.turns.map((turn) => {
      if (!isRecord(turn)) return turn;
      const kitchen = { ...turn };
      if (typeof turn.response === "string") kitchen.response = null;
      if (Array.isArray(turn.actions)) kitchen.actions = turn.actions.map(withoutChefPath);
      return kitchen;
    }),
  };
}

/** A manifest without the names of the files the model delivered (`artifact.files[].path`). */
function manifestWithoutChefFields(manifest) {
  if (!isRecord(manifest) || !isRecord(manifest.artifact) || !Array.isArray(manifest.artifact.files)) return null;
  return { ...manifest, artifact: { ...manifest.artifact, files: manifest.artifact.files.map(withoutChefPath) } };
}

/**
 * Findings for a public trace: Kitchen's record of the prompts it sent, the
 * responses the model gave and the workspace files its tools touched. Every
 * leak rule covers the whole text. The ranking-language rule skips only what
 * the model wrote or named: each turn's `response` and each action's `path`
 * (a model may name a file `score.md`). Prompts, ids and the rest of each
 * action are Kitchen's and the Recipe's. Anything not trace-shaped gets every rule.
 */
export function publicTraceFindings(text) {
  return chefFieldFindings(text, traceWithoutChefFields);
}

/**
 * Findings for a plate's manifest (`dish.json`, `no-dish.json`). It is
 * Kitchen's text, but `artifact.files[].path` lists names the model chose for
 * its files, so the ranking-language rule skips those names and nothing else;
 * the entry is the Recipe's. Every leak rule covers the whole text.
 */
export function publicManifestFindings(text) {
  return chefFieldFindings(text, manifestWithoutChefFields);
}

/** assertPublicTextSafe for a JSON value about to be written: its text raw and decoded, every rule (see jsonFindings). */
export function assertPublicJsonSafe(value, label = "public JSON") {
  assertNoFindings(publicJsonFindings(JSON.stringify(value)), label);
  return value;
}

/** assertPublicTextSafe for a trace object about to be written (see publicTraceFindings). */
export function assertPublicTraceSafe(trace, label = "public trace") {
  assertNoFindings(publicTraceFindings(JSON.stringify(trace)), label);
  return trace;
}

/** assertPublicTextSafe for a manifest, or the part of one, about to be written (see publicManifestFindings). */
export function assertPublicManifestSafe(manifest, label = "public manifest") {
  assertNoFindings(publicManifestFindings(JSON.stringify(manifest)), label);
  return manifest;
}

const HOST_LOCATION_SEGMENT = /(?:^|[\\/])(?:home|Users|root|private|mnt[\\/]server-ssd)(?:[\\/]|$)/u;

async function maskSafeInternalParentPaths(text, root, relative) {
  const base = path.resolve(root);
  let masked = text;
  const quotedParentPath = /(["'`])((?:\.\.\/)+[^"'`\s<>)]*)\1/g;
  for (const match of text.matchAll(quotedParentPath)) {
    const pathname = match[2].split(/[?#]/u, 1)[0];
    const resolved = path.resolve(base, path.dirname(relative), pathname);
    if (!resolved.startsWith(`${base}${path.sep}`)) continue;
    // Masking turns `..` into `__`, which would also hide a host location spelled
    // after the climb (../../mnt/server-ssd/..., ../../root/...) from the host-path
    // rules. A parent path naming one stays unmasked, so the traversal rule blocks it.
    if (HOST_LOCATION_SEGMENT.test(pathname)) continue;
    // A module specifier may name equipment the delivery deliberately omits
    // (a lyric scene's ../engine/scene); it stays inside the artifact, so it
    // reveals nothing about the machine. Other parent paths must name a shipped file.
    const moduleSpecifier = /(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*$/u.test(text.slice(Math.max(0, match.index - 24), match.index));
    if (!moduleSpecifier) {
      try {
        if (!(await stat(resolved)).isFile()) continue;
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
    }
    const start = match.index + 1;
    const replacement = match[2].replaceAll("..", "__");
    masked = `${masked.slice(0, start)}${replacement}${masked.slice(start + match[2].length)}`;
  }
  return masked;
}

// Path shapes that verbatim upstream source legitimately contains: relative
// imports, app routes such as `/style-guide/components/`, and regex literals
// such as `/I:\s+(-?[\d.]+) LUFS/` that look like Windows paths.
const VERBATIM_PATH_SHAPES = new Set(["absolute path", "absolute Windows path", "path traversal"]);

/**
 * Verbatim inputs carry any fixture extension (.vue, .log, none), so text is
 * recognised by content: NUL-free, valid UTF-8. Anything else is binary.
 */
function verbatimText(bytes) {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return null; }
}

function verbatimTextFindings(text) {
  return publicTextFindings(text).filter((reason) => !VERBATIM_PATH_SHAPES.has(reason));
}

/** Findings for bytes published verbatim under a Dish's inputs/; [] for binary bytes. `json` also reads decoded strings (see jsonFindings). */
export function verbatimInputFindings(bytes, { json = false } = {}) {
  const text = verbatimText(bytes);
  if (text === null) return [];
  return json ? jsonFindings(text, verbatimTextFindings) : verbatimTextFindings(text);
}

/**
 * `verbatim` names top-level entries holding catalog fixtures byte-for-byte (a
 * Dish's `inputs/` sidecar). They record what the model received, so only the
 * path-shape rules are relaxed there; every leak rule (home paths, file URLs,
 * credentials, private identifiers) still applies.
 *
 * `chefAuthored` names top-level entries holding the files the model delivered
 * (`artifact/`), or is `true` when the whole tree is one; `trace` names the
 * public trace file. Only the ranking-language rule is relaxed for them, and in
 * the trace only for the model's responses and the file names its actions
 * touched. `manifests` names the plate's manifest files, where only the
 * delivered files' names are relaxed. Everything else in the tree is
 * Kitchen's or the owner's text and gets every rule. A `.json` file is read raw
 * and as its decoded keys and string values, under the same rules.
 */
export async function scanPublicTree(root, { verbatim = [], chefAuthored = [], trace = null, manifests = [] } = {}) {
  // A string here would turn `includes` into a substring test and relax entries nobody named.
  if (!Array.isArray(verbatim) || !Array.isArray(manifests) || (chefAuthored !== true && !Array.isArray(chefAuthored))) throw new TypeError("scanPublicTree takes its entries as arrays");
  const findings = [];
  const files = await walkFiles(root);
  for (const relative of files) {
    const json = path.extname(relative).toLowerCase() === ".json";
    if (verbatim.includes(relative.split("/")[0])) {
      for (const reason of verbatimInputFindings(await readFile(within(root, relative)), { json })) findings.push({ path: relative, reason });
      continue;
    }
    if (!PUBLIC_TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
    const text = await readFile(within(root, relative), "utf8");
    // Masking only rewrites `..` to `__` inside a quoted path, so masked JSON still parses.
    const scanText = await maskSafeInternalParentPaths(text, root, relative);
    const read = (finder) => json ? jsonFindings(scanText, finder) : finder(scanText);
    const reasons = chefAuthored === true || chefAuthored.includes(relative.split("/")[0]) ? read(chefTextFindings)
      : relative === trace ? publicTraceFindings(scanText)
        : manifests.includes(relative) ? publicManifestFindings(scanText)
          : read(publicTextFindings);
    for (const reason of reasons) findings.push({ path: relative, reason });
  }
  if (findings.length) {
    throw new Error(`Public artifact scan failed: ${findings.map((item) => `${item.path} (${item.reason})`).join(", ")}`);
  }
  return { passed: true, filesScanned: files.length };
}

export async function scanWebArtifactNetwork(root) {
  const runtimeExtensions = new Set([".css", ".html", ".htm", ".js", ".jsx", ".mjs", ".svg", ".ts", ".tsx"]);
  const findings = [];
  for (const relative of await walkFiles(root)) {
    const extension = path.extname(relative).toLowerCase();
    if (!runtimeExtensions.has(extension)) continue;
    const text = await readFile(within(root, relative), "utf8");
    const patterns = extension === ".css"
      ? [/(?:@import\s+(?:url\()?\s*|url\()\s*["']?((?:https?:)?\/\/[^\s"')]+)/i]
      : [
          /\b(?:src|href|action|poster)\s*=\s*["']\s*((?:https?:)?\/\/[^\s"'<>]+)/i,
          /\b(?:fetch|WebSocket|EventSource|import|require)\s*\(\s*["']\s*((?:https?:)?\/\/[^\s"')]+)/i,
          /\bimport\s+[^;]*?\sfrom\s*["']\s*((?:https?:)?\/\/[^\s"']+)/i,
        ];
    const match = patterns.map((pattern) => text.match(pattern)).find(Boolean);
    if (match) findings.push({ path: relative, url: match[1] ?? match[0] });
  }
  if (findings.length) {
    throw new Error(`Web artifact has remote runtime references: ${findings.map((item) => `${item.path} (${item.url})`).join(", ")}`);
  }
  return { passed: true };
}

export async function writeJsonAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
