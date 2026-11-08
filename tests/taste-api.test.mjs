import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cook, inspect, loadCatalog, loadDishes, loadMenus, plan, recover } from "../lib/taste/index.mjs";
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
    executePlan: async ({ plan, catalog: executed }) => {
      received = plan;
      assert.equal(executed.catalogHash, plan.catalogHash, "the runner receives the catalog snapshot that was planned");
      for (const item of plan.supported) assert.equal(executed.recipes.find((recipe) => recipe.id === item.recipeId).recipeHash, item.recipeHash);
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

test("CLI help and catalog validation have structured JSON forms", async (t) => {
  const root = await fixtureRepository(t);
  const env = { ...process.env, TASTE_CATALOG_ROOT: root };
  const help = spawnSync(process.execPath, ["bin/taste.mjs", "cook", "--help", "--json"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(JSON.parse(help.stdout).help, /--menu ID/u);

  assert.match(JSON.parse(help.stdout).help, /taste validate \[--public-checkout\] \[--json\]/u);

  const validation = spawnSync(process.execPath, ["bin/taste.mjs", "validate", "--public-checkout", "--json"], { cwd: repoRoot, encoding: "utf8", env });
  assert.equal(validation.status, 0, validation.stderr);
  const result = JSON.parse(validation.stdout);
  assert.equal(result.status, "valid");
  assert.deepEqual(result.errors, []);
  assert.match(result.output, /Catalog valid/u);
  assert.match(result.output, /private provenance skipped \(--public-checkout\)/u);
  assert.doesNotMatch(result.output, /provenance records checked/u);

  const plain = spawnSync(process.execPath, ["bin/taste.mjs", "validate", "--public-checkout"], { cwd: repoRoot, encoding: "utf8", env });
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /private provenance skipped \(--public-checkout\)/u);

  const strict = spawnSync(process.execPath, ["bin/taste.mjs", "validate", "--json"], { cwd: repoRoot, encoding: "utf8", env });
  assert.equal(strict.status, 1, strict.stderr);
  const strictResult = JSON.parse(strict.stdout);
  assert.equal(strictResult.status, "invalid");
  assert.ok(strictResult.errors.some((error) => /missing private\/provenance\//u.test(error)));
  assert.equal(strictResult.output, undefined);
});


test("CLI restricts public-checkout to validate and rejects malformed uses", () => {
  const otherCommands = ["help", "discover", "inspect", "list", "plan", "cook", "axes", "observations", "observe", "compare-rubrics", "build-registry", "recover"];
  const cases = [
    ...otherCommands.map((command) => [command, "--public-checkout"]),
    ["--public-checkout"],
    ["validate", "--public-checkout=false"],
    ["validate", "--public-checkout", "--public-checkout"],
    ["validate", "--public-checkout", "false"],
    ["validate", "--public-checkout", "--help"],
    ["validate", "--catalog", "--public-checkout"],
  ];
  for (const argv of cases) {
    const result = spawnSync(process.execPath, ["bin/taste.mjs", ...argv, "--json"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 1, argv.join(" "));
    assert.equal(JSON.parse(result.stderr).error.code, "INVALID_ARGUMENT", argv.join(" "));
    assert.equal(result.stdout, "", argv.join(" "));
  }
});

test("taste list prints legacy catalogs whose recipes carry domain instead of cuisines", async (t) => {
  const { mkdir } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-legacy-list-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (relative, value) => { await mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await writeFile(path.join(root, relative), JSON.stringify(value)); };
  await write("catalog/domains.json", { schemaVersion: 1, domains: [{ id: "old-domain", label: "Old", description: "Legacy domain.", order: 1 }] });
  await write("catalog/tags.json", { schemaVersion: 1, tags: ["one"] });
  await write("catalog/variants.json", { schemaVersion: 1, variants: [] });
  await write("catalog/recipes/old-domain/alpha/recipe.json", {
    schemaVersion: 1, id: "alpha", version: "1.0.0", status: "ready", title: "Alpha", summary: "A legacy recipe for listing.", domain: "old-domain", origin: "textbook",
    originNote: "A legacy fixture for list output.", tags: ["one"], kind: "session",
    harness: { workspace: "read", web: "disabled", capabilities: [] }, setup: { instructions: "Use only the supplied material.", fixtures: [] },
    turns: [{ id: "ask", role: "prompt", content: "Perform alpha." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 4096 } },
    validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "Output exists.", target: "output/session.json" }] },
  });
  // The CLI resolves its catalog from its own location, so run a copy of it beside the legacy catalog.
  for (const entry of ["bin", "lib", "package.json"]) await cp(path.join(repoRoot, entry), path.join(root, entry), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(root, "bin/taste.mjs"), "list"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^alpha\told-domain\t/);
});

test("recover rebuilds the registry with the configured base path, and only after a successful recovery", async (t) => {
  const root = await fixtureRepository(t);
  const registryFile = path.join(root, "public", "data", "registry.json");
  const outcome = { status: "accepted", recovered: true, dishId: "dish_stub" };
  const seen = [];
  await assert.rejects(recover(root, {
    attemptId: "attempt_x",
    basePath: "/kitchen/",
    recoverAttempt: async () => { throw new Error("recovery refused"); },
  }), /recovery refused/);
  assert.equal(await readFile(registryFile, "utf8").catch(() => null), null);
  const result = await recover(root, {
    attemptId: "attempt_x",
    basePath: "/kitchen/",
    recoverAttempt: async (args) => { seen.push(args.attemptId); return outcome; },
  });
  assert.deepEqual(result, outcome);
  assert.deepEqual(seen, ["attempt_x"]);
  assert.equal(JSON.parse(await readFile(registryFile, "utf8")).basePath, "/kitchen/");
});
