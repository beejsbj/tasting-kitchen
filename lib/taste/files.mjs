import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

export async function selectArtifactFiles(workspace, output) {
  const all = await walkFiles(workspace);
  const files = all.filter((relative) => matchesAny(relative, output.include)).sort();
  if (!files.includes(output.entry)) throw new Error(`Artifact entry is missing or excluded: ${output.entry}`);
  if (files.length > output.limits.maxFiles) {
    throw new Error(`Artifact has ${files.length} files; limit is ${output.limits.maxFiles}`);
  }
  const metadata = [];
  let totalBytes = 0;
  for (const relative of files) {
    const bytes = (await stat(within(workspace, relative))).size;
    totalBytes += bytes;
    metadata.push({ path: relative, bytes });
  }
  if (totalBytes > output.limits.maxBytes) {
    throw new Error(`Artifact has ${totalBytes} bytes; limit is ${output.limits.maxBytes}`);
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

const FORBIDDEN_PUBLIC_PATTERNS = [
  [/\/(?:home|Users)\/[A-Za-z0-9._-]+\//g, "absolute home path"],
  [/(?<![A-Za-z0-9])[A-Za-z]:[\\/](?:[^\s"'<>]+[\\/])+[^\s"'<>]*/g, "absolute Windows path"],
  [/(?<![:/A-Za-z0-9._-])\/(?!\/)(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g, "absolute path"],
  [/file:\/\//gi, "file URL"],
  [/(?:^|[\s("'`])(?:~\/|\$HOME(?:\/|\b)|\$\{HOME\}(?:\/|\b)|%USERPROFILE%(?:[\\/]|\b))/gim, "home path form"],
  [/(?:^|[\s("'`=])\.\.(?:[\\/]|%2f|%5c)/gim, "path traversal"],
  [/(?:%2e){2}(?:%2f|%5c)/gim, "encoded path traversal"],
  [/(?:^|[\\/])private[\\/]/gim, "private directory reference"],
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g, "credential-like token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "JWT-like credential"],
  [/\b(?:access|refresh|id)_token\b\s*[:=]/gi, "authentication-token field"],
  [/\b(?:evidence|session|conversation)[-_ ](?:id|key)\s*[:=]\s*[A-Za-z0-9_-]{6,}/gim, "private evidence identifier"],
  [/\b(?:CJ|MC|MCL|AO|DA|E)\d{3}\b/g, "private evidence identifier"],
  [/\b(?:leaderboards?|ratings?|rankings?|scoring|scores?)\b/gi, "numerical ranking language"],
];

export function publicTextFindings(text) {
  const findings = [];
  for (const [pattern, reason] of FORBIDDEN_PUBLIC_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(reason);
  }
  return findings;
}

export function assertPublicTextSafe(text, label = "public text") {
  const findings = publicTextFindings(text);
  if (findings.length) throw new Error(`Public artifact scan failed: ${findings.map((reason) => `${label} (${reason})`).join(", ")}`);
  return text;
}

export async function scanPublicTree(root) {
  const findings = [];
  for (const relative of await walkFiles(root)) {
    if (!PUBLIC_TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
    const text = await readFile(within(root, relative), "utf8");
    for (const reason of publicTextFindings(text)) findings.push({ path: relative, reason });
  }
  if (findings.length) {
    throw new Error(`Public artifact scan failed: ${findings.map((item) => `${item.path} (${item.reason})`).join(", ")}`);
  }
  return { passed: true, filesScanned: (await walkFiles(root)).length };
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
