import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashCanonical, sha256 } from "./hash.mjs";

/**
 * Execution environment: what a harness brings beyond its own defaults.
 *
 * - `clean` starts from an empty harness home, so only the harness shapes the run.
 * - `snapshot` starts from a throwaway, deterministic copy of Burooj's setup for
 *   that harness, made per attempt. The copied bytes hash to a setup digest the
 *   Dish records; the real setup is never written to.
 * - `live` runs in his real home exactly as it is, writes included. Only a
 *   harness profile that declares it offers it (Claude Code, never Hermes).
 *
 * Absent is its own state: a configuration that predates the dimension, which is
 * not the same as `clean`.
 */
export const ENVIRONMENTS = ["clean", "snapshot", "live"];
/** Environments that carry Burooj's own setup; their Dishes are private unless a Cook publishes them. */
export const PERSONAL_ENVIRONMENTS = ["snapshot", "live"];
/**
 * Toggles a personal environment must state. `memory` loads (and lets the
 * harness keep) his memories; `connections` loads his MCP servers and plugins,
 * which can act in the world. Clean has neither, so it carries neither.
 */
export const ENVIRONMENT_TOGGLES = ["memory", "connections"];
export const TOGGLE_VALUES = ["on", "off"];

export function environmentOf(variant) {
  return variant?.executionProfile?.environment;
}

export function isPersonalEnvironment(variant) {
  return PERSONAL_ENVIRONMENTS.includes(environmentOf(variant));
}

export function toggleOn(variant, toggle) {
  return variant?.executionProfile?.[toggle] === "on";
}

/** A configuration that loads his MCP servers and plugins, which may send mail or edit issues under bypassed permissions. */
export function usesConnections(variant) {
  return isPersonalEnvironment(variant) && toggleOn(variant, "connections");
}

// A snapshot is a bounded copy. A skill that is a whole repository (or a
// directory of chats) must not turn one attempt into gigabytes of copying.
const MAX_SETUP_FILES = 5000;
const MAX_SETUP_BYTES = 64 * 1024 * 1024;

/** One budget per snapshot, spent as files are read, so an oversized setup fails before its bytes are in memory. */
export function createSetupBudget() {
  return { files: 0, bytes: 0 };
}

function spendSetupBudget(budget, size) {
  budget.files += 1;
  budget.bytes += size;
  if (budget.files > MAX_SETUP_FILES) throw new Error(`Snapshot would copy more than ${MAX_SETUP_FILES} files`);
  if (budget.bytes > MAX_SETUP_BYTES) throw new Error(`Snapshot would copy more than ${MAX_SETUP_BYTES} bytes`);
}

// Left out at every depth. Volatile files change under his hands without his
// setup changing (a session id, a bytecode cache), which would make the setup
// digest say "when" instead of "which". Credential-looking files are never
// copied, whatever skill or plugin folder they sit in.
const EXCLUDED_NAMES = new Set(["__pycache__", "node_modules", ".staging", ".last-complete-round", ".DS_Store", ".netrc", ".credentials.json", "credentials.json", "auth.json", ".env"]);
const EXCLUDED_PATTERNS = [/\.pyc$/u, /\.pem$/u, /\.key$/u, /^id_(rsa|ed25519|ecdsa|dsa)(\.|$)/u, /^\.env\.(?!example$|sample$|template$)/u];

export function isExcludedSetupName(name) {
  return EXCLUDED_NAMES.has(name) || EXCLUDED_PATTERNS.some((pattern) => pattern.test(name));
}

function isExcludedSetupPath(relative) {
  return posix(relative).split("/").some(isExcludedSetupName);
}

function posix(relative) {
  return relative.split(path.sep).join("/");
}

function gitTrackedFiles(directory) {
  return new Promise((resolve) => {
    execFile("git", ["-C", directory, "ls-files", "-z", "--cached", "--", "."], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" } }, (error, stdout) => {
      if (error) return resolve(null);
      resolve(stdout.toString("utf8").split("\0").filter(Boolean));
    });
  });
}

async function walkRegular(root, relative, seen, out) {
  const directory = relative ? path.join(root, relative) : root;
  const real = await realpath(directory);
  if (seen.has(real)) return;
  seen.add(real);
  for (const name of (await readdir(directory)).sort()) {
    if (name === ".git" || isExcludedSetupName(name)) continue;
    if (out.length > MAX_SETUP_FILES) throw new Error(`Snapshot source ${root} holds more than ${MAX_SETUP_FILES} files`);
    const child = relative ? path.join(relative, name) : name;
    // Symlinks are followed: the snapshot holds the bytes he sees, not links back into his home.
    const info = await stat(path.join(root, child)).catch(() => null);
    if (info?.isDirectory()) await walkRegular(root, child, seen, out);
    else if (info?.isFile()) out.push(child);
  }
}

/**
 * The files of one setup directory, with their bytes. Inside a git work tree
 * only tracked files count (their working-tree bytes, so uncommitted edits are
 * included); elsewhere every regular file, minus `.git`. Symlinks are followed.
 */
