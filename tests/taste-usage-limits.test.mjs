import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cook, plan } from "../lib/taste/index.mjs";
import { formatLocalTime, latestUsageLimit, usageLimitResetsAt } from "../lib/taste/usage-limits.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const CONFIGURATION = "codex-sol-high";
const RECIPE = "responsive-product-launch";

// Every expectation is built with local-time constructors, so the tests hold in any host time zone.
const local = (...parts) => new Date(...parts);

test("a date-only reset holds until the end of that local day", () => {
  const until = usageLimitResetsAt("Nov 21st, 2026");
  assert.equal(until.getTime(), local(2026, 10, 22).getTime() - 1);
  for (const text of ["November 21, 2026", "nov 21 2026", "Nov. 21st, 2026", "  Nov 21st,  2026 "]) {
    assert.equal(usageLimitResetsAt(text)?.getTime(), until.getTime(), text);
  }
  assert.equal(usageLimitResetsAt("Sept 2nd, 2026").getTime(), local(2026, 8, 3).getTime() - 1);
});

test("a time-only reset is the first such local time after the fault", () => {
  const morning = local(2026, 10, 21, 9, 30);
  assert.equal(usageLimitResetsAt("3:05 PM", { faultAt: morning }).getTime(), local(2026, 10, 21, 15, 5).getTime());
  assert.equal(usageLimitResetsAt("3:05PM", { faultAt: morning.toISOString() }).getTime(), local(2026, 10, 21, 15, 5).getTime(), "an ISO failedAt anchors it too");
  assert.equal(usageLimitResetsAt("3 p.m.", { faultAt: morning }).getTime(), local(2026, 10, 21, 15, 0).getTime());
  assert.equal(usageLimitResetsAt("15:05", { faultAt: morning }).getTime(), local(2026, 10, 21, 15, 5).getTime());
  assert.equal(usageLimitResetsAt("12:10 AM", { faultAt: morning }).getTime(), local(2026, 10, 22, 0, 10).getTime(), "midnight is the next day");
  // Already past on the fault's own day: the next day.
  const evening = local(2026, 10, 21, 16, 0);
  assert.equal(usageLimitResetsAt("3:05 PM", { faultAt: evening }).getTime(), local(2026, 10, 22, 15, 5).getTime());
  // Exactly at the fault is not after it.
  assert.equal(usageLimitResetsAt("3:05 PM", { faultAt: local(2026, 10, 21, 15, 5) }).getTime(), local(2026, 10, 22, 15, 5).getTime());
  // A time-only form needs the fault's own timestamp to mean anything.
  assert.equal(usageLimitResetsAt("3:05 PM"), null);
  assert.equal(usageLimitResetsAt("3:05 PM", { faultAt: "not a time" }), null);
});

test("a date with a time holds until that local moment", () => {
  assert.equal(usageLimitResetsAt("Nov 21st, 2026 3:05 PM").getTime(), local(2026, 10, 21, 15, 5).getTime());
  assert.equal(usageLimitResetsAt("Nov 21st, 2026 at 15:05").getTime(), local(2026, 10, 21, 15, 5).getTime());
});

test("an unreadable reset time holds nothing", () => {
  const faultAt = local(2026, 10, 21, 9, 30);
  for (const text of ["a later time", "Feb 30th, 2026", "Novem 21, 2026", "Nov 21st", "25:00", "13:05 PM", "0:30 AM", "3:65 PM", "", "tomorrow", undefined, null, 1795000000]) {
    assert.equal(usageLimitResetsAt(text, { faultAt }), null, String(text));
  }
});

test("local times print with their offset", () => {
  assert.match(formatLocalTime(local(2026, 10, 21, 15, 5)), /^2026-11-21 15:05 [+-]\d\d:\d\d$/u);
});

