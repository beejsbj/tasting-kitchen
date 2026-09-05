import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("the static gallery and public registry are complete", async () => {
  const [html, registry, assets] = await Promise.all([
    readFile(path.join(root, "dist", "index.html"), "utf8"),
    readFile(path.join(root, "dist", "data", "registry.json"), "utf8").then(JSON.parse),
    readdir(path.join(root, "dist", "assets")),
  ]);
  assert.match(html, /<title>Tasting Kitchen<\/title>/);
  assert.match(html, /\/assets\//);
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.cuisines.length, 9);
  assert.equal(registry.configurations.length, 5);
  assert.ok(registry.recipes.length >= 3);
  for (const recipe of registry.recipes) {
    assert.ok(registry.dishes.some((dish) => dish.recipe.id === recipe.id));
    assert.ok(recipe.cuisines.length > 0);
  }
  assert.equal(registry.recipes.filter((recipe) => recipe.status === "hidden" || recipe.status === "draft").length, 0);
  assert.equal(registry.reviews.length, 1);
  assert.equal(registry.reviews[0].dishId, "dish_responsive-product-launch_codex-sol-high_20260814200923790_c1b11b6e");
  assert.equal(registry.reviews[0].reviewerKind, "agent");
  assert.equal(registry.reviews[0].probes[0].verdict, "issue");
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


test("public artifact and fixture URLs resolve inside the built site", async () => {
  const registry = JSON.parse(await readFile(path.join(root, "dist/data/registry.json"), "utf8"));
  for (const dish of registry.dishes) {
    const artifact = await readFile(path.join(root, "dist", dish.artifactBase, dish.artifact.entry));
    assert.ok(artifact.length > 0);
    assert.ok(registry.recipeRevisions.some((revision) => revision.recipeId === dish.recipe.id && revision.hash === dish.recipe.hash));
  }
  for (const revision of registry.recipeRevisions) {
    for (const fixture of revision.execution.setup.fixtures) {
      const body = await readFile(path.join(root, "dist", fixture.url));
      assert.ok(body.length > 0);
    }
  }
  for (const menu of registry.menuRevisions) {
    assert.ok(menu.recipes.length > 0);
    for (const member of menu.recipes) assert.ok(registry.dishes.some((dish) => dish.recipe.id === member.recipeId && dish.recipe.hash === member.recipeHash));
  }
});
