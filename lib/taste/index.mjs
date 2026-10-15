import { listRecipes, loadCatalog, planSelection } from "./catalog.mjs";
import { buildRegistry, loadDishes, loadPrivateDishes } from "./registry.mjs";
import { loadSkillRevisions, skillKey } from "./skills.mjs";
import { executePlan } from "./runner.mjs";
import { freezeMenuRevision, loadConfigurationRevisions, loadMenuRevisions, loadMenus, loadRecipeRevisions } from "./revisions.mjs";
import { axisSetsForContext, evaluateDishWithJev, loadAxisSets, loadObservations } from "./observations.mjs";
import { compareRubricsFromFile } from "./rubric-comparison.mjs";

export async function discover(repoRoot) {
  const [catalog, configurationRevisions, recipeRevisions, menus, menuRevisions, dishes, privateDishes, axisSets, skillRevisions] = await Promise.all([
    loadCatalog(repoRoot), loadConfigurationRevisions(repoRoot), loadRecipeRevisions(repoRoot), loadMenus(repoRoot), loadMenuRevisions(repoRoot), loadDishes(repoRoot), loadPrivateDishes(repoRoot), loadAxisSets(repoRoot), loadSkillRevisions(repoRoot),
  ]);
  const observations = await loadObservations(repoRoot, { dishes, axisSets });
  return {
    cuisines: catalog.cuisines,
    configurations: catalog.configurations,
    configurationRevisions,
    skills: catalog.skills.map(({ root, files, ...skill }) => ({ ...skill, fileCount: files.length })),
    skillRevisions: skillRevisions.map(({ skillId, hash, treeHash }) => ({ skillId, hash, treeHash })),
    recipes: catalog.recipes.map((recipe) => ({ id: recipe.id, title: recipe.title, cuisines: recipe.cuisines, status: recipe.status, visibility: recipe.visibility ?? "public", recipeHash: recipe.recipeHash, skillLayers: recipe.skills?.layers ?? [] })),
    privateDishes: privateDishes.map((dish) => ({ id: dish.id, recipe: dish.recipe, identity: dish.identity, skill: dish.skill ?? null, executedAt: dish.executedAt })),
    recipeRevisions: recipeRevisions.map(({ recipeId, hash, version }) => ({ recipeId, hash, version })),
    menus,
    menuRevisions,
    dishes,
    axisSets,
    observations,
  };
}

export async function inspect(repoRoot, { recipeId, menuId, revisionHash } = {}) {
  if ([recipeId, menuId, revisionHash].filter((value) => value !== undefined).length !== 1) {
    throw new Error("inspect requires exactly one of recipeId, menuId, or revisionHash");
  }
  const [catalog, recipeRevisions, menus, menuRevisions, dishes] = await Promise.all([
    loadCatalog(repoRoot), loadRecipeRevisions(repoRoot), loadMenus(repoRoot), loadMenuRevisions(repoRoot), loadDishes(repoRoot),
  ]);
  if (recipeId) {
    const recipe = catalog.recipes.find((candidate) => candidate.id === recipeId);
    if (!recipe) throw new Error(`Unknown recipe id: ${recipeId}`);
    const privateDishes = recipe.visibility === "private" ? (await loadPrivateDishes(repoRoot)).filter((dish) => dish.recipe.id === recipeId) : [];
    return { recipe, revisions: recipeRevisions.filter((revision) => revision.recipeId === recipeId), dishes: [...dishes.filter((dish) => dish.recipe.id === recipeId), ...privateDishes] };
  }
  if (menuId) {
    const menu = menus.find((candidate) => candidate.id === menuId);
    if (!menu) throw new Error(`Unknown menu id: ${menuId}`);
    return { menu, revisions: menuRevisions.filter((revision) => revision.menuId === menuId) };
  }
  if (revisionHash) {
    const recipeRevision = recipeRevisions.find((revision) => revision.hash === revisionHash);
    const menuRevision = menuRevisions.find((revision) => revision.hash === revisionHash);
    if (!recipeRevision && !menuRevision) throw new Error(`Unknown revision hash: ${revisionHash}`);
    return recipeRevision ? { recipeRevision } : { menuRevision };
  }
  throw new Error("inspect requires recipeId, menuId, or revisionHash");
}

export function coverage(menuRevision, dishes, configurationHashes = null, skillHashes = null) {
  const configurations = configurationHashes ? new Set(configurationHashes) : null;
  const skills = skillHashes ? new Set(skillHashes) : null;
  const cells = menuRevision.recipes.map(({ recipeId, recipeHash }) => {
    const matches = dishes.filter((dish) => dish.recipe.id === recipeId && dish.recipe.hash === recipeHash && (!configurations || configurations.has(dish.identity.configHash)) && (!skills || skills.has(skillKey(dish))));
    return { recipeId, recipeHash, dishes: matches, represented: matches.length > 0 };
  });
  return { numerator: cells.filter((cell) => cell.represented).length, denominator: cells.length, cells };
}

export async function plan(repoRoot, options = {}) {
  const catalog = await loadCatalog(repoRoot);
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

export async function cook(repoRoot, options = {}) {
  const catalog = await loadCatalog(repoRoot);
  const planResult = await plan(repoRoot, options);
  if (!options.intent || !["fill-missing", "repeat"].includes(options.intent)) throw new Error("cook requires intent fill-missing or repeat");
  const existing = [...await loadDishes(repoRoot), ...await loadPrivateDishes(repoRoot)];
  const requestedSkill = planResult.skill?.hash ?? "none";
  const covered = (item) => existing.some((dish) => dish.recipe.id === item.recipeId && dish.recipe.hash === item.recipeHash && dish.identity.configHash === planResult.variant.configHash && skillKey(dish) === requestedSkill);
  const skipped = options.intent === "fill-missing" ? planResult.supported.filter(covered) : [];
  const executablePlan = { ...planResult, supported: options.intent === "fill-missing" ? planResult.supported.filter((item) => !covered(item)) : planResult.supported };
  const report = { intent: options.intent, planned: executablePlan.supported, skipped, unsupported: planResult.unsupported };
  if (!options.execute) return { mode: "dry-run", plan: planResult, ...report };
  if ((options.env ?? process.env).TASTE_ALLOW_MODEL_RUNS !== "1") {
    throw new Error("Refusing model execution: set TASTE_ALLOW_MODEL_RUNS=1 as an explicit paid-run acknowledgement");
  }
  let menuRevision = null;
  if (options.menuId) {
    const menu = (await loadMenus(repoRoot)).find((candidate) => candidate.id === options.menuId);
    menuRevision = await freezeMenuRevision(repoRoot, menu, catalog.recipes);
  }
  const runPlan = options.executePlan ?? executePlan;
  const result = await runPlan({ repoRoot, catalog, plan: executablePlan, executable: options.executable, env: options.env, allowStatuses: options.allowStatuses });
  await buildRegistry({ repoRoot, basePath: options.basePath });
  return { mode: "executed", ...report, ...(menuRevision ? { menuRevision } : {}), ...result };
}

export { axisSetsForContext, buildRegistry, compareRubricsFromFile, evaluateDishWithJev, listRecipes, loadAxisSets, loadCatalog, loadDishes, loadPrivateDishes, loadObservations, loadConfigurationRevisions, loadMenuRevisions, loadMenus, loadRecipeRevisions, planSelection };
export { loadSkills, loadSkillRevisions, resolveSkill, skillCompatibility, skillKey } from "./skills.mjs";
export { buildRecipeBook, saveRecipeEdits } from "./recipe-book.mjs";
