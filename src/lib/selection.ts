import type { Configuration, Dish, Recipe, Registry } from "../types";
import type { GalleryState } from "./url-state";

// Kept local (not imported from ./registry) so this module stays importable by node's type-stripping test runner.
const NO_SKILL = "none";
const dishSkillKey = (dish: Pick<Dish, "skill">) => dish.skill?.hash ?? NO_SKILL;

export type RecipeSelectionSlot = {
  config?: Configuration;
  /** "none", a skill hash, or undefined when the URL left the layer to the latest Dish. */
  skillKey: string;
  repeats: Dish[];
  dish?: Dish;
};

/** URL skill tokens are skill ids or "none"; Dish grouping uses the exact frozen hash. */
export function skillKeyForToken(registry: Pick<Registry, "skills" | "skillRevisions">, token: string | undefined): string | undefined {
  if (!token) return undefined;
  if (token === NO_SKILL) return NO_SKILL;
  const current = registry.skills?.find((skill) => skill.id === token || skill.skillHash === token);
  if (current) return current.skillHash;
  const frozen = registry.skillRevisions?.find((revision) => revision.hash === token || revision.hash.endsWith(token));
  return frozen?.hash ?? token;
}
export function skillTokenForDish(registry: Pick<Registry, "skills" | "skillRevisions">, dish: Dish) {
  if (!dish.skill) return NO_SKILL;
  return registry.skills?.find((skill) => skill.skillHash === dish.skill?.hash)?.id ?? dish.skill.hash;
}

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
export function selectionForDish(registry: Registry, dish: Dish): Pick<GalleryState, "recipe" | "revision" | "models" | "skills" | "dishes"> {
  const config = configurationForDish(registry, dish);
  if (!config) throw new Error(`No public configuration snapshot exists for Dish ${dish.id}.`);
  return { recipe: dish.recipe.id, revision: dish.recipe.hash, models: [config.id], skills: [skillTokenForDish(registry, dish)], dishes: [dish.id] };
}

function slotForConfiguration(config: Configuration | undefined, requestedSkillKey: string | undefined, dishes: Dish[], selectedDishId: string | undefined): RecipeSelectionSlot {
  const configDishes = config ? dishes.filter((dish) => dish.identity.configHash === config.configHash)
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.id.localeCompare(b.id)) : [];
  // An unspecified layer follows the selected or newest Dish; Repeats never mix layers.
  const anchor = configDishes.find((dish) => dish.id === selectedDishId) ?? latestDish(configDishes);
  const skillKey = requestedSkillKey ?? (anchor ? dishSkillKey(anchor) : NO_SKILL);
  const repeats = configDishes.filter((dish) => dishSkillKey(dish) === skillKey);
  return { config, skillKey, repeats, dish: repeats.find((dish) => dish.id === selectedDishId) ?? latestDish(repeats) };
}

/**
 * Resolves URL selection against immutable Recipe Revision and configuration
 * snapshots. An explicit revision is never broadened to Dishes from another
 * revision; unavailable slots therefore remain empty.
 */
export function resolveRecipeSelection(registry: Registry, recipe: Recipe, state: Pick<GalleryState, "revision" | "models" | "skills" | "dishes">): ResolvedRecipeSelection {
  const recipeDishes = registry.dishes.filter((dish) => dish.recipe.id === recipe.id);
  const recipeHash = state.revision || latestDish(recipeDishes)?.recipe.hash || recipe.recipeHash;
  const revisionDishes = recipeDishes.filter((dish) => dish.recipe.hash === recipeHash);

  if (state.models.length) {
    return {
      recipeHash,
      slots: state.models.map((id, index) => slotForConfiguration(
        registry.configurations.find((config) => config.id === id),
        skillKeyForToken(registry, state.skills?.[index]),
        revisionDishes,
        state.dishes[index],
      )),
    };
  }

  const defaultDish = latestDish(revisionDishes);
  return {
    recipeHash,
    slots: defaultDish ? [slotForConfiguration(configurationForDish(registry, defaultDish), dishSkillKey(defaultDish), revisionDishes, defaultDish.id)] : [],
  };
}
