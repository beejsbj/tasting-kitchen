import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash } from "../lib/taste/catalog.mjs";
import { buildRegistry } from "../lib/taste/registry.mjs";
import { coverage } from "../lib/taste/index.mjs";

async function json(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value)}\n`);
}

test("builds the gallery registry without private runtime data", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-registry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await json(path.join(root, "catalog/cuisines.json"), { schemaVersion: 1, cuisines: [
    { id: "talk", label: "Talk", description: "Conversation tests.", order: 10 },
  ] });
  await json(path.join(root, "catalog/tags.json"), { schemaVersion: 1, tags: ["presence"] });
  await json(path.join(root, "catalog/configurations.json"), { schemaVersion: 1, configurations: [{ id: "v", label: "V", provider: "openai", model: "m", harness: "codex-cli", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: [] }] });
  const recipe = {
    schemaVersion: 1, id: "talk-once", version: "1.0.0", status: "ready", title: "Talk once clearly", summary: "Respond clearly to one conversational prompt.", cuisines: ["talk"], origin: "textbook", originNote: "A conventional conversation test.", tags: ["presence"], kind: "session",
    harness: { workspace: "read", web: "disabled", capabilities: [] }, setup: { instructions: "Respond.", fixtures: [] }, turns: [{ id: "ask", role: "prompt", content: "Hello." }],
    output: { kind: "session", entry: "output/session.json", include: ["output/session.json"], limits: { maxFiles: 2, maxBytes: 4096 } },
    validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "Transcript exists.", target: "output/session.json" }] },
  };
  await json(path.join(root, "catalog/recipes/talk/talk-once/recipe.json"), recipe);
  const recipeHash = computeRecipeHash(recipe, {});
  const dishId = "dish_talk-once_v_one";
  await mkdir(path.join(root, "dishes", dishId, "artifact/output"), { recursive: true });
  await json(path.join(root, "dishes", dishId, "artifact/output/session.json"), { turns: [] });
  await json(path.join(root, "dishes", dishId, "validation.json"), { passed: true });
  await json(path.join(root, "dishes", dishId, "trace.json"), { turns: [] });
  await json(path.join(root, "dishes", dishId, "dish.json"), {
    schemaVersion: 1, id: dishId, recipe: { id: "talk-once", version: "1.0.0", hash: recipeHash }, executedAt: "2026-08-14T12:00:00.000Z",
    identity: { variantId: "v", provider: "openai", requestedModel: "m", observedModel: "m", harness: "codex-cli", harnessVersion: "fake", reasoningEffort: "high", serviceTier: "default", configHash: `sha256:${"2".repeat(64)}` }, status: "accepted",
    artifact: { kind: "session", entry: "artifact/output/session.json", files: [{ path: "artifact/output/session.json", sha256: "0".repeat(64), bytes: 13 }], treeHash: `sha256:${"3".repeat(64)}` }, validation: { passed: true, report: "validation.json" }, publicTrace: "trace.json", dishHash: `sha256:${"4".repeat(64)}`,
  });
  await json(path.join(root, "dishes", dishId, "inputs.json"), { schemaVersion: 1, recipe: { id: "talk-once", hash: recipeHash }, fixtures: [] });
  await json(path.join(root, "dishes", dishId, "receipt.json"), { schemaVersion: 1, configuration: { id: "v", model: "m" }, skill: null });
  const reviewId = "review_talk-once_v_mobile";
  const reviewFile = path.join(root, "reviews", `${reviewId}.json`);
  const review = {
    schemaVersion: 1,
    id: reviewId,
    dishId,
    dishHash: `sha256:${"4".repeat(64)}`,
    reviewer: "Test reviewer",
    reviewerKind: "agent",
    reviewedAt: "2026-08-14T12:30:00.000Z",
    probes: [{
      id: "mobile",
      device: "Mobile browser emulation",
      viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      verdict: "issue",
      finding: "An agent observer found clipped content at this viewport.",
      details: { method: "Browser visual inspection", path: "artifact/output/session.json" },
    }],
  };
  await json(reviewFile, review);
  await mkdir(path.join(root, "private/runtime"), { recursive: true });
  await writeFile(path.join(root, "private/runtime/secret.txt"), "never publish");

  const { output, registry } = await buildRegistry({ repoRoot: root, now: new Date("2026-08-14T12:00:00.000Z") });
  assert.equal(registry.basePath, "/");
  assert.match(registry.configurations[0].configHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(registry.recipes.length, 1);
  assert.equal(registry.recipes[0].title, "Talk once clearly");
  assert.equal(registry.recipes[0].recipeHash, recipeHash);
  for (const gone of ["recipeRevisions", "configurationRevisions", "skillRevisions", "menuRevisions"]) assert.equal(registry[gone], undefined, gone);
  assert.deepEqual(registry.dishes[0].inputs, { fixtures: [] });
  assert.equal(registry.dishes[0].receipt.configuration.id, "v");
  assert.equal(registry.dishes[0].artifactBase, `/dishes/${dishId}/`);
  assert.deepEqual(registry.reviews, [review]);
  const artifactUrl = `${registry.dishes[0].artifactBase}${registry.dishes[0].artifact.entry}`;
  assert.equal(artifactUrl, `/dishes/${dishId}/artifact/output/session.json`);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, "public", artifactUrl.replace(/^\//u, "")), "utf8")),
    { turns: [] },
  );
  assert.equal(JSON.stringify(registry).includes("private/runtime"), false);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), registry);

  const subpath = await buildRegistry({ repoRoot: root, basePath: "/kitchen/" });
  assert.equal(subpath.registry.dishes[0].artifactBase, `/kitchen/dishes/${dishId}/`);

  // Display edits do not move the recipe hash.
  await json(path.join(root, "catalog/recipes/talk/talk-once/recipe.json"), { ...recipe, title: "Current public title", summary: "Current public summary." });
  const retitled = await buildRegistry({ repoRoot: root });
  assert.equal(retitled.registry.recipes[0].title, "Current public title");
  assert.equal(retitled.registry.recipes[0].recipeHash, recipeHash);

  // A brief edit moves the hash; the Dish stays under its recipe and keeps its own hash.
  const rewritten = { ...recipe, turns: [{ id: "ask", role: "prompt", content: "Hello again." }] };
  await json(path.join(root, "catalog/recipes/talk/talk-once/recipe.json"), rewritten);
  const edited = await buildRegistry({ repoRoot: root });
  assert.equal(edited.registry.recipes.length, 1);
  assert.notEqual(edited.registry.recipes[0].recipeHash, recipeHash);
  assert.equal(edited.registry.dishes.length, 1);
  assert.equal(edited.registry.dishes[0].recipe.hash, recipeHash);

  const staleFixture = path.join(root, "public", "data", "fixtures", "stale", "failed-attempt.txt");
  await mkdir(path.dirname(staleFixture), { recursive: true });
  await writeFile(staleFixture, "must not survive public staging");
  await buildRegistry({ repoRoot: root });
  await assert.rejects(readFile(staleFixture), /ENOENT/);

  await json(path.join(root, "catalog/recipes/talk/talk-once/recipe.json"), { ...recipe, status: "hidden" });
  const hidden = await buildRegistry({ repoRoot: root });
  assert.deepEqual(hidden.registry.dishes, []);
  assert.deepEqual(hidden.registry.reviews, []);
  await assert.rejects(readFile(path.join(root, "public", "dishes", dishId, "dish.json")), /ENOENT/);

  await json(reviewFile, { ...review, dishHash: `sha256:${"5".repeat(64)}` });
  await assert.rejects(() => buildRegistry({ repoRoot: root }), /does not match immutable dish hash/);
});

test("Menu coverage is measured against current recipe hashes and derives Repeat cells", () => {
  const menu = { id: "visual-ui", recipes: ["one", "two"] };
  const recipes = [{ id: "one", recipeHash: "sha256:one" }, { id: "two", recipeHash: "sha256:two" }];
  const dishes = [
    { id: "dish_later", executedAt: "2026-08-15T00:00:00.000Z", recipe: { id: "one", hash: "sha256:one" }, identity: { configHash: "config-a" } },
    { id: "dish_first", executedAt: "2026-08-14T00:00:00.000Z", recipe: { id: "one", hash: "sha256:one" }, identity: { configHash: "config-a" } },
    { id: "dish_old_brief", executedAt: "2026-08-13T00:00:00.000Z", recipe: { id: "two", hash: "sha256:two-old" }, identity: { configHash: "config-a" } },
  ];
  const result = coverage(menu, recipes, dishes, ["config-a"]);
  assert.equal(result.numerator, 1);
  assert.equal(result.denominator, 2);
  assert.equal(result.cells[0].dishes.length, 2);
  assert.equal(result.cells[1].represented, false, "a Dish of an older brief does not cover the current one");
});
