import { randomBytes } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Where cooking happens. The Kitchen repo holds the program (catalog, CLI, web
 * app); a Run's workspace and harness homes live in a cook directory under a
 * runtime root outside any git tree and outside the Kitchen checkout, so no
 * harness discovers Kitchen's instructions, package.json or history. Private
 * attempt evidence stays in private/runtime/attempts/<attemptId>/, which the
 * model never sees.
 *
 * The default is /var/tmp/tk-<uid>, not $XDG_STATE_HOME: a harness user's home
 * holds .codex and .cursor (and here ~/.local holds a package.json), so a root
 * under $HOME would fail the ancestor guard below. /var/tmp survives a reboot,
 * which recovery needs. TASTE_RUNTIME_ROOT overrides it; the guard still applies.
 */
export const RUNTIME_ROOT_ENV = "TASTE_RUNTIME_ROOT";

/**
 * Names that make a harness treat a directory as a project with its own
 * instructions, skills or setup. `.claude` and `.agents` hold project settings
 * and skills that Claude Code, Codex and Cursor discover above the working directory.
 */
export const ISOLATION_MARKERS = [".git", "AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "GEMINI.md", ".agents", ".claude", ".codex", ".cursor", "package.json"];

export function resolveRuntimeRoot(env = {}) {
  const configured = env[RUNTIME_ROOT_ENV] ?? process.env[RUNTIME_ROOT_ENV];
  if (configured !== undefined && configured !== "") {
    if (!path.isAbsolute(configured)) throw new Error(`${RUNTIME_ROOT_ENV} must be an absolute path`);
    return path.normalize(configured);
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().username;
  return path.join("/var/tmp", `tk-${uid}`);
}

async function existing(target) {
  try { return await lstat(target); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** The runtime root is shared ground (/var/tmp): it must be our own private directory, not a planted link. */
async function ensureRuntimeRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Runtime root must be a real directory: ${root}`);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error(`Runtime root is not owned by this user: ${root}`);
  if ((info.mode & 0o022) !== 0) throw new Error(`Runtime root must not be group- or world-writable: ${root}`);
}

/** Directories from `directory` up to the filesystem root, inclusive. */
export function ancestry(directory) {
  const chain = [];
  let current = path.resolve(directory);
  for (;;) {
    chain.push(current);
    const parent = path.dirname(current);
    if (parent === current) return chain;
    current = parent;
  }
}

/**
 * Fail closed when the workspace, or any directory above it up to `/`, holds a
 * project marker. Both the lexical path and its real path are walked, so a
 * symlinked runtime root cannot hide a checkout. Returns nothing; throws with
 * every finding.
 */
export async function assertIsolatedWorkspace(workspace) {
  const lexical = path.resolve(workspace);
  const directories = new Set([...ancestry(lexical), ...ancestry(await realpath(lexical))]);
  const findings = [];
  for (const directory of directories) {
    for (const marker of ISOLATION_MARKERS) {
      if (await existing(path.join(directory, marker))) findings.push(path.join(directory, marker));
    }
  }
  if (findings.length) {
    const error = new Error(`Workspace is not isolated; a harness could load project context from: ${findings.join(", ")}. Set ${RUNTIME_ROOT_ENV} to a directory outside any repository and home directory`);
    error.stage = "preparation";
    throw error;
  }
}

/**
 * Create one fresh cook directory. Its name is random, so no path the model can
 * see names the Recipe, configuration or model; requested.json maps it back.
 */
export async function createCookDirectory({ env = {}, nonce = randomBytes(8).toString("hex") } = {}) {
  if (!/^[a-f0-9]{16}$/u.test(nonce)) throw new Error("Cook directory nonce must be 16 lowercase hex characters");
  const root = resolveRuntimeRoot(env);
  await ensureRuntimeRoot(root);
  const directory = path.join(root, nonce);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  return directory;
}

/** The cook directory an attempt recorded. Legacy attempts cooked inside their evidence directory. */
export function cookDirectoryFor(requested, attemptDir) {
  const recorded = requested?.cookDirectory;
  if (recorded === undefined) return attemptDir;
  if (typeof recorded !== "string" || !path.isAbsolute(recorded) || path.normalize(recorded) !== recorded || !/^[a-f0-9]{16}$/u.test(path.basename(recorded))) {
    throw new Error("Attempt records an unsafe cook directory");
  }
  return recorded;
}
