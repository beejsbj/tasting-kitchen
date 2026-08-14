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
  assert.match(html, /<title>Model Tasting<\/title>/);
  assert.match(html, /\/model-tasting\/assets\//);
  assert.equal(registry.domains.length, 9);
  assert.equal(registry.variants.length, 5);
  assert.equal(registry.recipes.length, 54);
  assert.equal(registry.recipes.filter((recipe) => recipe.status === "hidden").length, 3);
  assert.equal(registry.reviews.length, 1);
  assert.equal(registry.reviews[0].dishId, "dish_responsive-product-launch_codex-sol-high_20260814200923790_c1b11b6e");
  assert.equal(registry.reviews[0].reviewerKind, "agent");
  assert.equal(registry.reviews[0].probes[0].verdict, "issue");
  assert.ok(assets.some((filename) => filename.endsWith(".js")));
  assert.ok(assets.some((filename) => filename.endsWith(".css")));
  const javascript = await Promise.all(
    assets.filter((filename) => filename.endsWith(".js")).map((filename) => readFile(path.join(root, "dist", "assets", filename), "utf8")),
  );
  assert.match(javascript.join("\n"), /Agent review/);
  assert.match(javascript.join("\n"), /Artifact review/);
});
