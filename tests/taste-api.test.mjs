import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cook, inspect, loadCatalog, loadDishes, loadMenus, plan } from "../lib/taste/index.mjs";
import { compatibilityFor } from "../lib/taste/harness-adapters.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function catalogFiles(root) {
  return (await readdir(path.join(root, "catalog"), { recursive: true })).sort();
}

async function fixtureRepository(t, { reactivateRecipeId } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-api-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(repoRoot, "catalog"), path.join(root, "catalog"), { recursive: true });
  await cp(path.join(repoRoot, "dishes"), path.join(root, "dishes"), { recursive: true });
  if (reactivateRecipeId) {
    const recipePath = path.join(root, "catalog", "recipes", "ui-visual", reactivateRecipeId, "recipe.json");
    const recipe = JSON.parse(await readFile(recipePath, "utf8"));
    recipe.status = "ready";
    await writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
  }
  return root;
}

test("inspect returns the current public Recipe contract and its Dishes", async (t) => {
  const root = await fixtureRepository(t, { reactivateRecipeId: "responsive-product-launch" });
  const current = await inspect(root, { recipeId: "responsive-product-launch" });
  assert.ok(current.recipe.turns.length > 0);
  assert.ok(current.recipe.output.entry);
  assert.ok(current.recipe.validation.checks.length > 0);
  assert.ok(current.dishes.every((dish) => dish.recipe.id === "responsive-product-launch"));
  assert.equal(current.revisions, undefined);
  assert.equal((await inspect(root, { menuId: "fresh-visual-ui" })).menu.id, "fresh-visual-ui");
  await assert.rejects(inspect(root, { recipeId: "responsive-product-launch", menuId: "fresh-visual-ui" }), /exactly one/);
  await assert.rejects(plan(root, { configurationId: "codex-sol-high", menuId: "visual-ui", recipeIds: ["responsive-product-launch"] }), /either menuId or recipeIds/);
});

test("dry cooking has no catalog side effect and API execution requires paid-run opt-in", async (t) => {
  const root = await fixtureRepository(t, { reactivateRecipeId: "responsive-product-launch" });
  const before = await catalogFiles(root);
  const dry = await cook(root, {
    configurationId: "codex-sol-high",
    recipeIds: ["responsive-product-launch"],
    intent: "fill-missing",
  });
  assert.equal(dry.mode, "dry-run");
  assert.equal(dry.planned.length + dry.skipped.length, 1);
  const repeat = await cook(root, {
    configurationId: "codex-sol-high",
    recipeIds: ["responsive-product-launch"],
    intent: "repeat",
  });
  assert.equal(repeat.planned.length, 1);
  assert.equal(repeat.skipped.length, 0);
  assert.deepEqual(await catalogFiles(root), before);
  await assert.rejects(cook(root, {
    configurationId: "codex-sol-high", recipeIds: ["responsive-product-launch"], intent: "repeat", execute: true, env: {},
  }), /TASTE_ALLOW_MODEL_RUNS=1/);
});

test("executing a Menu hands a fake runner only supported, uncovered cells and writes nothing to the catalog", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-api-menu-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(repoRoot, "catalog"), path.join(root, "catalog"), { recursive: true });
  await cp(path.join(repoRoot, "dishes"), path.join(root, "dishes"), { recursive: true });
  const [menu] = (await loadMenus(root)).filter((candidate) => candidate.id === "fresh-visual-ui");
  let received;
  const result = await cook(root, {
    configurationId: "codex-sol-high",
    menuId: "fresh-visual-ui",
    intent: "fill-missing",
    execute: true,
    env: { TASTE_ALLOW_MODEL_RUNS: "1" },
    executePlan: async ({ plan }) => {
      received = plan;
      return { results: [], accepted: [], failed: [], unsupported: plan.unsupported };
    },
  });
  assert.equal(result.menuRevision, undefined);
  const catalog = await loadCatalog(root);
  const existing = await loadDishes(root);
  const expectedSkipped = menu.recipes.filter((recipeId) => existing.some((dish) => (
    dish.recipe.id === recipeId
    && dish.recipe.hash === catalog.recipes.find((recipe) => recipe.id === recipeId).recipeHash
    && dish.identity.configHash === received.variant.configHash
  )));
  assert.deepEqual(result.skipped.map(({ recipeId }) => recipeId), expectedSkipped);
  assert.equal(received.supported.length + result.skipped.length + received.unsupported.length, menu.recipes.length);
  const registry = JSON.parse(await readFile(path.join(root, "public/data/registry.json"), "utf8"));
  for (const gone of ["recipeRevisions", "configurationRevisions", "skillRevisions", "menuRevisions"]) assert.equal(registry[gone], undefined, gone);
  for (const dish of registry.dishes) assert.ok(dish.receipt?.configuration?.configHash === dish.identity.configHash || dish.receipt?.configuration);
  assert.equal(await catalogFiles(root).then((files) => files.some((file) => file.startsWith("revisions"))), false);
});

test("cook preserves an explicit allowed-status override through execution", async (t) => {
  const root = await fixtureRepository(t);
  const recipeId = "responsive-product-launch";
  const recipePath = path.join(root, "catalog/recipes/ui-visual", recipeId, "recipe.json");
  const recipe = JSON.parse(await readFile(recipePath, "utf8"));
  recipe.status = "draft";
  await writeFile(recipePath, JSON.stringify(recipe));
  let checked = false;
  await cook(root, {
    configurationId: "codex-sol-high", recipeIds: [recipeId],
    intent: "repeat", execute: true, allowStatuses: ["draft"],
    env: { TASTE_ALLOW_MODEL_RUNS: "1" },
    executePlan: async ({ plan, allowStatuses }) => {
      assert.equal(plan.supported.length, 1);
      assert.equal(compatibilityFor({ variant: plan.variant, recipe }).supported, false);
      assert.equal(compatibilityFor({ variant: plan.variant, recipe, allowStatuses }).supported, true);
      checked = true;
      return { results: [], accepted: [], failed: [], unsupported: [] };
    },
  });
  assert.equal(checked, true);
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

test("CLI help and catalog validation have structured JSON forms", () => {
  const help = spawnSync(process.execPath, ["bin/taste.mjs", "cook", "--help", "--json"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(JSON.parse(help.stdout).help, /--menu ID/u);

  const validation = spawnSync(process.execPath, ["bin/taste.mjs", "validate", "--json"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(validation.status, 0, validation.stderr);
  const result = JSON.parse(validation.stdout);
  assert.equal(result.status, "valid");
  assert.deepEqual(result.errors, []);
  assert.match(result.output, /Catalog valid/u);
});
