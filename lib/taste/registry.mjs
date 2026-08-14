import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { computeConfigHash, loadCatalog } from "./catalog.mjs";
import { copyTree, pathExists, scanPublicTree, writeJsonAtomic } from "./files.mjs";

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function loadDishes(repoRoot) {
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
    dishes.push({ ...manifest, artifactBase: `/model-tasting/dishes/${manifest.id}/` });
  }
  return dishes.sort((a, b) => a.id.localeCompare(b.id));
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

function publicRecipe(recipe) {
  const definition = { ...recipe };
  delete definition.sourcePath;
  delete definition.fixtureHashes;
  return {
    ...definition,
    recipeDir: path.posix.dirname(recipe.sourcePath),
  };
}

export async function buildRegistry({
  repoRoot,
  output = path.join(repoRoot, "public", "data", "registry.json"),
  now = new Date(),
} = {}) {
  const catalog = await loadCatalog(repoRoot);
  const dishes = await loadDishes(repoRoot);
  const reviews = await loadReviews(repoRoot, dishes);
  await stageDishes(repoRoot, path.join(repoRoot, "public"));
  const registry = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    basePath: "/model-tasting/",
    domains: catalog.domains,
    tags: catalog.tags,
    variants: catalog.variants.map((variant) => ({ ...variant, configHash: computeConfigHash(variant) })),
    recipes: catalog.recipes.map(publicRecipe),
    dishes,
    reviews,
  };
  await writeJsonAtomic(output, registry);
  return { output, registry };
}
