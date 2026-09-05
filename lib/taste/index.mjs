import { listRecipes, loadCatalog, planSelection } from "./catalog.mjs";
import { buildRegistry, loadDishes } from "./registry.mjs";
import { executePlan } from "./runner.mjs";
import { loadMenuRevisions, loadMenus, loadRecipeRevisions } from "./revisions.mjs";

export async function discover(repoRoot) {
  const [catalog, recipeRevisions, menus, menuRevisions, dishes] = await Promise.all([
    loadCatalog(repoRoot), loadRecipeRevisions(repoRoot), loadMenus(repoRoot), loadMenuRevisions(repoRoot), loadDishes(repoRoot),
  ]);
  return {
    cuisines: catalog.cuisines,
    configurations: catalog.configurations,
    recipes: catalog.recipes.map((recipe) => ({ id: recipe.id, title: recipe.title, cuisines: recipe.cuisines, status: recipe.status, recipeHash: recipe.recipeHash })),
    recipeRevisions: recipeRevisions.map(({ recipeId, hash, version }) => ({ recipeId, hash, version })),
    menus,
    menuRevisions,
    dishes,
  };
}

export async function inspect(repoRoot, { recipeId, menuId, revisionHash } = {}) {
  const state = await discover(repoRoot);
  if (recipeId) {
    const recipe = state.recipes.find((candidate) => candidate.id === recipeId);
    if (!recipe) throw new Error(`Unknown recipe id: ${recipeId}`);
    return { recipe, revisions: state.recipeRevisions.filter((revision) => revision.recipeId === recipeId), dishes: state.dishes.filter((dish) => dish.recipe.id === recipeId) };
  }
  if (menuId) {
    const menu = state.menus.find((candidate) => candidate.id === menuId);
    if (!menu) throw new Error(`Unknown menu id: ${menuId}`);
    return { menu, revisions: state.menuRevisions.filter((revision) => revision.menuId === menuId) };
  }
  if (revisionHash) return { recipeRevision: state.recipeRevisions.find((revision) => revision.hash === revisionHash) ?? null, menuRevision: state.menuRevisions.find((revision) => revision.hash === revisionHash) ?? null };
  throw new Error("inspect requires recipeId, menuId, or revisionHash");
}

export function coverage(menuRevision, dishes, configurationHashes = null) {
  const configurations = configurationHashes ? new Set(configurationHashes) : null;
  const cells = menuRevision.recipes.map(({ recipeId, recipeHash }) => {
    const matches = dishes.filter((dish) => dish.recipe.id === recipeId && dish.recipe.hash === recipeHash && (!configurations || configurations.has(dish.identity.configHash)));
    return { recipeId, recipeHash, dishes: matches, represented: matches.length > 0 };
  });
  return { numerator: cells.filter((cell) => cell.represented).length, denominator: cells.length, cells };
}

export async function plan(repoRoot, options = {}) {
  const catalog = await loadCatalog(repoRoot);
  if (!options.menuId) return planSelection(catalog, options);
  const menus = await loadMenus(repoRoot);
  const menu = menus.find((candidate) => candidate.id === options.menuId);
  if (!menu) throw new Error(`Unknown menu id: ${options.menuId}`);
  const result = planSelection(catalog, { ...options, recipeIds: menu.recipes });
  return { ...result, selection: { type: "menu", menuId: menu.id, recipeIds: menu.recipes } };
}

export async function cook(repoRoot, options = {}) {
  const catalog = await loadCatalog(repoRoot);
  const planResult = await plan(repoRoot, options);
  if (!options.intent || !["fill-missing", "repeat"].includes(options.intent)) throw new Error("cook requires intent fill-missing or repeat");
  const existing = await loadDishes(repoRoot);
  const covered = (item) => existing.some((dish) => dish.recipe.id === item.recipeId && dish.recipe.hash === item.recipeHash && dish.identity.configHash === planResult.variant.configHash);
  const skipped = options.intent === "fill-missing" ? planResult.supported.filter(covered) : [];
  const executablePlan = { ...planResult, supported: options.intent === "fill-missing" ? planResult.supported.filter((item) => !covered(item)) : planResult.supported };
  const report = { intent: options.intent, planned: executablePlan.supported, skipped, unsupported: planResult.unsupported };
  if (!options.execute) return { mode: "dry-run", plan: planResult, ...report };
  const result = await executePlan({ repoRoot, catalog, plan: executablePlan, executable: options.executable });
  await buildRegistry({ repoRoot, basePath: options.basePath });
  return { mode: "executed", ...report, ...result };
}

export { buildRegistry, listRecipes, loadCatalog, loadDishes, loadMenuRevisions, loadMenus, loadRecipeRevisions, planSelection };
