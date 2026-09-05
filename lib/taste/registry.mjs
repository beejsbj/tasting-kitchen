import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { computeConfigHash, loadCatalog } from "./catalog.mjs";
import { copyTree, pathExists, scanPublicTree, writeJsonAtomic } from "./files.mjs";
import { loadMenuRevisions, loadMenus, loadRecipeRevisions } from "./revisions.mjs";

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

export async function loadDishes(repoRoot) {
  const root = path.join(repoRoot, "dishes");
  if (!await pathExists(root)) return [];
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const dishes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const manifest = await readJson(path.join(directory, "dish.json"));
    if (manifest.status !== "accepted") throw new Error(`Non-accepted public dish found: ${entry.name}`);
    if (manifest.id !== entry.name) throw new Error(`Dish directory does not match manifest id: ${entry.name}`);
    await scanPublicTree(directory);
    dishes.push(manifest);
  }
  return dishes.sort((a, b) => new Date(a.executedAt) - new Date(b.executedAt) || a.id.localeCompare(b.id));
}

async function loadReviews(repoRoot, dishes) {
  const root = path.join(repoRoot, "reviews");
  if (!await pathExists(root)) return [];
  await scanPublicTree(root);
  const dishById = new Map(dishes.map((dish) => [dish.id, dish]));
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const reviews = [];
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name) !== ".json") throw new Error(`Review directory must contain only JSON files: ${entry.name}`);
    const review = await readJson(path.join(root, entry.name));
    if (`${review.id}.json` !== entry.name) throw new Error(`Review filename does not match review id: ${entry.name}`);
    if (ids.has(review.id)) throw new Error(`Duplicate review id: ${review.id}`);
    const dish = dishById.get(review.dishId);
    if (!dish) throw new Error(`Review ${review.id} references unknown dish: ${review.dishId}`);
    if (review.dishHash !== dish.dishHash) throw new Error(`Review ${review.id} does not match immutable dish hash: ${review.dishId}`);
    ids.add(review.id);
    reviews.push(review);
  }
  return reviews;
}

async function stageDishes(repoRoot, publicRoot) {
  const source = path.join(repoRoot, "dishes");
  const target = path.join(publicRoot, "dishes");
  const staging = path.join(publicRoot, `.taste-dishes-${process.pid}`);
  const backup = path.join(publicRoot, `.taste-dishes-backup-${process.pid}`);
  await mkdir(publicRoot, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  if (await pathExists(source)) await copyTree(source, staging);
  else await mkdir(staging, { recursive: true });
  const hadTarget = await pathExists(target);
  if (hadTarget) await rename(target, backup);
  try {
    await rename(staging, target);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    if (hadTarget && await pathExists(backup)) await rename(backup, target);
    throw error;
  }
  return target;
}

function withBase(basePath, relative) {
  return `${basePath.replace(/\/$/u, "")}/${relative.replace(/^\//u, "")}`;
}

function publicRecipe(recipe, basePath) {
  const definition = { ...recipe };
  delete definition.sourcePath;
  delete definition.fixtureHashes;
  return {
    ...definition,
    setup: {
      ...definition.setup,
      fixtures: definition.setup.fixtures.map((fixture) => ({
        ...fixture,
        url: withBase(basePath, `data/fixtures/current/${recipe.id}/${fixture.id}`),
      })),
    },
  };
}

async function stageFixtures(repoRoot, revisions, publicRoot) {
  for (const revision of revisions) {
    for (const fixture of revision.fixtures) {
      const filename = path.join(publicRoot, "data", "fixtures", revision.hash.slice("sha256:".length), fixture.id);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, Buffer.from(fixture.contentBase64, "base64"));
    }
  }
  // Current public Recipes are the accepted Recipes. Their current fixture links
  // are intentionally separate from the immutable revision links.
  const catalog = await loadCatalog(repoRoot);
  const acceptedIds = new Set(revisions.map((revision) => revision.recipeId));
  for (const recipe of catalog.recipes.filter((recipe) => acceptedIds.has(recipe.id))) {
    const recipeDir = path.dirname(path.join(repoRoot, recipe.sourcePath));
    for (const fixture of recipe.setup.fixtures) {
      const filename = path.join(publicRoot, "data", "fixtures", "current", recipe.id, fixture.id);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, await readFile(path.join(recipeDir, fixture.path)));
    }
  }
}

function publicRecipeRevision(revision, basePath) {
  const fixtureById = new Map(revision.fixtures.map((fixture) => [fixture.id, fixture]));
  return {
    recipeId: revision.recipeId,
    hash: revision.hash,
    version: revision.version,
    execution: {
      ...revision.execution,
      setup: {
        ...revision.execution.setup,
        fixtures: revision.execution.setup.fixtures.map((fixture) => ({
          ...fixture,
          sha256: fixtureById.get(fixture.id)?.sha256,
          url: withBase(basePath, `data/fixtures/${revision.hash.slice("sha256:".length)}/${fixture.id}`),
        })),
      },
    },
    display: revision.display,
  };
}

function publicMenuRevision(revision, dishes) {
  const represented = new Set(dishes.map((dish) => `${dish.recipe.id}:${dish.recipe.hash}`));
  return represented.size && revision.recipes.every((recipe) => represented.has(`${recipe.recipeId}:${recipe.recipeHash}`))
    ? revision
    : null;
}

export async function buildRegistry({
  repoRoot,
  output = path.join(repoRoot, "public", "data", "registry.json"),
  now = new Date(),
  basePath = "/",
} = {}) {
  const catalog = await loadCatalog(repoRoot);
  const dishes = await loadDishes(repoRoot);
  const reviews = await loadReviews(repoRoot, dishes);
  const [recipeRevisions, menus, menuRevisions] = await Promise.all([
    loadRecipeRevisions(repoRoot), loadMenus(repoRoot), loadMenuRevisions(repoRoot),
  ]);
  await stageDishes(repoRoot, path.join(repoRoot, "public"));
  await stageFixtures(repoRoot, recipeRevisions, path.join(repoRoot, "public"));
  const publicDishes = dishes.map((dish) => ({ ...dish, artifactBase: withBase(basePath, `dishes/${dish.id}/`) }));
  const publicRecipeIds = new Set(dishes.map((dish) => dish.recipe.id));
  const visibleMenuRevisions = menuRevisions.map((revision) => publicMenuRevision(revision, dishes)).filter(Boolean);
  const visibleMenuIds = new Set(visibleMenuRevisions.map((revision) => revision.menuId));
  const registry = {
    schemaVersion: 2,
    generatedAt: now.toISOString(),
    basePath,
    cuisines: catalog.cuisines,
    tags: catalog.tags,
    configurations: catalog.configurations.map((configuration) => ({ ...configuration, configHash: computeConfigHash(configuration) })),
    recipes: catalog.recipes.filter((recipe) => publicRecipeIds.has(recipe.id)).map((recipe) => publicRecipe(recipe, basePath)),
    dishes: publicDishes,
    reviews,
    recipeRevisions: recipeRevisions.map((revision) => publicRecipeRevision(revision, basePath)),
    menus: menus.filter((menu) => visibleMenuIds.has(menu.id)),
    menuRevisions: visibleMenuRevisions,
  };
  await writeJsonAtomic(output, registry);
  return { output, registry };
}