async function fixtureRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-usage-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(repoRoot, "catalog"), path.join(root, "catalog"), { recursive: true });
  await cp(path.join(repoRoot, "dishes"), path.join(root, "dishes"), { recursive: true });
  const recipePath = path.join(root, "catalog", "recipes", "ui-visual", RECIPE, "recipe.json");
  const recipe = JSON.parse(await readFile(recipePath, "utf8"));
  await writeFile(recipePath, `${JSON.stringify({ ...recipe, status: "ready" }, null, 2)}\n`);
  return root;
}

/** One recorded attempt, as runner.mjs leaves it: requested.json and a terminal state.json. */
async function attempt(root, { name, configuration = CONFIGURATION, state }) {
  const dir = path.join(root, "private", "runtime", "attempts", `attempt_${RECIPE}_${configuration}_${name}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "requested.json"), JSON.stringify({ identity: { variantId: configuration } }));
  await writeFile(path.join(dir, "state.json"), JSON.stringify(state));
  return path.basename(dir);
}

const limited = (failedAt, resetsAt) => ({
  status: "failed", stage: "execution", message: "usage limit", failedAt: failedAt.toISOString(),
  fault: { class: "kitchen", code: "usage-limit", stage: "execution", retryable: true, ...(resetsAt ? { resetsAt } : {}) },
});

const planAt = (root, now, extra = {}) => plan(root, { configurationId: CONFIGURATION, recipeIds: [RECIPE], now: () => now, ...extra });

test("plan skips a configuration until its last usage limit resets, and the override cooks it anyway", async (t) => {
  const root = await fixtureRepository(t);
  const failedAt = local(2026, 10, 21, 9, 30);
  assert.equal((await planAt(root, failedAt)).supported.length, 1, "no recorded limit: the cell is planned");
  const attemptId = await attempt(root, { name: "20261121T093000_a", state: limited(failedAt, "3:05 PM") });

  const held = await planAt(root, local(2026, 10, 21, 12, 0));
  assert.deepEqual(held.supported, []);
  assert.equal(held.usageLimited.length, 1);
  const [cell] = held.usageLimited;
  assert.equal(cell.recipeId, RECIPE);
  assert.equal(cell.status, "skipped");
  assert.equal(cell.reason, `skipped until ${formatLocalTime(local(2026, 10, 21, 15, 5))}: usage limit`);
  assert.equal(cell.until, local(2026, 10, 21, 15, 5).toISOString());
  assert.deepEqual(cell.blockedBy, { attemptId, fault: "usage-limit", failedAt: failedAt.toISOString(), resetsAt: "3:05 PM" });
  assert.equal(held.usageLimit.status, "holding");

  const overridden = await planAt(root, local(2026, 10, 21, 12, 0), { ignoreUsageLimit: true });
  assert.equal(overridden.supported.length, 1);
  assert.equal(overridden.usageLimited, undefined);
  assert.equal(overridden.usageLimit.status, "ignored");
  assert.match(overridden.usageLimit.note, /--ignore-usage-limit/u);

  // Once the reset has passed, nothing is held and nothing is said.
  const after = await planAt(root, local(2026, 10, 21, 15, 6));
  assert.equal(after.supported.length, 1);
  assert.equal(after.usageLimit, undefined);
});

test("a date-only reset holds through the end of that day", async (t) => {
  const root = await fixtureRepository(t);
  await attempt(root, { name: "20261121T093000_a", state: limited(local(2026, 10, 20, 22, 0), "Nov 21st, 2026") });
  assert.deepEqual((await planAt(root, local(2026, 10, 21, 23, 59))).supported, []);
  assert.equal((await planAt(root, local(2026, 10, 22, 0, 0))).supported.length, 1);
});

test("an unreadable or missing reset time skips nothing, and plan says so", async (t) => {
  const root = await fixtureRepository(t);
  const failedAt = local(2026, 10, 21, 9, 30);
  const attemptId = await attempt(root, { name: "20261121T093000_a", state: limited(failedAt, "a later time") });
  const unreadable = await planAt(root, local(2026, 10, 21, 9, 31));
  assert.equal(unreadable.supported.length, 1);
  assert.equal(unreadable.usageLimit.status, "unreadable");
  assert.equal(unreadable.usageLimit.attemptId, attemptId);
  assert.match(unreadable.usageLimit.note, /"a later time" is not a form Kitchen reads, so this configuration is not skipped/u);

  await attempt(root, { name: "20261121T100000_b", state: limited(local(2026, 10, 21, 10, 0), null) });
  const silent = await planAt(root, local(2026, 10, 21, 10, 1));
  assert.equal(silent.supported.length, 1);
  assert.match(silent.usageLimit.note, /gave no reset time, so this configuration is not skipped/u);
});

test("the latest usage limit decides, and a later served attempt lifts it", async (t) => {
  const root = await fixtureRepository(t);
  await attempt(root, { name: "20261120T093000_a", state: limited(local(2026, 10, 20, 9, 30), "Nov 25th, 2026") });
  const latest = await attempt(root, { name: "20261121T093000_b", state: limited(local(2026, 10, 21, 9, 30), "3:05 PM") });
  // Another configuration's limit is not this one's.
  await attempt(root, { name: "20261121T093000_c", configuration: "codex-sol-medium", state: limited(local(2026, 10, 21, 9, 30), "Nov 30th, 2026") });
  // A later Kitchen fault that never reached the provider does not lift it.
  await attempt(root, { name: "20261121T100000_d", state: { status: "failed", stage: "preparation", failedAt: local(2026, 10, 21, 10, 0).toISOString(), fault: { class: "kitchen", code: "preparation" } } });
  assert.equal((await latestUsageLimit(root, CONFIGURATION)).attemptId, latest);
  assert.equal((await planAt(root, local(2026, 10, 21, 15, 6))).supported.length, 1, "the latest limit (3:05 PM) has reset, though an older one named a later day");

  await attempt(root, { name: "20261121T110000_e", state: { status: "accepted", dishId: "dish_x", finalizedAt: local(2026, 10, 21, 11, 0).toISOString() } });
  assert.equal(await latestUsageLimit(root, CONFIGURATION), null);
  assert.equal((await planAt(root, local(2026, 10, 21, 12, 0))).supported.length, 1);
});

test("cook leaves a held configuration's cells open and hands the runner nothing for them", async (t) => {
  const root = await fixtureRepository(t);
  await attempt(root, { name: "20261121T093000_a", state: limited(local(2026, 10, 21, 9, 30), "3:05 PM") });
  const options = { configurationId: CONFIGURATION, recipeIds: [RECIPE], intent: "repeat", now: () => local(2026, 10, 21, 12, 0) };
  const dry = await cook(root, options);
  assert.deepEqual(dry.planned, []);
  assert.equal(dry.usageLimited.length, 1);
  assert.match(dry.usageLimited[0].reason, /^skipped until .*: usage limit$/u);
  let received;
  const executed = await cook(root, {
    ...options, execute: true, env: { TASTE_ALLOW_MODEL_RUNS: "1" },
    pruneCookDirectories: async () => ({ removed: [], kept: [], settled: [], errors: [] }),
    executePlan: async ({ plan: cooked }) => { received = cooked; return { results: [], accepted: [], failed: [], unsupported: cooked.unsupported }; },
  });
  assert.deepEqual(received.supported, []);
  assert.equal(executed.usageLimited.length, 1);
  const overridden = await cook(root, { ...options, ignoreUsageLimit: true });
  assert.equal(overridden.planned.length, 1);
  assert.equal(overridden.usageLimit.status, "ignored");
});

test("the CLI takes --ignore-usage-limit on plan and cook only", () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(repoRoot, "bin", "taste.mjs"), ...args, "--json"], { cwd: repoRoot, encoding: "utf8" });
  const planned = run("plan", "--config", CONFIGURATION, "--recipe", RECIPE, "--ignore-usage-limit");
  assert.equal(planned.status, 0, planned.stderr);
  const listed = run("list", "--ignore-usage-limit");
  assert.notEqual(listed.status, 0);
  assert.match(listed.stderr, /Unknown flag: --ignore-usage-limit|not.*list|does not apply/iu);
});
