import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { buildRecipeBook, recipeBookMiddleware, saveRecipeEdits } from "../lib/taste/recipe-book.mjs";
import { buildRegistry } from "../lib/taste/registry.mjs";

async function json(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-recipe-book-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await json(path.join(root, "catalog/cuisines.json"), { schemaVersion: 1, cuisines: [{ id: "ui", label: "UI", description: "UI recipes.", order: 1 }] });
  await json(path.join(root, "catalog/tags.json"), { schemaVersion: 1, tags: ["design"] });
  await json(path.join(root, "catalog/configurations.json"), { schemaVersion: 1, configurations: [] });
  const recipe = {
    schemaVersion: 1, id: "editable-card", version: "1.0.0", status: "ready", title: "Editable card", summary: "An authored card recipe.", cuisines: ["ui"], origin: "textbook", originNote: "Test source.", tags: ["design"], kind: "web",
    harness: { workspace: "write", web: "enabled", capabilities: [] },
    setup: { instructions: "Use the supplied source.", fixtures: [
      { id: "card-source", path: "fixtures/card.vue", mountAs: "src/Card.vue", public: true, mediaType: "text/x-vue", editable: true },
      { id: "card-data", path: "fixtures/card.json", mountAs: "src/card.json", public: true, mediaType: "application/json", editable: true },
      { id: "card-image", path: "fixtures/card.png", mountAs: "src/card.png", public: true, mediaType: "image/png" },
      { id: "private-note", path: "fixtures/private.txt", mountAs: "private.txt", public: false, mediaType: "text/plain" },
    ] },
    turns: [{ id: "make-card", role: "prompt", content: "Build the card." }],
    output: { kind: "web", entry: "dist/index.html", include: ["dist/**"], limits: { maxFiles: 10, maxBytes: 100000 } },
    validation: { mode: "files", checks: [{ id: "entry", type: "file-exists", required: true, description: "Output exists.", target: "dist/index.html" }] },
  };
  const recipeDir = path.join(root, "catalog/recipes/ui/editable-card");
  await json(path.join(recipeDir, "recipe.json"), recipe);
  await mkdir(path.join(recipeDir, "fixtures"), { recursive: true });
  await writeFile(path.join(recipeDir, "fixtures/card.vue"), "<template><main>original</main></template>\n");
  await writeFile(path.join(recipeDir, "fixtures/card.json"), '{"title":"original"}\n');
  await writeFile(path.join(recipeDir, "fixtures/card.png"), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(recipeDir, "fixtures/private.txt"), "private fixture must never be returned\n");
  const dishId = "dish_editable_card";
  await json(path.join(root, "dishes", dishId, "dish.json"), { id: dishId, status: "accepted", recipe: { id: recipe.id, hash: "sha256:old" }, identity: { configHash: "sha256:fixture" }, executedAt: "2026-09-01T00:00:00.000Z" });
  return { root, recipeDir };
}

test("recipe book exposes current visible authoring definitions without private fixtures", async (t) => {
  const { root } = await fixture(t);
  const book = await buildRecipeBook(root);
  assert.equal(book.schemaVersion, 1);
  assert.equal(book.archivedCount, 0);
  assert.equal(book.recipes[0].dishCount, 1);
  assert.match(book.recipes[0].recipe.recipeHash, /^sha256:/);
  assert.equal(book.recipes[0].fixtures.length, 3);
  assert.match(book.recipes[0].fixtures.find((item) => item.id === "card-source").text, /original/);
  assert.equal(book.recipes[0].fixtures.find((item) => item.id === "card-image").text, null);
  assert.equal(JSON.stringify(book).includes("private fixture"), false);
  assert.equal(JSON.stringify(book).includes("private-note"), false);

  const recipeFile = path.join(root, "catalog/recipes/ui/editable-card/recipe.json");
  const hidden = JSON.parse(await readFile(recipeFile, "utf8"));
  hidden.status = "draft";
  await json(recipeFile, hidden);
  assert.deepEqual(await buildRecipeBook(root), { schemaVersion: 1, recipes: [], archivedCount: 0 });

  hidden.status = "hidden";
  await json(recipeFile, hidden);
  assert.deepEqual(await buildRecipeBook(root), { schemaVersion: 1, recipes: [], archivedCount: 1 });
});

