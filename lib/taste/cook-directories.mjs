import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { writeJsonAtomic } from "./files.mjs";
import { getHarnessAdapter } from "./harness-adapters.mjs";
import { checkRuntimeRoot, writableRuntimeRoot } from "./runtime-root.mjs";

/**
 * The lifecycle of cook directories, so nobody has to think about them.
 *
 * - An accepted attempt's cook directory (workspace, harness homes, snapshot
 *   copies, scratch) is deleted as soon as its Dish is published.
 * - A failed attempt keeps its cook directory so `taste recover` can still read
 *   it, until it is older than the retention window (default 14 days,
 *   TASTE_COOK_RETENTION_DAYS). Every Cook prunes before it starts;
 *   `taste prune [--dry-run]` does the same by hand.
 * - An attempt whose Kitchen died without settling it (a SIGKILL, a crash, a
 *   reboot) is settled by the next prune: its adapter's cleanup removes stale
 *   tokens, logins and copies, and its state records the death. Its cook
 *   directory then ages like any failed attempt's.
 * - A cook directory no attempt record references (an older Kitchen, a test run
 *   against the real root) is an orphan and is removed once it is an hour old.
 *
 * Who owns a cook directory is recorded outside it, in `<root>/.owners/<name>.json`
 * (the evidence directory and the owning process), so the model's working tree
 * names nothing, and a prune from another checkout sharing the root can still
 * find the attempt and never touches a directory whose Kitchen is alive.
 */

export const RETENTION_ENV = "TASTE_COOK_RETENTION_DAYS";
export const DEFAULT_RETENTION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
// A directory created a moment before its owner record must not look orphaned to a concurrent prune.
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const COOK_NAME = /^[a-f0-9]{16}$/u;
const OWNERS = ".owners";

export function retentionMs(env = {}) {
  const raw = env[RETENTION_ENV] ?? process.env[RETENTION_ENV];
  if (raw === undefined || raw === "") return DEFAULT_RETENTION_DAYS * DAY_MS;
  // Number() reads a blank as 0 and "0x10" as 16: only a plain decimal is a retention.
  const days = /^\s*\d+(?:\.\d+)?\s*$/u.test(String(raw)) ? Number(raw) : NaN;
  if (!Number.isFinite(days) || days < 0) throw new Error(`${RETENTION_ENV} must be a non-negative number of days`);
  return days * DAY_MS;
}

/** This process's identity as /proc records it: a pid alone can be reused, a pid with its start time cannot. */
async function processStart(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch { return null; }
}

