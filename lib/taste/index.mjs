import { listRecipes, loadCatalog, planSelection } from "./catalog.mjs";
import { buildRegistry, loadDishes, loadPrivateDishes } from "./registry.mjs";
import { getHarnessAdapter, isPersonalEnvironment } from "./harness-adapters.mjs";
import { usesConnections } from "./environments.mjs";
import { skillKey } from "./skills.mjs";
import { executePlan } from "./runner.mjs";
import { recoverAttempt } from "./recovery.mjs";
import { pruneCookDirectories } from "./cook-directories.mjs";
import { loadMenus } from "./menus.mjs";
import { axisSetsForContext, evaluateDishWithJev, loadAxisSets, loadObservations } from "./observations.mjs";
import { compareRubricsFromFile } from "./rubric-comparison.mjs";
import { loadNoDishes, loadPrivateNoDishes } from "./no-dishes.mjs";
import { loadVerdicts, writeVerdict } from "./verdicts.mjs";

export async function discover(repoRoot) {
  const [catalog, menus, dishes, privateDishes, axisSets, noDishes] = await Promise.all([
    loadCatalog(repoRoot), loadMenus(repoRoot), loadDishes(repoRoot), loadPrivateDishes(repoRoot), loadAxisSets(repoRoot), loadNoDishes(repoRoot),
  ]);
  const observations = await loadObservations(repoRoot, { dishes, axisSets });
  const verdicts = await loadVerdicts(repoRoot, { plates: [...dishes, ...noDishes] });
  return {
    cuisines: catalog.cuisines,
    configurations: catalog.configurations,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- root is a host path and stays out of the listing
    skills: catalog.skills.map(({ root, files, ...skill }) => ({ ...skill, fileCount: files.length })),
    recipes: catalog.recipes.map((recipe) => ({ id: recipe.id, title: recipe.title, cuisines: recipe.cuisines, status: recipe.status, visibility: recipe.visibility ?? "public", recipeHash: recipe.recipeHash, skillLayers: recipe.skills?.layers ?? [] })),
    privateDishes: privateDishes.map((dish) => ({ id: dish.id, recipe: dish.recipe, identity: dish.identity, skill: dish.skill ?? null, executedAt: dish.executedAt })),
    menus,
    dishes,
    noDishes,
    verdicts,
    axisSets,
    observations,
  };
}

export async function inspect(repoRoot, { recipeId, menuId } = {}) {
  if ([recipeId, menuId].filter((value) => value !== undefined).length !== 1) {
    throw new Error("inspect requires exactly one of recipeId or menuId");
  }
  const [catalog, menus, dishes] = await Promise.all([loadCatalog(repoRoot), loadMenus(repoRoot), loadDishes(repoRoot)]);
  if (recipeId) {
    const recipe = catalog.recipes.find((candidate) => candidate.id === recipeId);
    if (!recipe) throw new Error(`Unknown recipe id: ${recipeId}`);
    const privateDishes = (await loadPrivateDishes(repoRoot)).filter((dish) => dish.recipe.id === recipeId);
    const noDishes = [...await loadNoDishes(repoRoot), ...await loadPrivateNoDishes(repoRoot)].filter((plate) => plate.recipe.id === recipeId);
    return { recipe, dishes: [...dishes.filter((dish) => dish.recipe.id === recipeId), ...privateDishes], noDishes };
  }
  const menu = menus.find((candidate) => candidate.id === menuId);
  if (!menu) throw new Error(`Unknown menu id: ${menuId}`);
  return { menu };
}

/**
 * Coverage of a Menu against the current recipes: a cell is represented when a
 * Dish or a No Dish exists for that recipe's current hash (and, optionally, the
 * given configuration and skill layers). Pass both as `dishes`: a No Dish is a
 * cooked outcome, so "could not make it" covers a cell as surely as a Dish.
 */
export function coverage(menu, recipes, dishes, configurationHashes = null, skillHashes = null) {
  const configurations = configurationHashes ? new Set(configurationHashes) : null;
  const skills = skillHashes ? new Set(skillHashes) : null;
  const cells = menu.recipes.map((recipeId) => {
    const recipeHash = recipes.find((recipe) => recipe.id === recipeId)?.recipeHash ?? null;
    const matches = recipeHash ? dishes.filter((dish) => dish.recipe.id === recipeId && dish.recipe.hash === recipeHash && (!configurations || configurations.has(dish.identity.configHash)) && (!skills || skills.has(skillKey(dish)))) : [];
    return { recipeId, recipeHash, dishes: matches, represented: matches.length > 0 };
  });
  return { numerator: cells.filter((cell) => cell.represented).length, denominator: cells.length, cells };
}

export async function plan(repoRoot, options = {}) {
  return planFromCatalog(repoRoot, await loadCatalog(repoRoot), options);
}

async function planFromCatalog(repoRoot, catalog, options) {
  if (options.menuId && (options.recipeIds ?? options.flightIds ?? options.flight) !== undefined) {
    throw new Error("plan accepts either menuId or recipeIds, not both");
  }
  if (!options.menuId) return planSelection(catalog, options);
  const menus = await loadMenus(repoRoot);
  const menu = menus.find((candidate) => candidate.id === options.menuId);
  if (!menu) throw new Error(`Unknown menu id: ${options.menuId}`);
  const result = planSelection(catalog, { ...options, recipeIds: menu.recipes });
  return { ...result, selection: { type: "menu", menuId: menu.id, recipeIds: menu.recipes } };
}

