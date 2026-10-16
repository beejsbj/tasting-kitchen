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

/** URL skill tokens are skill ids or "none"; Dish grouping uses the exact skill hash a Dish recorded. */
export function skillKeyForToken(registry: Pick<Registry, "skills">, token: string | undefined): string | undefined {
  if (!token) return undefined;
  if (token === NO_SKILL) return NO_SKILL;
  const current = registry.skills?.find((skill) => skill.id === token || skill.skillHash === token);
  return current?.skillHash ?? token;
}
export function skillTokenForDish(registry: Pick<Registry, "skills">, dish: Dish) {
  if (!dish.skill) return NO_SKILL;
  return registry.skills?.find((skill) => skill.skillHash === dish.skill?.hash)?.id ?? dish.skill.hash;
}

export type ResolvedRecipeSelection = {
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
export function selectionForDish(registry: Registry, dish: Dish): Pick<GalleryState, "recipe" | "models" | "skills" | "dishes"> {
  const config = configurationForDish(registry, dish);
  if (!config) throw new Error(`No public configuration snapshot exists for Dish ${dish.id}.`);
  return { recipe: dish.recipe.id, models: [config.id], skills: [skillTokenForDish(registry, dish)], dishes: [dish.id] };
}

function slotForConfiguration(config: Configuration | undefined, requestedSkillKey: string | undefined, dishes: Dish[], selectedDishId: string | undefined): RecipeSelectionSlot {
  const configDishes = config ? dishes.filter((dish) => dish.identity.configHash === config.configHash)
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.id.localeCompare(b.id)) : [];
  // An unspecified layer follows the selected or newest Dish; Repeats never mix layers.
  const anchor = configDishes.find((dish) => dish.id === selectedDishId) ?? latestDish(configDishes);
  const skillKey = requestedSkillKey ?? (anchor ? dishSkillKey(anchor) : NO_SKILL);
  const layerDishes = configDishes.filter((dish) => dishSkillKey(dish) === skillKey);
  // Nor do Repeats mix briefs: they share the recipe hash of the Dish in view.
  const inView = layerDishes.find((dish) => dish.id === selectedDishId) ?? latestDish(layerDishes);
  const repeats = inView ? layerDishes.filter((dish) => dish.recipe.hash === inView.recipe.hash) : [];
  return { config, skillKey, repeats, dish: inView };
}

/**
 * Resolves URL selection against the registry's Dishes of one recipe. Dishes
 * cooked from an older brief stay selectable; callers mark them with
 * `briefChanged`. Repeats share configuration, skill layer and recipe hash.
 */
export function resolveRecipeSelection(registry: Registry, recipe: Recipe, state: Pick<GalleryState, "models" | "skills" | "dishes">): ResolvedRecipeSelection {
  const recipeDishes = registry.dishes.filter((dish) => dish.recipe.id === recipe.id);

  if (state.models.length) {
    return {
      slots: state.models.map((id, index) => slotForConfiguration(
        registry.configurations.find((config) => config.id === id),
        skillKeyForToken(registry, state.skills?.[index]),
        recipeDishes,
        state.dishes[index],
      )),
    };
  }

  const defaultDish = latestDish(recipeDishes);
  return {
    slots: defaultDish ? [slotForConfiguration(configurationForDish(registry, defaultDish), dishSkillKey(defaultDish), recipeDishes, defaultDish.id)] : [],
  };
}
