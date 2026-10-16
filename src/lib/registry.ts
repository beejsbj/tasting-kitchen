import type { AxisSet, Configuration, Dish, Recipe, Registry, TasteObservation, Variant } from "../types";

export async function loadRegistry(): Promise<Registry> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/registry.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error("The Kitchen catalog could not be loaded. Please try again.");
  const registry = await response.json() as Registry;
  if (registry.schemaVersion !== 3 || !Array.isArray(registry.recipes) || !Array.isArray(registry.configurations)) {
    throw new Error("This Kitchen needs an updated catalog. Rebuild the public registry before serving it.");
  }
  return { ...registry, configurations: comparisonConfigurations(registry) };
}
/**
 * The current configurations plus any a Dish ran as that the catalog no longer
 * has, rebuilt from the Dish's own receipt so those Dishes stay selectable.
 */
export function comparisonConfigurations(registry: Pick<Registry, "configurations" | "dishes">): Configuration[] {
  const known = new Set(registry.configurations.map((config) => config.configHash));
  const historical = new Map<string, Configuration>();
  for (const dish of registry.dishes) {
    const hash = dish.identity.configHash;
    if (known.has(hash) || historical.has(hash)) continue;
    const configuration = dish.receipt?.configuration;
    if (!configuration) continue;
    historical.set(hash, { ...configuration, id: `${configuration.id}--${hash.slice(7)}`, configHash: hash, historical: true });
  }
  return [...registry.configurations, ...historical.values()];
}
export function recipeSupported(recipe: Recipe, variant: Variant) {
  return recipe.harness.capabilities.every((capability) => variant.capabilities.includes(capability));
}
/** The skill layer a Dish was cooked with: a skill hash, or "none" when no layer was mounted. */
export const NO_SKILL = "none";
export function dishSkillKey(dish: Pick<Dish, "skill">) {
  return dish.skill?.hash ?? NO_SKILL;
}
export function skillForDish(registry: Pick<Registry, "skills">, dish: Pick<Dish, "skill">) {
  if (!dish.skill) return undefined;
  const current = registry.skills?.find((skill) => skill.skillHash === dish.skill?.hash);
  if (current) return { id: current.id, label: current.label, hash: current.skillHash, historical: false };
  const known = registry.skills?.find((skill) => skill.id === dish.skill?.id);
  return { id: dish.skill.id, label: known?.label ?? dish.skill.id, hash: dish.skill.hash, historical: true };
}
export function skillLabelFor(registry: Pick<Registry, "skills">, dish: Pick<Dish, "skill">) {
  return dish.skill ? skillForDish(registry, dish)?.label ?? dish.skill.id : "Without skill";
}
/** True when the Dish was cooked from a different brief than the recipe's current one. */
export function briefChanged(dish: Pick<Dish, "recipe">, recipe: Pick<Recipe, "recipeHash">) {
  return dish.recipe.hash !== recipe.recipeHash;
}
/** Plain reasons the catalog no longer matches what a Dish ran as. Empty when it still does. */
export function catalogChanges(registry: Pick<Registry, "configurations" | "skills">, dish: Pick<Dish, "identity" | "skill">) {
  const reasons: string[] = [];
  if (!registry.configurations.some((config) => config.configHash === dish.identity.configHash)) reasons.push("configuration");
  if (dish.skill && !registry.skills?.some((skill) => skill.skillHash === dish.skill?.hash)) reasons.push("skill layer");
  return reasons;
}
/** Dishes for a recipe, optionally pinned to a recipe hash, configuration, and skill layer key ("none" or a skill hash). */
export function dishesFor(dishes: Dish[], recipeId: string, recipeHash?: string, configHash?: string, skillKey?: string) {
  return dishes.filter((dish) => dish.recipe.id === recipeId && (!recipeHash || dish.recipe.hash === recipeHash) && (!configHash || dish.identity.configHash === configHash) && (!skillKey || dishSkillKey(dish) === skillKey))
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.id.localeCompare(b.id));
}
export function reviewsForDish(reviews: Registry["reviews"], dish?: Dish) {
  return dish ? reviews.filter((review) => review.dishId === dish.id && review.dishHash === dish.dishHash) : [];
}
export function observationsForDish(observations: TasteObservation[], dish?: Dish) {
  return dish ? observations.filter((observation) => observation.dishId === dish.id && observation.dishHash === dish.dishHash) : [];
}
export function axisSetsForDish(axisSets: AxisSet[], dish?: Dish) {
  return dish ? axisSets.filter((axisSet) => axisSet.contexts.some((context) => context.kind === "recipe" && context.id === dish.recipe.id)) : [];
}
export function observationDisagreements(observations: TasteObservation[]) {
  const disagreements: Array<{ axisId: string; human: string; jev: string; rubricHash: string }> = [];
  const byRubric = new Map<string, TasteObservation[]>();
  for (const observation of observations) byRubric.set(observation.axisSet.hash, [...(byRubric.get(observation.axisSet.hash) ?? []), observation]);
  for (const [rubricHash, group] of byRubric) {
    const humans = group.filter((observation) => observation.source.kind === "human");
    const jev = group.filter((observation) => observation.source.kind === "jev");
    for (const human of humans) for (const machine of jev) for (const humanAxis of human.axes) {
      const machineAxis = machine.axes.find((axis) => axis.axisId === humanAxis.axisId);
      if (machineAxis && machineAxis.levelId !== humanAxis.levelId) disagreements.push({ axisId: humanAxis.axisId, human: humanAxis.levelId, jev: machineAxis.levelId, rubricHash });
    }
  }
  return disagreements;
}
export function artifactUrl(dish: Dish, path = dish.artifact.entry) {
  return `${dish.artifactBase.replace(/\/$/, "")}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
export function shortHash(hash: string) { return hash.replace("sha256:", "").slice(0, 8); }
export function modelFamily(model: string) {
  if (/composer-?2\.5/i.test(model)) return "Composer";
  const named = model.match(/(?:^|-)(astra|sol|terra|luna|fable)(?:-|$)/i)?.[1];
  return named ? named[0].toUpperCase() + named.slice(1) : model;
}
