import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { cook, inspect } from "../lib/taste/index.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const menuRevisionDirectory = path.join(repoRoot, "catalog", "revisions", "menus");

async function menuRevisionFiles() {
  try { return await readdir(menuRevisionDirectory); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

test("inspect returns exact public Recipe and immutable revision contracts", async () => {
  const current = await inspect(repoRoot, { recipeId: "responsive-product-launch" });
  assert.ok(current.recipe.turns.length > 0);
  assert.ok(current.recipe.output.entry);
  assert.ok(current.recipe.validation.checks.length > 0);
  const snapshot = await inspect(repoRoot, { revisionHash: current.revisions[0].hash });
  assert.deepEqual(snapshot.recipeRevision.execution.turns, current.revisions[0].execution.turns);
  await assert.rejects(inspect(repoRoot, { revisionHash: `sha256:${"0".repeat(64)}` }), /Unknown revision hash/);
});

test("dry cooking has no revision side effect and API execution requires paid-run opt-in", async () => {
  const before = await menuRevisionFiles();
  const dry = await cook(repoRoot, {
    configurationId: "codex-sol-high",
    recipeIds: ["responsive-product-launch"],
    intent: "fill-missing",
  });
  assert.equal(dry.mode, "dry-run");
  assert.equal(dry.skipped.length, 1);
  assert.deepEqual(await menuRevisionFiles(), before);
  await assert.rejects(cook(repoRoot, {
    configurationId: "codex-sol-high", recipeIds: ["responsive-product-launch"], intent: "repeat", execute: true, env: {},
  }), /TASTE_ALLOW_MODEL_RUNS=1/);
});

test("CLI rejects unknown flags and missing Cook intent", () => {
  const unknown = spawnSync(process.execPath, ["bin/taste.mjs", "discover", "--nope"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown flag/);
  const intent = spawnSync(process.execPath, ["bin/taste.mjs", "cook", "--config", "codex-sol-high", "--recipe", "responsive-product-launch"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(intent.status, 1);
  assert.match(intent.stderr, /requires --intent/);
});
