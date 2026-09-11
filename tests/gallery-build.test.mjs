import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("the static gallery preserves the cooked public catalog", async () => {
  const [html, registry, recipeBook, assets] = await Promise.all([
    readFile(path.join(root, "dist", "index.html"), "utf8"),
    readFile(path.join(root, "dist", "data", "registry.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "dist", "data", "recipe-book.json"), "utf8").then(JSON.parse),
    readdir(path.join(root, "dist", "assets")),
  ]);
  assert.match(html, /<title>Tasting Kitchen<\/title>/);
  assert.match(html, /\/assets\//);
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.cuisines.length, 9);
  assert.equal(registry.configurations.length, 7);
  assert.equal(registry.recipes.length, 17);
  assert.equal(registry.dishes.length, 27);
  assert.equal(registry.dishes.filter((dish) => dish.artifact.kind === "web").length, 20);
  const sessionDishes = registry.dishes.filter((dish) => dish.artifact.kind === "session");
  assert.equal(sessionDishes.length, 7);
  assert.ok(sessionDishes.every((dish) => dish.identity.variantId === "codex-luna-xhigh"));
  assert.ok(registry.dishes.every((dish) => dish.status === "accepted"));
  assert.equal(registry.dishes.filter((dish) => dish.identity.variantId === "codex-luna-xhigh").length, 17);
  assert.equal(registry.dishes.filter((dish) => dish.identity.variantId === "cursor-composer-2-5").length, 10);
  assert.ok(registry.dishes.filter((dish) => dish.identity.variantId === "codex-luna-xhigh").every((dish) => dish.identity.reasoningEffort === "xhigh"));
  assert.ok(registry.dishes.filter((dish) => dish.identity.variantId === "cursor-composer-2-5").every((dish) => dish.identity.reasoningEffort === "adaptive" && dish.identity.requestedModel === "composer-2.5[fast=false]" && dish.identity.observedModel === "Composer 2.5"));
  assert.ok(registry.dishes.every((dish) => dish.identity.serviceTier === "default"));
  assert.deepEqual(registry.reviews, []);
  assert.equal(registry.recipeRevisions.length, 17);
  assert.equal(registry.menus.length, 5);
  assert.equal(registry.menuRevisions.length, 5);
  assert.equal(recipeBook.recipes.length, 17);
  assert.equal(recipeBook.archivedCount, 54);
  const webRecipes = recipeBook.recipes.filter((entry) => entry.recipe.kind === "web");
  const sessionRecipes = recipeBook.recipes.filter((entry) => entry.recipe.kind === "session");
  assert.equal(webRecipes.length, 10);
  assert.ok(webRecipes.every((entry) => entry.dishCount === 2));
  assert.equal(sessionRecipes.length, 7);
  assert.ok(sessionRecipes.every((entry) => entry.dishCount === 1));
  assert.ok(assets.some((filename) => filename.endsWith(".js")));
  assert.ok(assets.some((filename) => filename.endsWith(".css")));
  const javascript = await Promise.all(
    assets.filter((filename) => filename.endsWith(".js")).map((filename) => readFile(path.join(root, "dist", "assets", filename), "utf8")),
  );
  const productionJavaScript = javascript.join("\n");
  const productionCss = (await Promise.all(
    assets.filter((filename) => filename.endsWith(".css")).map((filename) => readFile(path.join(root, "dist", "assets", filename), "utf8")),
  )).join("\n");
  assert.match(productionJavaScript, /Agent review/);
  assert.match(productionJavaScript, /Artifact review/);
  for (const label of ["Session artifact", "Prompt", "Model response", "Tool & action evidence", "Raw session JSON"]) assert.match(productionJavaScript, new RegExp(label.replace("&", "&(?:amp;)?")));
  assert.doesNotMatch(productionJavaScript, /viewer__label/);
  assert.doesNotMatch(productionCss, /viewer__label/);
});


test("the built site publishes only active Dishes and their selected public artifact files", async () => {
  const registry = JSON.parse(await readFile(path.join(root, "dist/data/registry.json"), "utf8"));
  const activeRecipeIds = new Set(registry.recipes.map((recipe) => recipe.id));
  assert.equal(activeRecipeIds.size, 17);
  assert.equal(registry.dishes.length, 27);
  assert.ok(registry.dishes.every((dish) => activeRecipeIds.has(dish.recipe.id)));
  assert.ok(registry.recipeRevisions.every((revision) => activeRecipeIds.has(revision.recipeId)));
  assert.ok(registry.menuRevisions.every((menu) => menu.recipes.every((recipe) => activeRecipeIds.has(recipe.recipeId))));
  assert.ok(registry.dishes.every((dish) => dish.artifact.files.every((file) => !/^(?:fixtures|private)\//u.test(file.path))));
});