export async function collectSetupDirectory(source, as, budget = createSetupBudget()) {
  const info = await stat(source).catch(() => null);
  if (!info?.isDirectory()) return [];
  const root = await realpath(source);
  let relatives = await gitTrackedFiles(root);
  // Untracked inside a repository (a skill not yet committed) reads like no repository at all.
  if (relatives === null || relatives.length === 0) {
    relatives = [];
    await walkRegular(root, "", new Set(), relatives);
  }
  const files = [];
  for (const relative of [...new Set(relatives.map(posix))].sort()) {
    if (isExcludedSetupPath(relative)) continue;
    const file = path.join(root, relative);
    const fileInfo = await stat(file).catch(() => null);
    // A tracked file deleted in the working tree, or a dangling link, is not part of what he sees.
    if (!fileInfo?.isFile()) continue;
    spendSetupBudget(budget, fileInfo.size);
    files.push(setupFile(`${as}/${relative}`, await readFile(file), fileInfo));
  }
  return files;
}

/** Each child of a directory of skills (or agents, commands): every skill collected on its own terms. */
export async function collectSetupChildren(source, as, budget = createSetupBudget()) {
  const info = await stat(source).catch(() => null);
  if (!info?.isDirectory()) return [];
  const files = [];
  for (const name of (await readdir(source)).sort()) {
    if (name.startsWith(".") || isExcludedSetupName(name)) continue;
    const child = path.join(source, name);
    const childInfo = await stat(child).catch(() => null);
    if (childInfo?.isDirectory()) files.push(...await collectSetupDirectory(child, `${as}/${name}`, budget));
    else if (childInfo?.isFile()) files.push(...await collectSetupFile(child, `${as}/${name}`, budget));
  }
  return files;
}

/** One setup file, following a symlink to its bytes; absent when there is no such file. */
export async function collectSetupFile(source, as, budget = createSetupBudget()) {
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) return [];
  spendSetupBudget(budget, info.size);
  return [setupFile(as, await readFile(source), info)];
}

/** A file's bytes, and whether the owner could run it: a skill's script keeps working in a snapshot. */
function setupFile(as, bytes, info) {
  return { path: as, bytes, ...(info.mode & 0o100 ? { executable: true } : {}) };
}

/** Bytes Kitchen writes into a snapshot (a derived config) count like copied ones. */
export function setupText(as, text) {
  return { path: as, bytes: Buffer.from(text, "utf8") };
}

function assertBounded(files) {
  const paths = new Set();
  let bytes = 0;
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`Snapshot holds ${file.path} twice`);
    paths.add(file.path);
    bytes += file.bytes.length;
  }
  if (files.length > MAX_SETUP_FILES) throw new Error(`Snapshot would copy ${files.length} files; the limit is ${MAX_SETUP_FILES}`);
  if (bytes > MAX_SETUP_BYTES) throw new Error(`Snapshot would copy ${bytes} bytes; the limit is ${MAX_SETUP_BYTES}`);
}

/** Sorted file list: what the digest and the receipt describe. */
export function setupManifest(files) {
  assertBounded(files);
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => ({ path: file.path, sha256: sha256(file.bytes), bytes: file.bytes.length, ...(file.executable ? { executable: true } : {}) }));
}

/** The setup digest: which version of his setup a snapshot Dish saw. Paths are relative to the snapshot home. */
export function setupDigest(files) {
  return hashCanonical({ schemaVersion: 1, files: setupManifest(files) });
}

/** A public-safe summary: one line per top-level entry, never file names below it. */
export function setupSummary(files) {
  const entries = new Map();
  for (const file of setupManifest(files)) {
    const entry = file.path.split("/")[0];
    const current = entries.get(entry) ?? { entry, files: 0, bytes: 0, hashes: [] };
    current.files += 1;
    current.bytes += file.bytes;
    current.hashes.push([file.path, file.sha256]);
    entries.set(entry, current);
  }
  return [...entries.values()].map(({ entry, files, bytes, hashes }) => ({ entry, files, bytes, digest: hashCanonical(hashes) }));
}

/** Write the snapshot into an empty, private harness home. Files are owner-only; a script keeps its owner exec bit. */
export async function writeSetupFiles(home, files) {
  for (const file of files) {
    const target = path.join(home, ...file.path.split("/"));
    if (!target.startsWith(`${home}${path.sep}`)) throw new Error(`Snapshot path escapes its home: ${file.path}`);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const mode = file.executable ? 0o700 : 0o600;
    await writeFile(target, file.bytes, { flag: "wx", mode });
    await chmod(target, mode);
  }
}

/** The setup record an attempt keeps: a digest plus the summary a receipt may show. */
export function setupRecord(variant, files, extra = {}) {
  return {
    environment: environmentOf(variant),
    ...(variant.executionProfile.harnessProfile ? { harnessProfile: variant.executionProfile.harnessProfile } : {}),
    memory: variant.executionProfile.memory,
    connections: variant.executionProfile.connections,
    digest: setupDigest(files),
    entries: setupSummary(files),
    ...extra,
  };
}

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

/** A recorded setup must match its configuration exactly; recovery and publication rely on this. */
export function assertSetupRecord(setup, variant) {
  const environment = environmentOf(variant);
  if (environment !== "snapshot") {
    if (setup !== undefined && setup !== null && setup.environment !== environment) throw new Error(`Setup record is for ${setup.environment}, not ${environment}`);
    return;
  }
  if (!setup || typeof setup !== "object") throw new Error("A snapshot attempt must record its setup");
  if (!DIGEST.test(setup.digest ?? "")) throw new Error("A snapshot attempt must record a SHA-256 setup digest");
  for (const key of ["environment", "harnessProfile", "memory", "connections"]) {
    if (setup[key] !== variant.executionProfile[key]) throw new Error(`Setup record ${key} does not match the configuration`);
  }
}
