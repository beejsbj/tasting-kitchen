import type { Dish, Recipe, Registry, Variant } from "../types";
import domainsDocument from "../../catalog/domains.json";
import tagsDocument from "../../catalog/tags.json";
import variantsDocument from "../../catalog/variants.json";

const recipeModules = import.meta.glob<{ default: Recipe }>("../../catalog/recipes/**/recipe.json", { eager: true });

function bundledRegistry(): Registry {
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    basePath: import.meta.env.BASE_URL,
    domains: domainsDocument.domains,
    tags: tagsDocument.tags,
    variants: variantsDocument.variants,
    recipes: Object.values(recipeModules).map((module) => module.default).sort((left, right) => left.title.localeCompare(right.title)),
    dishes: [],
    reviews: [],
  } as Registry;
}

export async function loadRegistry(): Promise<Registry> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/registry.json`, { cache: "no-cache" });
    if (!response.ok) return bundledRegistry();
    return await response.json() as Registry;
  } catch {
    return bundledRegistry();
  }
}

export function recipeSupported(recipe: Recipe, variant: Variant) {
  const offered = new Set(variant.capabilities);
  return recipe.harness.capabilities.every((capability) => offered.has(capability));
}

export function dishFor(dishes: Dish[], recipeId: string, variantId: string) {
  return dishes.find((dish) => dish.recipe.id === recipeId && dish.identity.variantId === variantId);
}

export function reviewsForDish(reviews: Registry["reviews"], dish?: Dish) {
  if (!dish) return [];
  return reviews.filter((review) => review.dishId === dish.id && review.dishHash === dish.dishHash);
}

export function artifactUrl(dish: Dish, path = dish.artifact.entry) {
  return `${dish.artifactBase.replace(/\/$/, "")}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
