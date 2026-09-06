import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { buildRecipeBook, saveRecipeEdits } from "../lib/taste/recipe-book.mjs";
import { loadRecipeFromGitHub, saveRecipeViaGitHub, verifyGitHubAccess } from "../src/lib/github-recipe-save.ts";

const api = "https://api.github.com/repos/beejsbj/tasting-kitchen";

function digest(parts) {
  return `sha256:${createHash("sha256").update(Buffer.concat(parts.map((part) => Buffer.from(part)))).digest("hex")}`;
}

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function blob(bytes) {
  return { content: Buffer.from(bytes).toString("base64"), encoding: "base64" };
}

async function json(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const sourcePath = "catalog/recipes/ui/editable-card/recipe.json";
  const sourceFixture = "<template><main>original</main></template>\n";
  const dataFixture = '{"title":"original"}\n';
  const imageFixture = Buffer.from([0, 1, 2, 3]);
  const privateFixture = "private source\n";
  const record = {
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
  const fixtures = new Map([
    ["catalog/recipes/ui/editable-card/fixtures/card.vue", sourceFixture],
    ["catalog/recipes/ui/editable-card/fixtures/card.json", dataFixture],
    ["catalog/recipes/ui/editable-card/fixtures/card.png", imageFixture],
    ["catalog/recipes/ui/editable-card/fixtures/private.txt", privateFixture],
  ]);
  const fileHash = digest([
    `${sourcePath}\0`, `${JSON.stringify(record, null, 2)}\n`,
    "\0card-source\0fixtures/card.vue\0", sourceFixture,
    "\0card-data\0fixtures/card.json\0", dataFixture,
    "\0card-image\0fixtures/card.png\0", imageFixture,
    "\0private-note\0fixtures/private.txt\0", privateFixture,
  ]);
  const entry = {
    recipe: { ...record, recipeHash: "sha256:old", setup: { ...record.setup, fixtures: record.setup.fixtures.filter((item) => item.public) } },
    sourcePath, fileHash, dishCount: 2,
    fixtures: [
      { ...record.setup.fixtures[0], text: sourceFixture },
      { ...record.setup.fixtures[1], text: dataFixture },
      { ...record.setup.fixtures[2], text: null },
    ],
  };
  return { record, entry, fixtures };
}

function installGitHubMock(t, { changeBeforeUpdate = false } = {}) {
  const { record, entry, fixtures } = fixture();
  const treeSha = "tree-current";
  const headSha = "commit-current";
  const requests = [];
  const source = `${JSON.stringify(record, null, 2)}\n`;
  const tree = [
    { path: entry.sourcePath, mode: "100644", type: "blob", sha: "blob-recipe" },
    ...[...fixtures.keys()].map((path, index) => ({ path, mode: "100644", type: "blob", sha: `blob-${index}` })),
  ];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const count = requests.length;
    if (url === `${api}/git/ref/heads/main`) return response({ object: { sha: changeBeforeUpdate && count > 7 ? "commit-advanced" : headSha } });
    if (url === `${api}/git/commits/${headSha}`) return response({ tree: { sha: treeSha } });
    if (url === `${api}/git/trees/${treeSha}?recursive=1`) return response({ truncated: false, tree });
    if (url === `${api}/git/blobs/blob-recipe`) return response(blob(source));
    const fixtureIndex = tree.findIndex((item) => item.path !== entry.sourcePath && `${api}/git/blobs/${item.sha}` === url) - 1;
    if (fixtureIndex >= 0) return response(blob([...fixtures.values()][fixtureIndex]));
    if (url === `${api}/git/trees` && init.method === "POST") return response({ sha: "tree-new" }, 201);
    if (url === `${api}/git/commits` && init.method === "POST") return response({ sha: "commit-new" }, 201);
    if (url === `${api}/git/refs/heads/main` && init.method === "PATCH") return response({ object: { sha: "commit-new" } });
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${url}`);
  };
  t.after(() => { globalThis.fetch = previous; });
  return { entry, requests };
}

test("verifyGitHubAccess authenticates only to GitHub and checks the configured branch", async (t) => {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (url === "https://api.github.com/user") return response({ login: "beejsbj" });
    if (url === api) return response({ permissions: { push: true } });
    if (url === `${api}/git/ref/heads/main`) return response({ object: { sha: "current" } });
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(() => { globalThis.fetch = previous; });
  assert.deepEqual(await verifyGitHubAccess("  test-token  ", "main"), { login: "beejsbj" });
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.match(request.url, /^https:\/\/api\.github\.com\//);
    assert.equal(request.init.headers.Authorization, "Bearer test-token");
    assert.equal(request.url.includes("test-token"), false);
  }
});

test("saveRecipeViaGitHub creates one tree and one commit for every changed recipe file", async (t) => {
  const { entry, requests } = installGitHubMock(t);
  const saved = await saveRecipeViaGitHub({ token: "test-token", branch: "main", entry, updates: {
    title: "Edited card", summary: entry.recipe.summary, setupInstructions: "Use the revised source.", turns: entry.recipe.turns,
    fixtureEdits: [{ id: "card-source", text: "<template><main>revised</main></template>\n" }, { id: "card-data", text: '{"title":"revised"}\n' }],
  } });
  assert.equal(saved.recipe.title, "Edited card");
  assert.equal(saved.recipe.version, "1.0.1");
  assert.match(saved.recipe.recipeHash, /^sha256:[a-f0-9]{64}$/);
  const expected = fixture().record;
  expected.setup.instructions = "Use the revised source.";
  expected.version = "1.0.1";
  assert.equal(saved.recipe.recipeHash, computeRecipeHash(expected, {
    "card-source": sha256("<template><main>revised</main></template>\n"),
    "card-data": sha256('{"title":"revised"}\n'),
    "card-image": sha256(Buffer.from([0, 1, 2, 3])),
    "private-note": sha256("private source\n"),
  }));
  const treeRequest = requests.find((request) => request.url === `${api}/git/trees` && request.init.method === "POST");
  assert.ok(treeRequest);
  const treeBody = JSON.parse(treeRequest.init.body);
  assert.equal(treeBody.base_tree, "tree-current");
  assert.deepEqual(treeBody.tree.map((item) => item.path), [
    "catalog/recipes/ui/editable-card/recipe.json",
    "catalog/recipes/ui/editable-card/fixtures/card.vue",
    "catalog/recipes/ui/editable-card/fixtures/card.json",
  ]);
  assert.equal(requests.filter((request) => request.url === `${api}/git/commits` && request.init.method === "POST").length, 1);
  assert.equal(requests.filter((request) => request.url === `${api}/git/refs/heads/main` && request.init.method === "PATCH").length, 1);
});

test("local and GitHub recipe saves preserve one validation and hashing contract", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-save-parity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = fixture();
  await json(path.join(root, "catalog/cuisines.json"), { schemaVersion: 1, cuisines: [{ id: "ui", label: "UI", description: "UI recipes.", order: 1 }] });
  await json(path.join(root, "catalog/tags.json"), { schemaVersion: 1, tags: ["design"] });
  await json(path.join(root, "catalog/configurations.json"), { schemaVersion: 1, configurations: [] });
  await json(path.join(root, source.entry.sourcePath), source.record);
  for (const [filename, bytes] of source.fixtures) {
    const target = path.join(root, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const updates = {
    title: "Edited card",
    summary: source.entry.recipe.summary,
    setupInstructions: "Use the revised source.",
    turns: source.entry.recipe.turns,
    fixtureEdits: [
      { id: "card-source", text: "<template><main>revised</main></template>\n" },
      { id: "card-data", text: '{"title":"revised"}\n' },
    ],
  };
  const localEntry = (await buildRecipeBook(root)).recipes[0];
  const local = await saveRecipeEdits(root, { recipeId: source.record.id, expectedHash: localEntry.fileHash, updates });
  const { entry } = installGitHubMock(t);
  const hosted = await saveRecipeViaGitHub({ token: "test-token", branch: "main", entry, updates });

  assert.equal(hosted.fileHash, local.fileHash);
  assert.equal(hosted.recipe.recipeHash, local.recipe.recipeHash);
  assert.equal(hosted.recipe.version, local.recipe.version);
  assert.deepEqual(hosted.recipe.turns, local.recipe.turns);
  assert.deepEqual(hosted.fixtures, local.fixtures);
});

test("a stale fixture hash prevents every GitHub write", async (t) => {
  const { entry, requests } = installGitHubMock(t);
  entry.fileHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  await assert.rejects(
    saveRecipeViaGitHub({ token: "test-token", branch: "main", entry, updates: { title: "Edited card", summary: entry.recipe.summary, setupInstructions: entry.recipe.setup.instructions, turns: entry.recipe.turns, fixtureEdits: [] } }),
    /changed since it was opened/,
  );
  assert.equal(requests.some((request) => request.init.method === "POST" || request.init.method === "PATCH"), false);
});

test("GitHub saves require a prompt as the first turn", async (t) => {
  const { entry, requests } = installGitHubMock(t);
  await assert.rejects(
    saveRecipeViaGitHub({ token: "test-token", branch: "main", entry, updates: {
      title: entry.recipe.title,
      summary: entry.recipe.summary,
      setupInstructions: entry.recipe.setup.instructions,
      turns: [{ id: "revise", role: "correction", content: "Start with a correction." }],
      fixtureEdits: [],
    } }),
    /first turn must have the prompt role/u,
  );
  assert.equal(requests.some((request) => request.init.method === "POST" || request.init.method === "PATCH"), false);
});

test("loadRecipeFromGitHub reads the pinned branch version without a write", async (t) => {
  const { entry, requests } = installGitHubMock(t);
  const loaded = await loadRecipeFromGitHub({ token: "test-token", branch: "main", entry });
  assert.equal(loaded.recipe.title, "Editable card");
  assert.equal(loaded.fileHash, entry.fileHash);
  assert.equal(loaded.fixtures.find((item) => item.id === "card-image").text, null);
  assert.equal(requests.some((request) => request.init.method === "POST" || request.init.method === "PATCH"), false);
});

test("a branch advance during the save never resets its reference", async (t) => {
  const { entry, requests } = installGitHubMock(t, { changeBeforeUpdate: true });
  await assert.rejects(
    saveRecipeViaGitHub({ token: "test-token", branch: "main", entry, updates: { title: "Edited card", summary: entry.recipe.summary, setupInstructions: entry.recipe.setup.instructions, turns: entry.recipe.turns, fixtureEdits: [] } }),
    /branch changed while saving/,
  );
  assert.equal(requests.some((request) => request.url === `${api}/git/refs/heads/main` && request.init.method === "PATCH"), false);
});
