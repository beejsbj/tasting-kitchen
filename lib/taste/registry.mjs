import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { computeConfigHash, loadCatalog } from "./catalog.mjs";
import { copyTree, pathExists, scanPublicTree, writeJsonAtomic } from "./files.mjs";
import { loadAxisSets, loadObservations } from "./observations.mjs";
import { buildRecipeBook } from "./recipe-book.mjs";
import { withRecipeFilesLock } from "./recipe-files-lock.mjs";
import { loadConfigurationRevisions, loadMenuRevisions, loadMenus, loadRecipeRevisions } from "./revisions.mjs";
import { loadSkillRevisions } from "./skills.mjs";

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
    if (publicScan) await scanPublicTree(directory);
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
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fixture.id)) throw new Error(`Unsafe fixture id in immutable revision: ${fixture.id}`);
  const extension = path.posix.extname(fixture.path ?? "");
  return /^[.][a-z0-9]{1,12}$/iu.test(extension) ? `${fixture.id}${extension}` : fixture.id;
}

function publicRecipe(recipe, revision, basePath) {
  const definition = {
    schemaVersion: recipe.schemaVersion,
    id: recipe.id,
    version: revision.version,
    status: "ready",
    // Dish browsing names the executed recipe. Current authoring metadata lives
    // in the separate Recipe Book, including uncooked and edited definitions.
    title: revision.display.title,
    summary: revision.display.summary,
    cuisines: revision.display.cuisines,
    origin: revision.display.lineage,
    tags: recipe.tags,
    kind: revision.execution.kind,
    harness: revision.execution.harness,
    setup: revision.execution.setup,
    turns: revision.execution.turns,
    output: revision.execution.output,
    validation: revision.execution.validation,
    recipeHash: revision.hash,
    ...(recipe.recipeHash === revision.hash ? {} : { currentRevisionHash: recipe.recipeHash }),
  };
  return {
    ...definition,
    ...(revision.execution.skills === undefined ? {} : { skills: revision.execution.skills }),
    setup: {
      ...definition.setup,
      fixtures: definition.setup.fixtures.filter((fixture) => fixture.public !== false).map((fixture) => ({
        ...fixture,
        url: withBase(basePath, `data/fixtures/${revision.hash.slice("sha256:".length)}/${fixtureFilename(fixture)}`),
      })),
    },
  };
}

async function stageFixtures(revisions, publicRoot) {
  const dataRoot = path.join(publicRoot, "data");
  const target = path.join(dataRoot, "fixtures");
  const staging = path.join(dataRoot, `.taste-fixtures-${process.pid}`);
  const backup = path.join(dataRoot, `.taste-fixtures-backup-${process.pid}`);
  await mkdir(dataRoot, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  for (const revision of revisions) {
    for (const fixture of revision.fixtures) {
      if (fixture.public === false || fixture.contentBase64 === undefined) continue;
      const filename = path.join(staging, revision.hash.slice("sha256:".length), fixtureFilename(fixture));
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, Buffer.from(fixture.contentBase64, "base64"));
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
        fixtures: revision.execution.setup.fixtures.filter((fixture) => fixture.public !== false).map((fixture) => ({
          ...fixture,
          sha256: fixtureById.get(fixture.id)?.sha256,
          url: withBase(basePath, `data/fixtures/${revision.hash.slice("sha256:".length)}/${fixtureFilename(fixture)}`),
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
  const [configurationRevisions, recipeRevisions, menus, menuRevisions, axisSets, skillRevisions] = await Promise.all([
    loadConfigurationRevisions(repoRoot), loadRecipeRevisions(repoRoot), loadMenus(repoRoot), loadMenuRevisions(repoRoot), loadAxisSets(repoRoot), loadSkillRevisions(repoRoot),
  ]);
  const visibleDishIds = new Set(dishes.map((dish) => dish.id));
  const observations = await loadObservations(repoRoot, { dishes: allDishes, axisSets, visibleDishIds });
  await stageDishes(repoRoot, path.join(repoRoot, "public"), dishes);
  const acceptedRevisionKeys = new Set(dishes.map((dish) => `${dish.recipe.id}:${dish.recipe.hash}`));
  const acceptedConfigurationHashes = new Set(dishes.map((dish) => dish.identity.configHash));
  const acceptedSkillHashes = new Set(dishes.map((dish) => dish.skill?.hash).filter(Boolean));
  const publicRecipeRevisions = recipeRevisions.filter((revision) => acceptedRevisionKeys.has(`${revision.recipeId}:${revision.hash}`));
  await stageFixtures(publicRecipeRevisions, path.join(repoRoot, "public"));
  const publicDishes = dishes.map((dish) => ({ ...dish, artifactBase: withBase(basePath, `dishes/${dish.id}/`) }));
  const visibleMenuRevisions = menuRevisions.map((revision) => publicMenuRevision(revision, dishes)).filter(Boolean);
  const visibleMenuIds = new Set(visibleMenuRevisions.map((revision) => revision.menuId));
  const registry = {
    schemaVersion: 2,
    generatedAt: now.toISOString(),
    basePath,
    cuisines: catalog.cuisines,
    tags: catalog.tags,
    configurations: catalog.configurations.map((configuration) => ({ ...configuration, configHash: computeConfigHash(configuration) })),
    configurationRevisions: configurationRevisions.filter((revision) => acceptedConfigurationHashes.has(revision.hash)),
    skills: catalog.skills.map((skill) => ({ id: skill.id, label: skill.label, summary: skill.summary, source: skill.source, entry: skill.entry, skillHash: skill.skillHash })),
    skillRevisions: skillRevisions.filter((revision) => acceptedSkillHashes.has(revision.hash)).map(({ files, ...revision }) => ({ ...revision, fileCount: files.length })),
    recipes: catalog.recipes.filter((recipe) => visibleRecipeIds.has(recipe.id)).flatMap((recipe) => {
      const candidates = publicRecipeRevisions.filter((revision) => revision.recipeId === recipe.id);
      if (!candidates.length) return [];
      const latest = candidates.sort((left, right) => {
        const leftTime = Math.max(...dishes.filter((dish) => dish.recipe.id === left.recipeId && dish.recipe.hash === left.hash).map((dish) => Date.parse(dish.executedAt)));
        const rightTime = Math.max(...dishes.filter((dish) => dish.recipe.id === right.recipeId && dish.recipe.hash === right.hash).map((dish) => Date.parse(dish.executedAt)));
        return rightTime - leftTime || right.hash.localeCompare(left.hash);
      })[0];
      return [publicRecipe(recipe, latest, basePath)];
    }),
    dishes: publicDishes,
    reviews,
    axisSets,
    observations,
    recipeRevisions: publicRecipeRevisions.map((revision) => publicRecipeRevision(revision, basePath)),
    menus: menus.filter((menu) => visibleMenuIds.has(menu.id)),
    menuRevisions: visibleMenuRevisions,
  };
  await writeJsonAtomic(output, registry);
  const book = await buildRecipeBook(repoRoot);
  await writeJsonAtomic(path.join(repoRoot, "public", "data", "recipe-book.json"), book);
  return { output, registry };
}

export async function buildRegistry(options = {}) {
  return withRecipeFilesLock(options.repoRoot, () => buildRegistryUnlocked(options));
}
