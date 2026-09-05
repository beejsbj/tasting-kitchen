import type { Configuration, Dish, Recipe, RecipeRevision, Registry, Variant } from "../types";

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
export function dishesFor(dishes: Dish[], recipeId: string, recipeHash?: string, configHash?: string) {
  return dishes.filter((dish) => dish.recipe.id === recipeId && (!recipeHash || dish.recipe.hash === recipeHash) && (!configHash || dish.identity.configHash === configHash))
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
export function artifactUrl(dish: Dish, path = dish.artifact.entry) {
  return `${dish.artifactBase.replace(/\/$/, "")}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
export function shortHash(hash: string) { return hash.replace("sha256:", "").slice(0, 8); }
export function modelFamily(model: string) {
  const named = model.match(/(?:^|-)(astra|sol|terra|luna|fable)(?:-|$)/i)?.[1];
  return named ? named[0].toUpperCase() + named.slice(1) : model;
}