test("static recipe-book sidecar retains public source fixture text", async (t) => {
  const { root } = await fixture(t);
  await buildRegistry({ repoRoot: root });
  const sidecar = JSON.parse(await readFile(path.join(root, "public/data/recipe-book.json"), "utf8"));
  assert.match(sidecar.recipes[0].fixtures.find((item) => item.id === "card-source").text, /original/);
  assert.equal(JSON.stringify(sidecar).includes("private fixture"), false);
});

test("saving authoring edits persists current docs without changing Dish snapshots", async (t) => {
  const { root, recipeDir } = await fixture(t);
  const beforeDish = await readFile(path.join(root, "dishes/dish_editable_card/dish.json"), "utf8");
  const before = (await buildRecipeBook(root)).recipes[0];
  const saved = await saveRecipeEdits(root, {
    recipeId: "editable-card",
    expectedHash: before.fileHash,
    updates: {
      title: "Edited card",
      setupInstructions: "Use the revised source.",
      turns: [{ id: "make-card", role: "prompt", content: "Build the revised card." }],
      fixtureEdits: [{ id: "card-source", text: "<template><main>revised</main></template>\n" }],
    },
  });
  assert.equal(saved.recipe.title, "Edited card");
  assert.equal(saved.recipe.version, "1.0.1");
  assert.match(saved.fixtures[0].text, /revised/);
  assert.equal(await readFile(path.join(root, "dishes/dish_editable_card/dish.json"), "utf8"), beforeDish);
  assert.equal((await buildRecipeBook(root)).recipes[0].fileHash, saved.fileHash);
  await assert.rejects(
    saveRecipeEdits(root, { recipeId: "editable-card", expectedHash: before.fileHash, updates: { title: "Stale" } }),
    (error) => error.code === "CONFLICT",
  );
  assert.match(await readFile(path.join(recipeDir, "fixtures/card.vue"), "utf8"), /revised/);
  await writeFile(path.join(recipeDir, "fixtures/card.vue"), "<template><main>external change</main></template>\n");
  await assert.rejects(
    saveRecipeEdits(root, { recipeId: "editable-card", expectedHash: saved.fileHash, updates: { title: "Stale fixture" } }),
    (error) => error.code === "CONFLICT",
  );
});

test("metadata saves with complete unchanged execution fields do not bump version", async (t) => {
  const { root } = await fixture(t);
  const before = (await buildRecipeBook(root)).recipes[0];
  const saved = await saveRecipeEdits(root, {
    recipeId: "editable-card",
    expectedHash: before.fileHash,
    updates: {
      title: "Renamed card",
      summary: before.recipe.summary,
      setupInstructions: before.recipe.setup.instructions,
      turns: before.recipe.turns,
      fixtureEdits: before.fixtures.filter((item) => item.text !== null).map(({ id, text }) => ({ id, text })),
    },
  });
  assert.equal(saved.recipe.title, "Renamed card");
  assert.equal(saved.recipe.version, "1.0.0");
});

test("recipe edits require a prompt as the first turn", async (t) => {
  const { root } = await fixture(t);
  const before = (await buildRecipeBook(root)).recipes[0];
  await assert.rejects(
    saveRecipeEdits(root, {
      recipeId: "editable-card",
      expectedHash: before.fileHash,
      updates: { turns: [{ id: "revise", role: "correction", content: "Start with a correction." }] },
    }),
    (error) => error.code === "VALIDATION" && /first turn.*prompt/u.test(error.message),
  );
});

