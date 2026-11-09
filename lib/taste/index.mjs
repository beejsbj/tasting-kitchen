import { listRecipes, loadCatalog, planSelection } from "./catalog.mjs";
import { buildRegistry, loadDishes, loadPrivateDishes } from "./registry.mjs";
import { getHarnessAdapter, isPersonalEnvironment } from "./harness-adapters.mjs";
import { usesConnections } from "./environments.mjs";
import { skillKey } from "./skills.mjs";
import { executePlan } from "./runner.mjs";
import { recoverAttempt } from "./recovery.mjs";
import { loadMenus } from "./menus.mjs";
import { axisSetsForContext, evaluateDishWithJev, loadAxisSets, loadObservations } from "./observations.mjs";
import { compareRubricsFromFile } from "./rubric-comparison.mjs";
import { catalogWithConfigurations, isConfigurationSpec, markNothingToCook, materializeConfigurations, resolutionSummary, resolveConfigurationSpec } from "./configuration-templates.mjs";

export async function discover(repoRoot) {
  const [catalog, menus, dishes, privateDishes, axisSets] = await Promise.all([
    loadCatalog(repoRoot), loadMenus(repoRoot), loadDishes(repoRoot), loadPrivateDishes(repoRoot), loadAxisSets(repoRoot),
  ]);
  const observations = await loadObservations(repoRoot, { dishes, axisSets });
  return {
    cuisines: catalog.cuisines,
    configurations: catalog.configurations,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- root is a host path and stays out of the listing
    skills: catalog.skills.map(({ root, files, ...skill }) => ({ ...skill, fileCount: files.length })),
    recipes: catalog.recipes.map((recipe) => ({ id: recipe.id, title: recipe.title, cuisines: recipe.cuisines, status: recipe.status, visibility: recipe.visibility ?? "public", recipeHash: recipe.recipeHash, skillLayers: recipe.skills?.layers ?? [] })),
    privateDishes: privateDishes.map((dish) => ({ id: dish.id, recipe: dish.recipe, identity: dish.identity, skill: dish.skill ?? null, executedAt: dish.executedAt })),
    menus,
    dishes,
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
    return { recipe, dishes: [...dishes.filter((dish) => dish.recipe.id === recipeId), ...privateDishes] };
  }
  const menu = menus.find((candidate) => candidate.id === menuId);
  if (!menu) throw new Error(`Unknown menu id: ${menuId}`);
  return { menu };
}

/**
 * Coverage of a Menu against the current recipes: a cell is represented when a
 * Dish exists for that recipe's current hash (and, optionally, the given
 * configuration and skill layers).
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

/**
 * A `--config` value that is a spec or selector (hermes:openrouter/…@effort)
 * resolves through discovery at plan time. The plan names every configuration
 * it resolved to and whether each is already in the catalog or would be
 * materialized on first cook; a selector also lists what it matched but cannot cook.
 */
async function resolveSpec(catalog, options) {
  const resolution = await resolveConfigurationSpec(catalog, options.configurationId ?? options.variantId, { env: options.env ?? {}, fetchImpl: options.fetchImpl, upstream: options.upstream ?? null, now: options.now });
  const pending = resolution.entries.filter((entry) => entry.status === "materialize").map((entry) => entry.configuration);
  return { resolution, pending, catalog: catalogWithConfigurations(catalog, pending) };
}

function specOptions(options, configurationId) {
  return { ...options, configurationId, variantId: undefined, upstream: undefined };
}

export async function plan(repoRoot, options = {}) {
  const catalog = await loadCatalog(repoRoot);
  if (!isConfigurationSpec(options.configurationId ?? options.variantId)) {
    if (options.upstream) throw Object.assign(new Error("--upstream applies only to a configuration spec (harness:route/model@effort)"), { code: "INVALID_ARGUMENT" });
    return planFromCatalog(repoRoot, catalog, options);
  }
  const resolved = await resolveSpec(catalog, options);
  const plans = [];
  for (const entry of resolved.resolution.entries) plans.push(await planFromCatalog(repoRoot, resolved.catalog, specOptions(options, entry.configuration.id)));
  markNothingToCook(resolved.resolution, resolved.resolution.entries.filter((entry, index) => entry.status === "catalog" || plans[index].supported?.length).map((entry) => entry.configuration));
  const configurationSpec = resolutionSummary(resolved.resolution);
  if (!resolved.resolution.selector) return { ...plans[0], configurationSpec };
  return { schemaVersion: 1, configurationSpec, plans };
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
  if (!options.intent || !["fill-missing", "repeat"].includes(options.intent)) throw new Error("cook requires intent fill-missing or repeat");
  if (isConfigurationSpec(options.configurationId ?? options.variantId)) return cookSpec(repoRoot, options);
  if (options.upstream) throw Object.assign(new Error("--upstream applies only to a configuration spec (harness:route/model@effort)"), { code: "INVALID_ARGUMENT" });
  // One snapshot: the plan a caller reviews is the catalog the runner executes.
  return cookWithCatalog(repoRoot, await loadCatalog(repoRoot), options);
}