// An explicit basePath wins; otherwise the deployment's TASTE_BASE_PATH. buildRegistry defaults undefined to "/".
const registryBasePath = (options) => options.basePath ?? (options.env ?? process.env).TASTE_BASE_PATH;

export async function cook(repoRoot, options = {}) {
  // One snapshot: the plan a caller reviews is the catalog the runner executes.
  const catalog = await loadCatalog(repoRoot);
  const planResult = await planFromCatalog(repoRoot, catalog, options);
  if (!options.intent || !["fill-missing", "repeat"].includes(options.intent)) throw new Error("cook requires intent fill-missing or repeat");
  if (options.publishPersonal === true && !isPersonalEnvironment(planResult.variant)) {
    // INVALID_ARGUMENT is how the CLI recognises a usage error.
    throw Object.assign(new Error("--publish-personal applies only to a configuration with a personal (snapshot or live) environment"), { code: "INVALID_ARGUMENT" });
  }
  if (options.allowConnections === true && !usesConnections(planResult.variant)) {
    throw Object.assign(new Error("--allow-connections applies only to a configuration with connections on"), { code: "INVALID_ARGUMENT" });
  }
  // A No Dish covers its cell: fill-missing never retries a chef fault; only Repeat cooks it again.
  const existing = [...await loadDishes(repoRoot), ...await loadPrivateDishes(repoRoot), ...await loadNoDishes(repoRoot), ...await loadPrivateNoDishes(repoRoot)];
  const requestedSkill = planResult.skill?.hash ?? "none";
  // A snapshot cell is covered only by a Dish that saw his setup as it is now, as an edited brief uncovers a cell.
  const setupDigest = await getHarnessAdapter(planResult.variant.harness).currentSetupDigest?.({ variant: planResult.variant, env: options.env ?? {} }) ?? null;
  const covered = (item) => existing.some((dish) => dish.recipe.id === item.recipeId && dish.recipe.hash === item.recipeHash && dish.identity.configHash === planResult.variant.configHash && skillKey(dish) === requestedSkill
    && (dish.identity.setupDigest ?? null) === setupDigest);
  const skipped = options.intent === "fill-missing" ? planResult.supported.filter(covered) : [];
  const executablePlan = { ...planResult, supported: options.intent === "fill-missing" ? planResult.supported.filter((item) => !covered(item)) : planResult.supported };
  const report = { intent: options.intent, planned: executablePlan.supported, skipped, unsupported: planResult.unsupported, ...(setupDigest ? { setupDigest } : {}), ...(usesConnections(planResult.variant) ? { connections: "on" } : {}) };
  if (!options.execute) return { mode: "dry-run", plan: planResult, ...report };
  if ((options.env ?? process.env).TASTE_ALLOW_MODEL_RUNS !== "1") {
    throw new Error("Refusing model execution: set TASTE_ALLOW_MODEL_RUNS=1 as an explicit paid-run acknowledgement");
  }
  if (usesConnections(planResult.variant) && options.allowConnections !== true) {
    throw Object.assign(new Error(`Configuration ${planResult.variant.id} turns connections on: its MCP servers and plugins can act in the world under bypassed permissions. Cook it with --allow-connections`), { code: "INVALID_ARGUMENT" });
  }
  // Every Cook first prunes the runtime root: expired failed attempts, orphans, and the residue of a Kitchen that died.
  const pruned = await (options.pruneCookDirectories ?? pruneCookDirectories)({ repoRoot, env: options.env ?? {} });
  const runPlan = options.executePlan ?? executePlan;
  const result = await runPlan({ repoRoot, catalog, plan: executablePlan, executable: options.executable, env: options.env, allowStatuses: options.allowStatuses, publishPersonal: options.publishPersonal === true, allowConnections: options.allowConnections === true });
  await buildRegistry({ repoRoot, basePath: registryBasePath(options) });
  return { mode: "executed", ...report, ...result, pruned: pruneSummary(pruned) };
}

function pruneSummary(report) {
  return { removed: report.removed.length, kept: report.kept.length, settled: report.settled.length, errors: report.errors };
}

/** Prune cook directories by hand; `dryRun` reports without deleting. */
export async function prune(repoRoot, options = {}) {
  return pruneCookDirectories({ repoRoot, env: options.env ?? {}, dryRun: options.dryRun === true });
}

/** Recover an interrupted Cook, then rebuild the registry so the Dish is served like any cooked one. */
export async function recover(repoRoot, options = {}) {
  const run = options.recoverAttempt ?? recoverAttempt;
  const result = await run({ repoRoot, catalog: await loadCatalog(repoRoot), attemptId: options.attemptId, env: options.env });
  await buildRegistry({ repoRoot, basePath: registryBasePath(options) });
  return result;
}

/** Record Burooj's verdict on a Dish or No Dish beside it, then rebuild the registry so the gallery shows it. */
export async function verdict(repoRoot, options = {}) {
  const result = await writeVerdict(repoRoot, { plateId: options.plateId, verdict: options.verdict, note: options.note, now: options.now });
  if (options.rebuild !== false) await buildRegistry({ repoRoot, basePath: registryBasePath(options) });
  return result;
}

export { axisSetsForContext, buildRegistry, compareRubricsFromFile, evaluateDishWithJev, listRecipes, loadAxisSets, loadCatalog, loadDishes, loadPrivateDishes, loadObservations, loadMenus, planSelection, loadNoDishes, loadPrivateNoDishes, loadVerdicts };
export { loadSkills, resolveSkill, skillCompatibility, skillKey } from "./skills.mjs";
export { buildRecipeBook, saveRecipeEdits } from "./recipe-book.mjs";
