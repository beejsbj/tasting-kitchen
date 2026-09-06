import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const activeRoots = new AsyncLocalStorage();
const queues = new Map();
const LOCK_NAME = ".taste-recipe-files.lock";
const STAGING_SUFFIX = ".recipe-book-staging";
const BACKUP_SUFFIX = ".recipe-book-backup";

async function exists(filename) {
  try { await lstat(filename); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function acquireFilesystemLock(root) {
  const directory = path.join(root, LOCK_NAME);
  const started = Date.now();
  while (true) {
    try {
      await mkdir(directory);
      try {
        await writeFile(path.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
      return () => rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner;
      try { owner = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8")); }
      catch { owner = null; }
      let alive = true;
      if (Number.isInteger(owner?.pid)) {
        try { process.kill(owner.pid, 0); }
        catch (reason) { alive = reason?.code !== "ESRCH"; }
      }
      const age = Date.now() - (Date.parse(owner?.acquiredAt ?? "") || started);
      if (!alive || (!owner && age > 1_000)) {
        await rm(directory, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > 60_000) throw new Error("Timed out waiting for another recipe-file operation");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function recoverRecipeDirectories(root) {
  const recipesRoot = path.join(root, "catalog", "recipes");
  if (!await exists(recipesRoot)) return;
  const cuisines = await readdir(recipesRoot, { withFileTypes: true });
  for (const cuisine of cuisines) {
    if (!cuisine.isDirectory()) continue;
    const directory = path.join(recipesRoot, cuisine.name);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.name.endsWith(BACKUP_SUFFIX))) {
      const backup = path.join(directory, entry.name);
      const target = path.join(directory, entry.name.slice(0, -BACKUP_SUFFIX.length));
      if (await exists(target)) await rm(backup, { recursive: true, force: true });
      else await rename(backup, target);
    }
    for (const entry of entries.filter((item) => item.name.endsWith(STAGING_SUFFIX))) {
      await rm(path.join(directory, entry.name), { recursive: true, force: true });
    }
  }
}

/**
 * Serialize recipe-source reads and writes for a checkout. Nested calls in the
 * same operation are re-entrant, which lets registry builds take one coherent
 * snapshot while also building the Recipe Book sidecar.
 */
export async function withRecipeFilesLock(repoRoot, operation) {
  const root = path.resolve(repoRoot);
  const active = activeRoots.getStore();
  if (active?.has(root)) return operation();

  const previous = queues.get(root) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  queues.set(root, current);
  await previous;

  let releaseFilesystemLock;
  try {
    releaseFilesystemLock = await acquireFilesystemLock(root);
    await recoverRecipeDirectories(root);
    return await activeRoots.run(new Set([...(active ?? []), root]), operation);
  } finally {
    try {
      if (releaseFilesystemLock) await releaseFilesystemLock();
    } finally {
      release();
      if (queues.get(root) === current) queues.delete(root);
    }
  }
}
