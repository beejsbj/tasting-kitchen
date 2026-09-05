import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { computeRecipeHash, hashCanonical, sha256 } from "./catalog.mjs";
import { writeJsonAtomic } from "./files.mjs";

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

function executionOf(recipe) {
  return {
    kind: recipe.kind,
    harness: recipe.harness,
    setup: recipe.setup,
    turns: recipe.turns,
    output: recipe.output,
    validation: recipe.validation,
  };
}

export function computeMenuRevisionHash(menu) {
  return hashCanonical({
    menuId: menu.menuId ?? menu.id,
    recipes: menu.recipes.map((recipe) => ({ recipeId: recipe.recipeId, recipeHash: recipe.recipeHash })),
  });
}

export function createRecipeRevision(recipe, fixtureBytes) {
  const execution = executionOf(recipe);
  const fixtureHashes = Object.fromEntries(fixtureBytes.map((fixture) => [fixture.id, fixture.sha256]));
  const hash = computeRecipeHash(execution, fixtureHashes);
  return {
    schemaVersion: 1,
    recipeId: recipe.id,
    hash,
    version: recipe.version,
    execution,
    fixtures: fixtureBytes,
    display: {
      title: recipe.title,
      summary: recipe.summary,
      lineage: recipe.origin,
      cuisines: recipe.cuisines,
    },
  };
}

export function assertRecipeRevision(revision) {
  if (!revision || typeof revision !== "object") throw new Error("Recipe revision must be an object");
  const fixtureHashes = Object.fromEntries((revision.fixtures ?? []).map((fixture) => [fixture.id, fixture.sha256]));
  const hash = computeRecipeHash(revision.execution, fixtureHashes);
  if (revision.hash !== hash) throw new Error(`Recipe revision ${revision.recipeId} does not match its execution hash`);
  for (const fixture of revision.fixtures ?? []) {
    const bytes = Buffer.from(fixture.contentBase64, "base64");
    if (sha256(bytes) !== fixture.sha256) throw new Error(`Recipe revision ${revision.recipeId} fixture ${fixture.id} bytes do not match hash`);
  }
  return revision;
}

export async function loadRecipeRevisions(repoRoot) {
  const root = path.join(repoRoot, "catalog", "revisions", "recipes");
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const revisions = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(async (entry) => assertRecipeRevision(await readJson(path.join(root, entry.name)))));
  const keys = new Set();
  for (const revision of revisions) {
    const key = `${revision.recipeId}:${revision.hash}`;
    if (keys.has(key)) throw new Error(`Duplicate recipe revision ${key}`);
    keys.add(key);
  }
  return revisions;
}

export async function freezeRecipeRevision(repoRoot, recipe) {
  const recipeDirectory = path.dirname(path.join(repoRoot, recipe.sourcePath));
  const fixtures = await Promise.all(recipe.setup.fixtures.map(async (fixture) => {
    const bytes = await readFile(path.join(recipeDirectory, fixture.path));
    return { ...fixture, sha256: recipe.fixtureHashes[fixture.id], contentBase64: bytes.toString("base64") };
  }));
  const revision = createRecipeRevision(recipe, fixtures);
  if (revision.hash !== recipe.recipeHash) throw new Error(`Refusing to freeze ${recipe.id}: recipe hash drifted`);
  const directory = path.join(repoRoot, "catalog", "revisions", "recipes");
  const filename = path.join(directory, `${recipe.id}--${revision.hash.slice("sha256:".length)}.json`);
  await mkdir(directory, { recursive: true });
  try {
    const existing = assertRecipeRevision(await readJson(filename));
    if (existing.recipeId !== revision.recipeId || existing.hash !== revision.hash) throw new Error(`Recipe revision path collision for ${recipe.id}`);
  } catch (error) {
    if (!error?.code && !error.message?.includes("ENOENT")) throw error;
    await writeJsonAtomic(filename, revision);
  }
  return revision;
}

export async function loadMenus(repoRoot) {
  const root = path.join(repoRoot, "catalog", "menus");
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => readJson(path.join(root, entry.name))));
}

export async function loadMenuRevisions(repoRoot) {
  const root = path.join(repoRoot, "catalog", "revisions", "menus");
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const revisions = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => readJson(path.join(root, entry.name))));
  for (const revision of revisions) {
    if (revision.hash !== computeMenuRevisionHash(revision)) throw new Error(`Menu revision ${revision.menuId} does not match its pinned recipes`);
  }
  return revisions;
}

export async function freezeMenuRevision(repoRoot, menu, recipes) {
  const pinned = [];
  for (const recipeId of menu.recipes) {
    const recipe = recipes.find((candidate) => candidate.id === recipeId);
    if (!recipe) throw new Error(`Menu ${menu.id} references unknown recipe ${recipeId}`);
    const revision = await freezeRecipeRevision(repoRoot, recipe);
    pinned.push({ recipeId: recipe.id, recipeHash: revision.hash });
  }
  const revision = {
    schemaVersion: 1,
    menuId: menu.id,
    title: menu.title,
    cuisines: menu.cuisines,
    recipes: pinned,
  };
  revision.hash = computeMenuRevisionHash(revision);
  const directory = path.join(repoRoot, "catalog", "revisions", "menus");
  const filename = path.join(directory, `${menu.id}--${revision.hash.slice("sha256:".length)}.json`);
  await mkdir(directory, { recursive: true });
  try {
    const existing = await readJson(filename);
    if (existing.hash !== revision.hash) throw new Error(`Menu revision path collision for ${menu.id}`);
  } catch (error) {
    if (!error?.code && !error.message?.includes("ENOENT")) throw error;
    await writeJsonAtomic(filename, revision);
  }
  return revision;
}
