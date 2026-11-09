import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import "../lib/taste/harness-adapters.mjs";
import { pruneCookDirectories, registerCookDirectory, retentionMs } from "../lib/taste/cook-directories.mjs";
import { recoverAttempt } from "../lib/taste/recovery.mjs";
import { createCookDirectory, defaultRuntimeRoot, writableRuntimeRoot } from "../lib/taste/runtime-root.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-09T12:00:00.000Z");
const exists = (target) => access(target).then(() => true, () => false);
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

/** A repo and its own runtime root: these tests never prune the root other test files cook in. */
async function scene(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), "taste-prune-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repoRoot = path.join(base, "repo");
  const env = { TASTE_RUNTIME_ROOT: path.join(base, "runtime") };
  await mkdir(path.join(repoRoot, "private", "runtime", "attempts"), { recursive: true });
  let count = 0;
  /**
   * One attempt and its cook directory. `owner`: "alive" (this process), "dead"
   * (a record whose process is gone) or none. `state`: the attempt's state.json, or none.
   */
  const attempt = async ({ name = `attempt_demo_${(count += 1)}`, state, harness = "codex-cli", environment, profileId = "codex-linux-host-unsandboxed-v1", owner = "dead", startedAt = NOW.toISOString(), files = {} } = {}) => {
    const cookDirectory = await createCookDirectory({ env });
    const attemptDir = path.join(repoRoot, "private", "runtime", "attempts", name);
    await mkdir(attemptDir, { recursive: true });
    await writeFile(path.join(attemptDir, "requested.json"), JSON.stringify({ attemptId: name, startedAt, cookDirectory, identity: { harness }, execution: { profileId, ...(environment ? { environment } : {}) } }));
    if (state) await writeFile(path.join(attemptDir, "state.json"), JSON.stringify(state));
    await mkdir(path.join(cookDirectory, "workspace"));
    for (const [relative, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(cookDirectory, relative)), { recursive: true });
      await writeFile(path.join(cookDirectory, relative), text);
    }
    if (owner === "alive") await registerCookDirectory({ cookDirectory, attemptDir });
    if (owner === "dead") {
      await registerCookDirectory({ cookDirectory, attemptDir });
      // This pid with a start time it never had: a process that has since gone.
      const record = path.join(env.TASTE_RUNTIME_ROOT, ".owners", `${path.basename(cookDirectory)}.json`);
      await writeFile(record, JSON.stringify({ ...await readJson(record), start: "0" }));
    }
    return { cookDirectory, attemptDir, name };
  };
  const prune = (options = {}) => pruneCookDirectories({ repoRoot, env, now: NOW, ...options });
  return { repoRoot, env, attempt, prune, root: env.TASTE_RUNTIME_ROOT };
}

const failedAt = (daysAgo) => ({ status: "failed", stage: "publication", message: "disk full", failedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString() });

test("accepted attempts lose their cook directory; failed ones keep it for the retention window, then it is pruned and the attempt records when", async (t) => {
  const s = await scene(t);
  const accepted = await s.attempt({ state: { status: "accepted", dishId: "dish_demo" } });
  const recent = await s.attempt({ state: failedAt(3) });
  const expired = await s.attempt({ state: failedAt(15) });
  const report = await s.prune();
  assert.deepEqual(report.removed.map(({ reason }) => reason).sort(), ["accepted", "expired"]);
  assert.equal(await exists(accepted.cookDirectory), false);
  assert.equal(await exists(expired.cookDirectory), false);
  assert.equal(await exists(recent.cookDirectory), true);
  const kept = report.kept.find((entry) => entry.cookDirectory === recent.cookDirectory);
  assert.equal(kept.reason, "failed-within-retention");
  assert.equal(kept.expiresAt, new Date(NOW.getTime() + 11 * DAY).toISOString());
  // Their owner records go with them.
  assert.deepEqual((await readdir(path.join(s.root, ".owners"))).sort(), [`${path.basename(recent.cookDirectory)}.json`]);
  // The evidence stays; the attempt records when its cook directory went.
  assert.deepEqual(await readJson(path.join(expired.attemptDir, "pruned.json")), { cookDirectory: expired.cookDirectory, prunedAt: NOW.toISOString(), reason: "expired" });
});

test("recovering a pruned attempt fails with a message that names the prune", async (t) => {
  const s = await scene(t);
  const expired = await s.attempt({ state: failedAt(20) });
  // Enough of a recorded attempt for recovery to reach its cook directory.
  await writeFile(path.join(expired.attemptDir, "execution.json"), JSON.stringify({ turns: [], failure: null }));
  const requested = await readJson(path.join(expired.attemptDir, "requested.json"));
  await writeFile(path.join(expired.attemptDir, "requested.json"), JSON.stringify({ ...requested, recipe: { id: "demo", hash: "sha256:demo" } }));
  await s.prune();
  const catalog = { recipes: [{ id: "demo", recipeHash: "sha256:demo" }] };
  await assert.rejects(recoverAttempt({ repoRoot: s.repoRoot, catalog, attemptId: expired.name }), /cannot be recovered: its cook directory was pruned on 2026-11-09T12:00:00.000Z/);
});

test("a cook directory whose Kitchen is alive is never touched, whatever its attempt says", async (t) => {
  const s = await scene(t);
  const running = await s.attempt({ owner: "alive", state: failedAt(30), files: { "t3-home/userdata/settings.json": "{\"token\":\"live\"}" } });
  const report = await s.prune();
  assert.deepEqual(report.kept.map(({ reason }) => reason), ["running"]);
  assert.equal(await readFile(path.join(running.cookDirectory, "t3-home/userdata/settings.json"), "utf8"), "{\"token\":\"live\"}");
});

