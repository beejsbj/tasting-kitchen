import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cook, inspect, loadDishes, loadMenus, plan } from "../lib/taste/index.mjs";

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
  await assert.rejects(inspect(repoRoot, { recipeId: "responsive-product-launch", revisionHash: current.revisions[0].hash }), /exactly one/);
  await assert.rejects(plan(repoRoot, { configurationId: "codex-sol-high", menuId: "visual-ui", recipeIds: ["responsive-product-launch"] }), /either menuId or recipeIds/);
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
  const repeat = await cook(repoRoot, {
    configurationId: "codex-sol-high",
    recipeIds: ["responsive-product-launch"],
    intent: "repeat",
  });
  assert.equal(repeat.planned.length, 1);
  assert.equal(repeat.skipped.length, 0);
  assert.deepEqual(await menuRevisionFiles(), before);
  await assert.rejects(cook(repoRoot, {
    configurationId: "codex-sol-high", recipeIds: ["responsive-product-launch"], intent: "repeat", execute: true, env: {},
  }), /TASTE_ALLOW_MODEL_RUNS=1/);
});

test("executing a Menu pins every member before a fake runner sees only supported cells", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-api-menu-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(repoRoot, "catalog"), path.join(root, "catalog"), { recursive: true });
  await cp(path.join(repoRoot, "dishes"), path.join(root, "dishes"), { recursive: true });
  const [menu] = (await loadMenus(root)).filter((candidate) => candidate.id === "visual-ui");
  let received;
  const result = await cook(root, {
    configurationId: "codex-sol-high",
    menuId: "visual-ui",
    intent: "fill-missing",
    execute: true,
    env: { TASTE_ALLOW_MODEL_RUNS: "1" },
    executePlan: async ({ plan }) => {
      received = plan;
      return { results: [], accepted: [], failed: [], unsupported: plan.unsupported };
    },
  });
  assert.equal(result.menuRevision.recipes.length, menu.recipes.length);
  assert.deepEqual(result.menuRevision.recipes.map((item) => item.recipeId), menu.recipes);
  const existing = await loadDishes(root);
  const expectedSkipped = result.menuRevision.recipes.filter((item) => existing.some((dish) => (
    dish.recipe.id === item.recipeId
    && dish.recipe.hash === item.recipeHash
    && dish.identity.configHash === received.variant.configHash
  )));
  assert.deepEqual(result.skipped.map(({ recipeId, recipeHash }) => ({ recipeId, recipeHash })), expectedSkipped);
  assert.equal(received.supported.length + result.skipped.length + received.unsupported.length, menu.recipes.length);
  const registry = JSON.parse(await readFile(path.join(root, "public/data/registry.json"), "utf8"));
  const configurationHashes = new Set(registry.configurationRevisions.map((revision) => revision.hash));
  for (const dish of registry.dishes) assert.ok(configurationHashes.has(dish.identity.configHash));
  const pinned = JSON.parse(await readFile(path.join(root, "catalog/revisions/menus", `visual-ui--${result.menuRevision.hash.slice("sha256:".length)}.json`), "utf8"));
  assert.deepEqual(pinned.recipes, result.menuRevision.recipes);
});

test("CLI rejects malformed, irrelevant, and ambiguous flags with JSON errors", () => {
  const unknown = spawnSync(process.execPath, ["bin/taste.mjs", "discover", "--nope"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown flag/);
  const intent = spawnSync(process.execPath, ["bin/taste.mjs", "cook", "--config", "codex-sol-high", "--recipe", "responsive-product-launch"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(intent.status, 1);
  assert.match(intent.stderr, /requires --intent/);
  for (const argv of [
    ["discover", "--execute"],
    ["discover", "extra"],
    ["cook", "--config", "codex-sol-high", "--recipe", "responsive-product-launch", "--intent", "repeat", "--execute=false"],
    ["inspect", "--recipe", "responsive-product-launch", "--revision", `sha256:${"0".repeat(64)}`],
  ]) {
    const result = spawnSync(process.execPath, ["bin/taste.mjs", ...argv, "--json"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 1, argv.join(" "));
    assert.match(result.stderr, /^\{"error":\{"code":"INVALID_ARGUMENT","message":"/u);
  }
});
