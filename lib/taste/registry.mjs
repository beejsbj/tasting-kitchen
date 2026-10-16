import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { computeConfigHash, fixtureSourceFile, loadCatalog } from "./catalog.mjs";
import { copyTree, pathExists, scanPublicTree, writeJsonAtomic } from "./files.mjs";
import { loadAxisSets, loadObservations } from "./observations.mjs";
import { buildRecipeBook } from "./recipe-book.mjs";
import { INPUTS_DIRECTORY, readDishSidecars } from "./receipts.mjs";
import { withRecipeFilesLock } from "./recipe-files-lock.mjs";
import { loadMenus } from "./menus.mjs";

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function loadDishTree(root, { publicScan }) {
  if (!await pathExists(root)) return [];
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const dishes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const manifest = await readJson(path.join(directory, "dish.json"));
    if (manifest.status !== "accepted") throw new Error(`Non-accepted ${publicScan ? "public" : "private"} dish found: ${entry.name}`);
    if (manifest.id !== entry.name) throw new Error(`Dish directory does not match manifest id: ${entry.name}`);
    if (publicScan && manifest.visibility === "private") throw new Error(`Private dish stored in the public tree: ${entry.name}`);
    if (publicScan) await scanPublicTree(directory, { skip: [INPUTS_DIRECTORY] });
    dishes.push(manifest);
  }
  return dishes.sort((a, b) => new Date(a.executedAt) - new Date(b.executedAt) || a.id.localeCompare(b.id));
}

/** Accepted public Dishes under `dishes/`. */
export async function loadDishes(repoRoot) {
  return loadDishTree(path.join(repoRoot, "dishes"), { publicScan: true });
}

/** Accepted Dishes of private Recipes under the ignored `private/dishes/` tree. Never published. */
export async function loadPrivateDishes(repoRoot) {
  return loadDishTree(path.join(repoRoot, "private", "dishes"), { publicScan: false });
}

async function loadReviews(repoRoot, dishes, visibleDishIds = new Set(dishes.map((dish) => dish.id))) {
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
    ids.add(review.id);
    const dish = dishById.get(review.dishId);
    if (!dish) throw new Error(`Review ${review.id} references unknown dish: ${review.dishId}`);
    if (review.dishHash !== dish.dishHash) throw new Error(`Review ${review.id} does not match immutable dish hash: ${review.dishId}`);
    if (!visibleDishIds.has(dish.id)) continue;
    reviews.push(review);
  }
  return reviews;
}

async function stageDishes(repoRoot, publicRoot, dishes) {
  const source = path.join(repoRoot, "dishes");
  const target = path.join(publicRoot, "dishes");
  const staging = path.join(publicRoot, `.taste-dishes-${process.pid}`);
  const backup = path.join(publicRoot, `.taste-dishes-backup-${process.pid}`);
  await mkdir(publicRoot, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  for (const dish of dishes) {
    const sourceDirectory = path.join(source, dish.id);
    if (!await pathExists(sourceDirectory)) throw new Error(`Accepted Dish is missing its source directory: ${dish.id}`);
    await copyTree(sourceDirectory, path.join(staging, dish.id));
  }
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

function fixtureFilename(fixture) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fixture.id)) throw new Error(`Unsafe fixture id: ${fixture.id}`);
  const extension = path.posix.extname(fixture.path ?? "");
  return /^[.][a-z0-9]{1,12}$/iu.test(extension) ? `${fixture.id}${extension}` : fixture.id;
}

function publicRecipe(recipe, basePath) {
  return {
    schemaVersion: recipe.schemaVersion,
    id: recipe.id,
    version: recipe.version,
    status: "ready",
    title: recipe.title,
    summary: recipe.summary,
    cuisines: recipe.cuisines,
    origin: recipe.origin,
    tags: recipe.tags,
    kind: recipe.kind,
    harness: recipe.harness,
    turns: recipe.turns,
    output: recipe.output,
    validation: recipe.validation,
    recipeHash: recipe.recipeHash,
    ...(recipe.presentation === undefined ? {} : { presentation: recipe.presentation }),
    ...(recipe.skills === undefined ? {} : { skills: recipe.skills }),
    setup: {
      ...recipe.setup,
      // Current fixtures: what the brief says now. A Dish's own inputs/ sidecar says what it received.
      fixtures: recipe.setup.fixtures.filter((fixture) => fixture.public !== false).map((fixture) => ({
        ...fixture,
        url: withBase(basePath, `data/fixtures/${recipe.recipeHash.slice("sha256:".length)}/${fixtureFilename(fixture)}`),
      })),
    },
  };
}