/**
 * Cook a spec or selector: each configuration it resolves to, in turn. A dry
 * run plans against the catalog as it would read with the new entries; an
 * executed cook first materializes them into catalog/configurations.json, then
 * cooks from the catalog as written, so every Dish's catalog hash names a
 * catalog that exists.
 */
async function cookSpec(repoRoot, options) {
  const resolved = await resolveSpec(await loadCatalog(repoRoot), options);
  let catalog = resolved.catalog;
  let materialized = [];
  // Only a configuration that will actually cook something is written: a dry run against the
  // would-be catalog says which of the new ones have a Recipe to cook. The rest read "nothing-to-cook".
  const cooking = [];
  for (const configuration of resolved.pending) {
    const preview = await cookWithCatalog(repoRoot, resolved.catalog, { ...specOptions(options, configuration.id), execute: false }).catch((error) => {
      if (!resolved.resolution.selector) throw error;
      return null;
    });
    if (preview?.planned?.length) cooking.push(configuration);
  }
  markNothingToCook(resolved.resolution, cooking);
  if (!options.execute) catalog = catalogWithConfigurations(await loadCatalog(repoRoot), cooking);
  else {
    if ((options.env ?? process.env).TASTE_ALLOW_MODEL_RUNS !== "1") throw new Error("Refusing model execution: set TASTE_ALLOW_MODEL_RUNS=1 as an explicit paid-run acknowledgement");
    materialized = (await materializeConfigurations(repoRoot, cooking)).map((configuration) => configuration.id);
    catalog = await loadCatalog(repoRoot);
  }
  const configurationSpec = resolutionSummary(resolved.resolution);
  const cooks = [];
  const known = new Set(catalog.configurations.map((configuration) => configuration.id));
  for (const entry of resolved.resolution.entries) {
    if (!known.has(entry.configuration.id)) { cooks.push({ configurationId: entry.configuration.id, mode: "skipped", reason: "nothing to cook, so not materialized" }); continue; }
    try { cooks.push(await cookWithCatalog(repoRoot, catalog, specOptions(options, entry.configuration.id))); }
    catch (error) {
      // One configuration that cannot cook does not stop the rest of a selector.
      if (!resolved.resolution.selector) throw error;
      cooks.push({ configurationId: entry.configuration.id, error: error.message });
    }
  }
  const failed = cooks.flatMap((result) => result.failed ?? (result.error ? [result] : []));
  if (!resolved.resolution.selector) return { ...cooks[0], configurationSpec, ...(materialized.length ? { materialized } : {}) };
  return { mode: options.execute ? "executed" : "dry-run", intent: options.intent, configurationSpec, ...(options.execute ? { materialized } : {}), cooks, ...(failed.length ? { failed } : {}) };
}

async function cookWithCatalog(repoRoot, catalog, options) {
  const planResult = await planFromCatalog(repoRoot, catalog, options);
  if (options.publishPersonal === true && !isPersonalEnvironment(planResult.variant)) {
    // INVALID_ARGUMENT is how the CLI recognises a usage error.
    throw Object.assign(new Error("--publish-personal applies only to a configuration with a personal (snapshot or live) environment"), { code: "INVALID_ARGUMENT" });
  }
  if (options.allowConnections === true && !usesConnections(planResult.variant)) {
    throw Object.assign(new Error("--allow-connections applies only to a configuration with connections on"), { code: "INVALID_ARGUMENT" });
  }
  const existing = [...await loadDishes(repoRoot), ...await loadPrivateDishes(repoRoot)];
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
  const runPlan = options.executePlan ?? executePlan;
  const result = await runPlan({ repoRoot, catalog, plan: executablePlan, executable: options.executable, env: options.env, allowStatuses: options.allowStatuses, publishPersonal: options.publishPersonal === true, allowConnections: options.allowConnections === true });
  await buildRegistry({ repoRoot, basePath: registryBasePath(options) });
  return { mode: "executed", ...report, ...result };
}

/** Recover an interrupted Cook, then rebuild the registry so the Dish is served like any cooked one. */
export async function recover(repoRoot, options = {}) {
  const run = options.recoverAttempt ?? recoverAttempt;
  const result = await run({ repoRoot, catalog: await loadCatalog(repoRoot), attemptId: options.attemptId, env: options.env });
  await buildRegistry({ repoRoot, basePath: registryBasePath(options) });
  return result;
}

export { discoverModels, formatDiscovery } from "./model-discovery.mjs";
export { CONFIGURATION_TEMPLATES, parseConfigurationSpec, resolveConfigurationSpec } from "./configuration-templates.mjs";
export { axisSetsForContext, buildRegistry, compareRubricsFromFile, evaluateDishWithJev, listRecipes, loadAxisSets, loadCatalog, loadDishes, loadPrivateDishes, loadObservations, loadMenus, planSelection };
export { loadSkills, resolveSkill, skillCompatibility, skillKey } from "./skills.mjs";
export { buildRecipeBook, saveRecipeEdits } from "./recipe-book.mjs";