test("an attempt whose Kitchen died is settled: its adapter's cleanup removes stale tokens, logins and copies, and its state says so", async (t) => {
  const s = await scene(t);
  const t3 = await s.attempt({ harness: "t3", profileId: "t3-linux-host-clean-v1", environment: "clean", files: {
    "t3-home/userdata/settings.json": "{\"token\":\"stale\"}", "t3-home/userdata/secrets/key": "stale", "t3-home/userdata/state.sqlite": "kept",
  } });
  const hermes = await s.attempt({ harness: "hermes", profileId: "hermes-linux-host-snapshot-anthropic-v1", environment: "snapshot", files: {
    "hermes-home/claude-login/.credentials.json": "{}", "hermes-home/auth.json": "{}", "hermes-home/SOUL.md": "I am Rose.", "hermes-home/state.db": "db",
  } });
  const claude = await s.attempt({ harness: "claude-code", profileId: "claude-code-linux-host-snapshot-v1", environment: "snapshot", files: { "claude-home/CLAUDE.md": "his instructions" } });

  const dry = await s.prune({ dryRun: true });
  assert.equal(dry.settled.length, 3);
  assert.equal(await exists(path.join(t3.cookDirectory, "t3-home/userdata/settings.json")), true, "a dry run changes nothing");
  assert.equal(await exists(path.join(t3.attemptDir, "state.json")), false);

  const report = await s.prune();
  assert.equal(report.settled.length, 3);
  assert.deepEqual(report.removed, []);
  assert.deepEqual(await readdir(path.join(t3.cookDirectory, "t3-home/userdata")), ["state.sqlite"]);
  assert.deepEqual(await readdir(path.join(hermes.cookDirectory, "hermes-home")), ["state.db"]);
  assert.equal(await exists(path.join(claude.cookDirectory, "claude-home")), false);
  for (const { attemptDir } of [t3, hermes, claude]) {
    assert.deepEqual(await readJson(path.join(attemptDir, "state.json")), { status: "failed", stage: "interrupted", message: "The cooking process died before the attempt settled", failedAt: NOW.toISOString() });
  }
  // Settled now, it ages like any failed attempt.
  const later = await s.prune({ now: new Date(NOW.getTime() + 15 * DAY) });
  assert.equal(later.removed.length, 3);
});

test("orphans no attempt record references are removed once an hour old; a fresh one may be an attempt still starting", async (t) => {
  const s = await scene(t);
  const old = await createCookDirectory({ env: s.env });
  await utimes(old, new Date(NOW.getTime() - 2 * 60 * 60 * 1000), new Date(NOW.getTime() - 2 * 60 * 60 * 1000));
  const fresh = await createCookDirectory({ env: s.env });
  await utimes(fresh, NOW, NOW);
  // An owner record whose attempt was deleted, in another checkout perhaps.
  const gone = await s.attempt({ state: failedAt(1) });
  await rm(gone.attemptDir, { recursive: true });
  await utimes(gone.cookDirectory, new Date(NOW.getTime() - DAY), new Date(NOW.getTime() - DAY));
  // Not a cook directory: left alone.
  await writeFile(path.join(s.root, "notes.txt"), "mine");
  const report = await s.prune();
  assert.deepEqual(report.removed.map(({ cookDirectory, reason }) => [cookDirectory, reason]).sort(), [[old, "orphan"], [gone.cookDirectory, "orphan"]].sort());
  assert.deepEqual(report.kept.map(({ cookDirectory, reason }) => [cookDirectory, reason]), [[fresh, "recent-unregistered"]]);
  assert.equal(await exists(path.join(s.root, "notes.txt")), true);
});

test("a cook directory this checkout's attempt names is not an orphan, even without an owner record", async (t) => {
  const s = await scene(t);
  const legacy = await s.attempt({ owner: "none", state: failedAt(2) });
  await utimes(legacy.cookDirectory, new Date(NOW.getTime() - 2 * DAY), new Date(NOW.getTime() - 2 * DAY));
  const report = await s.prune();
  assert.deepEqual(report.kept.map(({ reason }) => reason), ["failed-within-retention"]);
});

test("the retention window is configurable; a missing root is nothing to prune", async (t) => {
  const s = await scene(t);
  assert.equal(retentionMs({}), 14 * DAY);
  assert.equal(retentionMs({ TASTE_COOK_RETENTION_DAYS: "0.5" }), DAY / 2);
  assert.throws(() => retentionMs({ TASTE_COOK_RETENTION_DAYS: "soon" }), /non-negative number of days/);
  assert.deepEqual((await s.prune()).removed, [], "no root yet");
  const recent = await s.attempt({ state: failedAt(1) });
  const report = await pruneCookDirectories({ repoRoot: s.repoRoot, env: { ...s.env, TASTE_COOK_RETENTION_DAYS: "0" }, now: NOW });
  assert.deepEqual(report.removed.map(({ cookDirectory }) => cookDirectory), [recent.cookDirectory]);
});

test("under the test runner, writing to the real runtime root is refused", async () => {
  assert.equal(writableRuntimeRoot({ TASTE_RUNTIME_ROOT: "/tmp/elsewhere" }), "/tmp/elsewhere");
  assert.throws(() => writableRuntimeRoot({ TASTE_RUNTIME_ROOT: "" }), /Refusing the real runtime root/);
  const saved = process.env.TASTE_RUNTIME_ROOT;
  delete process.env.TASTE_RUNTIME_ROOT;
  try {
    await assert.rejects(createCookDirectory({}), new RegExp(`Refusing the real runtime root ${defaultRuntimeRoot()}`));
    await assert.rejects(pruneCookDirectories({}), /Refusing the real runtime root/);
  } finally {
    process.env.TASTE_RUNTIME_ROOT = saved;
  }
});
