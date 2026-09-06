import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadDishes } from '../lib/taste/registry.mjs';
import { loadRecipeRevisions } from '../lib/taste/revisions.mjs';
import { buildRecipeBook } from '../lib/taste/recipe-book.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('old Dishes retain their original executed recipe identities', async () => {
  const [dishes, revisions] = await Promise.all([loadDishes(root), loadRecipeRevisions(root)]);
  const ids = new Set(dishes.map(dish => dish.recipe.id));
  assert.equal(ids.size, 3);
  for (const id of ids) {
    const dish = dishes.find(item => item.recipe.id === id);
    const revision = revisions.find(item => item.hash === dish.recipe.hash && item.recipeId === id);
    assert.ok(revision.display.title.length > 4);
    assert.equal(revision.hash, dish.recipe.hash);
  }
});

test('fresh recipes and supplied systems are browseable while the old backlog is archived', async () => {
  const book = await buildRecipeBook(root);
  const archive = JSON.parse(await readFile(path.join(root, 'catalog/archive.json'), 'utf8'));
  const fresh = book.recipes.filter(entry => entry.recipe.id.startsWith('fresh-'));
  assert.equal(fresh.length, 4);
  assert.ok(fresh.every(entry => entry.dishCount === 0));
  assert.equal(book.recipes.length, 13);
  for (const id of ['standard-service-business', 'standard-developer-portfolio', 'standard-developer-homepage']) {
    const entry = book.recipes.find(item => item.recipe.id === id);
    assert.ok(entry, `Standard website recipe ${id} is active`);
    assert.equal(entry.dishCount, 0);
  }
  for (const id of archive.archivedRecipeIds) assert.ok(!book.recipes.some(entry => entry.recipe.id === id));
  for (const id of ['extend-conduit-design-system', 'extend-qrng-design-system', 'extend-emotitone-design-system']) {
    const entry = book.recipes.find(item => item.recipe.id === id);
    assert.ok(entry.fixtures.some(fixture => fixture.path.includes('/upstream/') && fixture.text?.length > 100));
  }
});