test("a locked read recovers an interrupted recipe-directory swap", async (t) => {
  const { root, recipeDir } = await fixture(t);
  const backup = `${recipeDir}.recipe-book-backup`;
  const staging = `${recipeDir}.recipe-book-staging`;
  await rename(recipeDir, backup);
  await cp(backup, staging, { recursive: true });

  const book = await buildRecipeBook(root);
  assert.equal(book.recipes[0].recipe.title, "Editable card");
  await assert.rejects(readFile(path.join(backup, "recipe.json")), /ENOENT/u);
  await assert.rejects(readFile(path.join(staging, "recipe.json")), /ENOENT/u);
});

test("invalid, unsafe, and symlinked edits do not mutate recipe sources", async (t) => {
  const { root, recipeDir } = await fixture(t);
  const before = await buildRecipeBook(root);
  const recipeFile = path.join(recipeDir, "recipe.json");
  const original = await readFile(recipeFile, "utf8");
  await assert.rejects(
    saveRecipeEdits(root, { recipeId: "../editable-card", expectedHash: before.recipes[0].fileHash, updates: { title: "No" } }),
    (error) => error.code === "VALIDATION",
  );
  await assert.rejects(
    saveRecipeEdits(root, { recipeId: "editable-card", expectedHash: before.recipes[0].fileHash, updates: { fixtureEdits: [{ id: "missing", text: "No" }] } }),
    (error) => error.code === "VALIDATION",
  );
  await assert.rejects(
    saveRecipeEdits(root, { recipeId: "editable-card", expectedHash: before.recipes[0].fileHash, updates: { title: "bad" } }),
    (error) => error.code === "VALIDATION",
  );
  await assert.rejects(
    saveRecipeEdits(root, { recipeId: "editable-card", expectedHash: before.recipes[0].fileHash, updates: { fixtureEdits: [{ id: "card-image", text: "not binary" }] } }),
    (error) => error.code === "VALIDATION",
  );
  await assert.rejects(
    saveRecipeEdits(root, { recipeId: "editable-card", expectedHash: before.recipes[0].fileHash, updates: { fixtureEdits: [{ id: "card-data", text: "{" }] } }),
    (error) => error.code === "VALIDATION",
  );
  assert.equal(await readFile(recipeFile, "utf8"), original);
  const source = path.join(recipeDir, "fixtures/card.vue");
  const target = path.join(recipeDir, "fixtures/outside.vue");
  await writeFile(target, "outside\n");
  await rm(source);
  await symlink(target, source);
  await assert.rejects(
    saveRecipeEdits(root, { recipeId: "editable-card", expectedHash: before.recipes[0].fileHash, updates: { title: "No" } }),
    (error) => error.code === "UNSAFE_PATH",
  );
  assert.equal(await readFile(recipeFile, "utf8"), original);
});

test("simultaneous saves using one file hash permit only one writer", async (t) => {
  const { root } = await fixture(t);
  const before = (await buildRecipeBook(root)).recipes[0];
  const results = await Promise.allSettled([
    saveRecipeEdits(root, { recipeId: "editable-card", expectedHash: before.fileHash, updates: { title: "First save" } }),
    saveRecipeEdits(root, { recipeId: "editable-card", expectedHash: before.fileHash, updates: { title: "Second save" } }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "CONFLICT").length, 1);
});

function response() {
  const result = { headers: {}, body: "", statusCode: 0 };
  return {
    ...result,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; },
  };
}

test("middleware rejects cross-origin or non-loopback PATCH requests", async (t) => {
  const { root } = await fixture(t);
  const handler = recipeBookMiddleware(root);
  const req = Object.assign(Readable.from([Buffer.from("{}")]), {
    method: "PATCH", url: "/api/recipes/editable-card",
    headers: { host: "localhost:5173", origin: "https://example.test", "content-type": "application/json" },
  });
  const res = response();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(JSON.parse(res.body).error.code, "FORBIDDEN");
  const get = Object.assign(Readable.from([]), { method: "GET", url: "/api/recipes", headers: { host: "kitchen.example" } });
  const getResponse = response();
  await handler(get, getResponse);
  assert.equal(getResponse.statusCode, 403);
});