async function stageFixtures(repoRoot, recipes, publicRoot) {
  const dataRoot = path.join(publicRoot, "data");
  const target = path.join(dataRoot, "fixtures");
  const staging = path.join(dataRoot, `.taste-fixtures-${process.pid}`);
  const backup = path.join(dataRoot, `.taste-fixtures-backup-${process.pid}`);
  await mkdir(dataRoot, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  for (const recipe of recipes) {
    const recipeDirectory = path.dirname(path.join(repoRoot, recipe.sourcePath));
    for (const fixture of recipe.setup.fixtures) {
      if (fixture.public === false) continue;
      const filename = path.join(staging, recipe.recipeHash.slice("sha256:".length), fixtureFilename(fixture));
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, await readFile(fixtureSourceFile(repoRoot, recipeDirectory, recipe, fixture)));
    }
  }
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
}

/** Attach each Dish's sidecars: what it received (inputs) and what it ran as (receipt). Absent sidecars stay absent. */
async function withSidecars(repoRoot, dish, basePath) {
  const { inputs, receipt } = await readDishSidecars(path.join(repoRoot, "dishes", dish.id));
  const artifactBase = withBase(basePath, `dishes/${dish.id}/`);
  return {
    ...dish,
    artifactBase,
    ...(inputs ? { inputs: { fixtures: inputs.fixtures.map((fixture) => ({
      ...fixture,
      ...(fixture.public ? { url: `${artifactBase}${INPUTS_DIRECTORY}/${fixture.mountAs.split("/").map(encodeURIComponent).join("/")}` } : {}),
    })) } } : {}),
    ...(receipt ? { receipt } : {}),
  };
}

async function buildRegistryUnlocked({
  repoRoot,
  output = path.join(repoRoot, "public", "data", "registry.json"),
  now = new Date(),
  basePath = "/",
} = {}) {
  const catalog = await loadCatalog(repoRoot);
  const allDishes = await loadDishes(repoRoot);
  const visibleRecipeIds = new Set(catalog.recipes.filter((recipe) => recipe.status === "ready" && recipe.visibility !== "private").map((recipe) => recipe.id));
  const dishes = allDishes.filter((dish) => visibleRecipeIds.has(dish.recipe.id));
  const reviews = await loadReviews(repoRoot, allDishes, new Set(dishes.map((dish) => dish.id)));
  const [menus, axisSets] = await Promise.all([loadMenus(repoRoot), loadAxisSets(repoRoot)]);
  const visibleDishIds = new Set(dishes.map((dish) => dish.id));
  const observations = await loadObservations(repoRoot, { dishes: allDishes, axisSets, visibleDishIds });
  await stageDishes(repoRoot, path.join(repoRoot, "public"), dishes);
  const recipesWithDishes = new Set(dishes.map((dish) => dish.recipe.id));
  const publicRecipes = catalog.recipes.filter((recipe) => visibleRecipeIds.has(recipe.id) && recipesWithDishes.has(recipe.id));
  await stageFixtures(repoRoot, publicRecipes, path.join(repoRoot, "public"));
  const publicDishes = await Promise.all(dishes.map((dish) => withSidecars(repoRoot, dish, basePath)));
  const publicRecipeIds = new Set(publicRecipes.map((recipe) => recipe.id));
  const registry = {
    schemaVersion: 3,
    generatedAt: now.toISOString(),
    basePath,
    cuisines: catalog.cuisines,
    tags: catalog.tags,
    configurations: catalog.configurations.map((configuration) => ({ ...configuration, configHash: computeConfigHash(configuration) })),
    skills: catalog.skills.map((skill) => ({ id: skill.id, label: skill.label, summary: skill.summary, source: skill.source, entry: skill.entry, skillHash: skill.skillHash })),
    recipes: publicRecipes.map((recipe) => publicRecipe(recipe, basePath)),
    dishes: publicDishes,
    reviews,
    axisSets,
    observations,
    // A Menu is a plain list; it is shown once every recipe on it is on the counter.
    menus: menus.filter((menu) => menu.recipes.every((recipeId) => publicRecipeIds.has(recipeId))),
  };
  await writeJsonAtomic(output, registry);
  const book = await buildRecipeBook(repoRoot);
  await writeJsonAtomic(path.join(repoRoot, "public", "data", "recipe-book.json"), book);
  return { output, registry };
}

export async function buildRegistry(options = {}) {
  return withRecipeFilesLock(options.repoRoot, () => buildRegistryUnlocked(options));
}