async function ownerAlive(owner) {
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0) return false;
  const start = await processStart(owner.pid);
  if (start !== null) return start === owner.start;
  // No /proc: fall back to whether the pid exists at all.
  try { process.kill(owner.pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function ownerFile(cookDirectory) {
  return path.join(path.dirname(cookDirectory), OWNERS, `${path.basename(cookDirectory)}.json`);
}

/** Record which attempt and which live process own a fresh cook directory. */
export async function registerCookDirectory({ cookDirectory, attemptDir }) {
  const file = ownerFile(cookDirectory);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({ attemptDir, pid: process.pid, start: await processStart(process.pid) })}\n`, { encoding: "utf8", mode: 0o600 });
}

/** Delete a cook directory and its owner record. */
export async function removeCookDirectory(cookDirectory) {
  await rm(cookDirectory, { recursive: true, force: true });
  await rm(ownerFile(cookDirectory), { force: true });
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch { return null; }
}

async function entryInfo(target) {
  try { return await lstat(target); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** Cook directory → attempt directory, from this checkout's attempts and every owner record in the root. */
async function references(root, repoRoot) {
  const found = new Map();
  const owners = new Map();
  for (const name of await readdir(path.join(root, OWNERS)).catch(() => [])) {
    if (!name.endsWith(".json") || !COOK_NAME.test(name.slice(0, -5))) continue;
    const owner = await readJson(path.join(root, OWNERS, name));
    const cookDirectory = path.join(root, name.slice(0, -5));
    owners.set(cookDirectory, owner);
    if (typeof owner?.attemptDir === "string" && path.isAbsolute(owner.attemptDir)) found.set(cookDirectory, owner.attemptDir);
  }
  if (repoRoot) {
    const attempts = path.join(repoRoot, "private", "runtime", "attempts");
    for (const name of await readdir(attempts).catch(() => [])) {
      const requested = await readJson(path.join(attempts, name, "requested.json"));
      const recorded = requested?.cookDirectory;
      if (typeof recorded === "string" && path.dirname(recorded) === root && !found.has(recorded)) found.set(recorded, path.join(attempts, name));
    }
  }
  return { found, owners };
}

/**
 * Run the attempt's own adapter cleanup on a cook directory whose Kitchen is
 * gone: a T3 token in scratch settings, a Hermes login copy, a snapshot copy.
 * The adapter needs only the harness and the environment the attempt recorded.
 */
async function adapterCleanup(cookDirectory, requested) {
  const harness = requested?.identity?.harness;
  let adapter;
  try { adapter = getHarnessAdapter(harness); }
  catch { return; }
  const variant = { harness, executionProfile: { id: requested.execution?.profileId, environment: requested.execution?.environment } };
  await adapter.cleanupAttempt?.({ variant, cwd: cookDirectory, harnessHome: path.join(cookDirectory, adapter.homeDirectory ?? "codex-home") });
}

/**
 * Prune the runtime root. Returns what was (or, with `dryRun`, would be) done:
 * `removed` and `kept` entries with their reasons, `settled` attempts whose
 * Kitchen died, and `errors`. Never touches a directory whose Kitchen is alive.
 */
export async function pruneCookDirectories({ repoRoot, env = {}, now = new Date(), dryRun = false, retention = retentionMs(env) } = {}) {
  const root = writableRuntimeRoot(env);
  const report = { root, dryRun, retentionDays: retention / DAY_MS, removed: [], kept: [], settled: [], errors: [] };
  if (!await checkRuntimeRoot(root)) return report;
  const { found, owners } = await references(root, repoRoot);
  for (const name of (await readdir(root)).sort()) {
    if (!COOK_NAME.test(name)) continue;
    const cookDirectory = path.join(root, name);
    try {
      const info = await entryInfo(cookDirectory);
      if (!info?.isDirectory()) { report.kept.push({ cookDirectory, reason: "not-a-directory" }); continue; }
      const remove = async (reason, attemptDir = null) => {
        report.removed.push({ cookDirectory, reason, ...(attemptDir ? { attemptDir } : {}) });
        if (dryRun) return;
        await removeCookDirectory(cookDirectory);
        // Recovery explains a missing cook directory from this record.
        if (attemptDir && reason !== "accepted") await writeJsonAtomic(path.join(attemptDir, "pruned.json"), { cookDirectory, prunedAt: now.toISOString(), reason }).catch(() => {});
      };
      // Read fresh, not from the snapshot taken before the loop: an attempt that registered since then is alive.
      if (await ownerAlive(await readJson(ownerFile(cookDirectory)))) { report.kept.push({ cookDirectory, reason: "running" }); continue; }
      const attemptDir = found.get(cookDirectory);
      const requested = attemptDir ? await readJson(path.join(attemptDir, "requested.json")) : null;
      if (!requested || requested.cookDirectory !== cookDirectory) {
        if (now - info.mtimeMs < ORPHAN_GRACE_MS) report.kept.push({ cookDirectory, reason: "recent-unregistered" });
        else await remove("orphan");
        continue;
      }
      let state = await readJson(path.join(attemptDir, "state.json"));
      if (state?.status === "accepted") { await remove("accepted", attemptDir); continue; }
      if (state?.status !== "failed") {
        // Its Kitchen died mid-attempt: discard what the adapter would have, and say so.
        report.settled.push({ cookDirectory, attemptDir });
        state = { status: "failed", stage: "interrupted", message: "The cooking process died before the attempt settled", failedAt: now.toISOString() };
        if (!dryRun) {
          await adapterCleanup(cookDirectory, requested);
          await writeJsonAtomic(path.join(attemptDir, "state.json"), state);
        }
      } else if (!dryRun) {
        // Settled already, so normally a no-op; it catches a cleanup that failed or never ran.
        await adapterCleanup(cookDirectory, requested);
      }
      const failedAt = Date.parse(state.failedAt ?? requested.startedAt ?? "");
      const age = now - (Number.isFinite(failedAt) ? failedAt : info.mtimeMs);
      if (age > retention) await remove("expired", attemptDir);
      else report.kept.push({ cookDirectory, attemptDir, reason: "failed-within-retention", expiresAt: new Date(now.getTime() - age + retention).toISOString() });
    } catch (error) {
      report.errors.push({ cookDirectory, message: error.message });
    }
  }
  // Owner records whose directory is gone.
  if (!dryRun) {
    for (const cookDirectory of owners.keys()) {
      if (!await entryInfo(cookDirectory)) await rm(ownerFile(cookDirectory), { force: true }).catch(() => {});
    }
  }
  return report;
}
