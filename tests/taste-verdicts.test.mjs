import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRegistry, loadDishes } from "../lib/taste/registry.mjs";
import { createVerdict, loadVerdicts, standingVerdict, validateVerdict, verdictMiddleware, writeVerdict } from "../lib/taste/verdicts.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function repository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-verdicts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(repoRoot, "catalog"), path.join(root, "catalog"), { recursive: true });
  await cp(path.join(repoRoot, "dishes"), path.join(root, "dishes"), { recursive: true });
  return root;
}

const dish = { id: "dish_demo_codex-sol-high_20260814120000000_fixed", dishHash: `sha256:${"a".repeat(64)}` };

test("a verdict pins its Dish's hash and validates its judge, value and public-safe note", () => {
  const verdict = createVerdict({ plate: dish, verdict: "failed", note: "  Ignores the second turn entirely. ", now: new Date("2026-11-09T10:00:00.000Z") });
  assert.deepEqual(verdict, {
    schemaVersion: 1,
    id: "verdict_dish_demo_codex-sol-high_20260814120000000_fixed_20261109100000000",
    plateId: dish.id,
    plateHash: dish.dishHash,
    judge: { kind: "owner", name: "Burooj" },
    verdict: "failed",
    note: "Ignores the second turn entirely.",
    decidedAt: "2026-11-09T10:00:00.000Z",
  });
  const dishes = new Map([[dish.id, dish]]);
  assert.doesNotThrow(() => validateVerdict(verdict, dishes));
  assert.throws(() => validateVerdict({ ...verdict, plateHash: `sha256:${"b".repeat(64)}` }, dishes), /immutable hash/);
  assert.throws(() => validateVerdict({ ...verdict, plateId: "dish_unknown" }, dishes), /unknown plate/);
  assert.throws(() => validateVerdict({ ...verdict, verdict: "meh" }), /failed or passed/);
  assert.throws(() => validateVerdict({ ...verdict, judge: { kind: "council", name: "Models" } }), /judge.kind must be one of owner/);
  assert.throws(() => validateVerdict({ ...verdict, extra: true }), /unknown keys: extra/);
  assert.throws(() => validateVerdict({ ...verdict, note: "" }), /note must be/);
  assert.throws(() => validateVerdict({ ...verdict, note: "x".repeat(501) }), /note must be/);
  assert.throws(() => validateVerdict({ ...verdict, note: "It scores poorly" }), /numerical ranking language/);
  assert.throws(() => validateVerdict({ ...verdict, note: "Wrote to /home/someone/notes" }), /absolute home path/);
});

test("the newest owner verdict stands; earlier ones stay on record", () => {
  const first = createVerdict({ plate: dish, verdict: "failed", note: "Too long.", now: new Date("2026-11-09T10:00:00.000Z") });
  const second = createVerdict({ plate: dish, verdict: "passed", note: "On a second look it holds.", now: new Date("2026-11-10T10:00:00.000Z") });
  assert.equal(standingVerdict([first, second]).id, second.id);
  assert.equal(standingVerdict([second, first]).id, second.id);
});

test("a verdict is written as a sidecar beside the Dish, never touching dish.json, and the registry shows it", async (t) => {
  const root = await repository(t);
  // A Dish on the public counter (a Recipe that is ready and public).
  const [target] = (await buildRegistry({ repoRoot: root })).registry.dishes;
  const manifestBefore = await readFile(path.join(root, "dishes", target.id, "dish.json"), "utf8");
  const { verdict, path: relative } = await writeVerdict(root, { plateId: target.id, verdict: "failed", note: "Misses the brief's one hard constraint.", now: new Date("2026-11-09T10:00:00.000Z") });
  assert.equal(relative, `verdicts/${verdict.id}.json`);
  assert.equal(await readFile(path.join(root, "dishes", target.id, "dish.json"), "utf8"), manifestBefore, "dish.json is untouched");
  assert.deepEqual((await loadVerdicts(root, { plates: await loadDishes(root) })).map((item) => item.id), [verdict.id]);
  await assert.rejects(writeVerdict(root, { plateId: target.id, verdict: "failed", note: "Same moment again.", now: new Date("2026-11-09T10:00:00.000Z") }), /already recorded/);
  await assert.rejects(writeVerdict(root, { plateId: "dish_nope", verdict: "passed", note: "x" }), /Unknown Dish or No Dish/);
  await assert.rejects(writeVerdict(root, { plateId: target.id, verdict: "maybe", note: "x" }), /failed or passed/);
  const { registry } = await buildRegistry({ repoRoot: root });
  assert.deepEqual(registry.verdicts.map((item) => item.id), [verdict.id]);
  // A verdict pinned to a hash the Dish does not have breaks the build rather than attaching to the wrong Dish.
  await writeFile(path.join(root, relative), JSON.stringify({ ...verdict, plateHash: `sha256:${"0".repeat(64)}` }));
  await assert.rejects(buildRegistry({ repoRoot: root }), /immutable hash/);
});

test("the CLI requires a Dish, exactly one of --failed or --passed, and a note", () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(repoRoot, "bin/taste.mjs"), "verdict", ...args, "--json"], { encoding: "utf8" });
  for (const [args, message] of [
    [["--failed", "--note", "x"], /requires --dish/],
    [["--dish", "dish_x", "--note", "x"], /exactly one of --failed or --passed/],
    [["--dish", "dish_x", "--failed", "--passed", "--note", "x"], /exactly one of --failed or --passed/],
    [["--dish", "dish_x", "--passed"], /requires --note/],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).error.message, message);
  }
});

test("the local write path accepts only loopback same-origin posts", async (t) => {
  const root = await repository(t);
  const [target] = await loadDishes(root);
  const handler = verdictMiddleware(root);
  const call = async ({ method = "POST", origin = "http://127.0.0.1:5199", host = "127.0.0.1:5199", body } = {}) => {
    const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
    const req = { method, url: "/api/verdicts", headers: { host, origin, "content-type": "application/json" }, socket: {}, [Symbol.asyncIterator]: async function* () { yield* chunks; } };
    const res = { statusCode: 0, body: "", setHeader() {}, end(value) { this.body = value; } };
    await handler(req, res, () => { res.statusCode = 404; });
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
  assert.equal((await call({ method: "GET" })).json.writable, true);
  assert.equal((await call({ origin: "https://evil.example", body: { plateId: target.id, verdict: "failed", note: "x" } })).status, 403);
  assert.equal((await call({ host: "tasting-kitchen.burooj.dev", origin: "https://tasting-kitchen.burooj.dev", body: { plateId: target.id, verdict: "failed", note: "x" } })).status, 403);
  assert.equal((await call({ body: { plateId: target.id, verdict: "failed", note: "It scores badly" } })).status, 400);
  const saved = await call({ body: { plateId: target.id, verdict: "passed", note: "Holds up." } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.verdict.verdict, "passed");
  assert.deepEqual(await readdir(path.join(root, "verdicts")), [`${saved.json.verdict.id}.json`]);
});
