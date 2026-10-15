import type { AxisSet, Configuration, Dish, Recipe, RecipeRevision, Registry, TasteObservation, Variant } from "../types";

export async function loadRegistry(): Promise<Registry> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/registry.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error("The Kitchen catalog could not be loaded. Please try again.");
  const registry = await response.json() as Registry;
  if (registry.schemaVersion !== 2 || !Array.isArray(registry.recipes) || !Array.isArray(registry.configurations)) {
    throw new Error("This Kitchen needs an updated catalog. Rebuild the public registry before serving it.");
  }
  return { ...registry, configurations: comparisonConfigurations(registry) };
}
export function comparisonConfigurations(registry: Pick<Registry, "configurations" | "configurationRevisions" | "dishes">): Configuration[] {
  const currentHashes = new Set(registry.configurations.map((config) => config.configHash));
  const acceptedHashes = new Set(registry.dishes.map((dish) => dish.identity.configHash));
  const historical = (registry.configurationRevisions ?? []).filter((revision) => acceptedHashes.has(revision.hash) && !currentHashes.has(revision.hash)).map((revision) => ({
    ...revision.configuration, id: `${revision.configuration.id}--${revision.hash.slice(7)}`, configHash: revision.hash, historical: true,
  }));
  return [...registry.configurations, ...historical];
}
export function recipeSupported(recipe: Recipe, variant: Variant) {
  return recipe.harness.capabilities.every((capability) => variant.capabilities.includes(capability));
}
/** The skill layer a Dish was cooked with: a skill hash, or "none" when no layer was mounted. */
export const NO_SKILL = "none";
export function dishSkillKey(dish: Pick<Dish, "skill">) {
  return dish.skill?.hash ?? NO_SKILL;
}
export function skillForDish(registry: Pick<Registry, "skills" | "skillRevisions">, dish: Pick<Dish, "skill">) {
  if (!dish.skill) return undefined;
  const current = registry.skills?.find((skill) => skill.skillHash === dish.skill?.hash);
  if (current) return { id: current.id, label: current.label, hash: current.skillHash, historical: false };
  const frozen = registry.skillRevisions?.find((revision) => revision.hash === dish.skill?.hash);
  return { id: frozen?.skillId ?? dish.skill.id, label: frozen?.display.label ?? dish.skill.id, hash: dish.skill.hash, historical: true };
}
export function skillLabelFor(registry: Pick<Registry, "skills" | "skillRevisions">, dish: Pick<Dish, "skill">) {
  return dish.skill ? skillForDish(registry, dish)?.label ?? dish.skill.id : "Without skill";
}
/** Dishes for a recipe, optionally pinned to a revision, configuration, and skill layer key ("none" or a skill hash). */
export function dishesFor(dishes: Dish[], recipeId: string, recipeHash?: string, configHash?: string, skillKey?: string) {
  return dishes.filter((dish) => dish.recipe.id === recipeId && (!recipeHash || dish.recipe.hash === recipeHash) && (!configHash || dish.identity.configHash === configHash) && (!skillKey || dishSkillKey(dish) === skillKey))
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.id.localeCompare(b.id));
}
export function recipeAtRevision(recipe: Recipe, revision?: RecipeRevision): Recipe {
  if (!revision) return recipe;
  return { ...recipe, ...revision.execution, recipeHash: revision.hash, version: revision.version,
    title: revision.display.title, summary: revision.display.summary, origin: revision.display.lineage, cuisines: revision.display.cuisines };
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
