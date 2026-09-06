import type { Configuration, Dish, Recipe, Registry } from "../types";
import type { GalleryState } from "./url-state";

export type RecipeSelectionSlot = {
  config?: Configuration;
  repeats: Dish[];
  dish?: Dish;
};

export type ResolvedRecipeSelection = {
  recipeHash: string;
  slots: RecipeSelectionSlot[];
};

/** Returns the newest Dish, resolving equal execution times by Dish ID. */
export function latestDish(dishes: readonly Dish[]): Dish | undefined {
  return [...dishes].sort((a, b) => b.executedAt.localeCompare(a.executedAt) || b.id.localeCompare(a.id))[0];
}

function configurationForDish(registry: Registry, dish: Dish): Configuration | undefined {
  return registry.configurations.find((config) => config.configHash === dish.identity.configHash);
}

/** Builds the URL patch for one immutable Dish and its exact configuration snapshot. */
export function selectionForDish(registry: Registry, dish: Dish): Pick<GalleryState, "recipe" | "revision" | "models" | "dishes"> {
  const config = configurationForDish(registry, dish);
  if (!config) throw new Error(`No public configuration snapshot exists for Dish ${dish.id}.`);
  return { recipe: dish.recipe.id, revision: dish.recipe.hash, models: [config.id], dishes: [dish.id] };
}

function slotForConfiguration(config: Configuration | undefined, dishes: Dish[], selectedDishId: string | undefined): RecipeSelectionSlot {
  const repeats = config ? dishes.filter((dish) => dish.identity.configHash === config.configHash)
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.id.localeCompare(b.id)) : [];
  return { config, repeats, dish: repeats.find((dish) => dish.id === selectedDishId) ?? latestDish(repeats) };
}

/**
 * Resolves URL selection against immutable Recipe Revision and configuration
 * snapshots. An explicit revision is never broadened to Dishes from another
 * revision; unavailable slots therefore remain empty.
 */
export function resolveRecipeSelection(registry: Registry, recipe: Recipe, state: Pick<GalleryState, "revision" | "models" | "dishes">): ResolvedRecipeSelection {
  const recipeDishes = registry.dishes.filter((dish) => dish.recipe.id === recipe.id);
  const recipeHash = state.revision || latestDish(recipeDishes)?.recipe.hash || recipe.recipeHash;
  const revisionDishes = recipeDishes.filter((dish) => dish.recipe.hash === recipeHash);

  if (state.models.length) {
    return {
      recipeHash,
      slots: state.models.map((id, index) => slotForConfiguration(
        registry.configurations.find((config) => config.id === id),
        revisionDishes,
        state.dishes[index],
      )),
    };
  }

  const defaultDish = latestDish(revisionDishes);
  return {
    recipeHash,
    slots: defaultDish ? [slotForConfiguration(configurationForDish(registry, defaultDish), revisionDishes, defaultDish.id)] : [],
  };
}
