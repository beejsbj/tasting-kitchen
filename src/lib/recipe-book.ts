import type { Recipe, RecipeTurn } from "../types";

export type RecipeInput = { id: string; path: string; mountAs: string; mediaType: string; editable?: boolean; text: string | null };
export type RecipeBookEntry = { recipe: Recipe; sourcePath: string; fileHash: string; dishCount: number; fixtures: RecipeInput[] };
export type RecipeBookData = { schemaVersion: 1; recipes: RecipeBookEntry[]; archivedCount: number };
export type RecipeEdits = { title: string; summary: string; setupInstructions: string; turns: RecipeTurn[]; fixtureEdits: Array<{ id: string; text: string }> };

export async function loadRecipeBook(): Promise<{ book: RecipeBookData; writable: boolean }> {
  if (import.meta.env.DEV) {
    const response = await fetch('/api/recipes', { cache: 'no-store' });
    if (!response.ok) throw new Error('The recipe editor could not be loaded.');
    return response.json();
  }
  const response = await fetch(`${import.meta.env.BASE_URL}data/recipe-book.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('The recipe book could not be loaded.');
  return { book: await response.json(), writable: false };
}

export function initialEdits(entry: RecipeBookEntry): RecipeEdits {
  return { title: entry.recipe.title, summary: entry.recipe.summary, setupInstructions: entry.recipe.setup.instructions, turns: entry.recipe.turns.map(turn => ({ ...turn })), fixtureEdits: entry.fixtures.filter(input => input.text !== null).map(input => ({ id: input.id, text: input.text! })) };
}

export async function saveRecipe(entry: RecipeBookEntry, updates: RecipeEdits): Promise<RecipeBookEntry> {
  const response = await fetch(`/api/recipes/${encodeURIComponent(entry.recipe.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedHash: entry.fileHash, updates }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? 'The recipe could not be saved.');
  return result.entry;
}
