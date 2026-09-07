import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadDishes } from '../lib/taste/registry.mjs';
import { loadRecipeRevisions } from '../lib/taste/revisions.mjs';
import { buildRecipeBook } from '../lib/taste/recipe-book.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('published Dishes retain their exact executed recipe identities through revisions', async () => {
  const [dishes, revisions] = await Promise.all([loadDishes(root), loadRecipeRevisions(root)]);
  const ids = new Set(dishes.map(dish => dish.recipe.id));
  assert.equal(ids.size, 13);
  for (const id of ids) {
    const dish = dishes.find(item => item.recipe.id === id);
    const revision = revisions.find(item => item.hash === dish.recipe.hash && item.recipeId === id);
    assert.ok(revision.display.title.length > 0);
    assert.equal(revision.hash, dish.recipe.hash);
  }
});

test('the ten active recipes are cooked and browseable while the old backlog is archived', async () => {
  const book = await buildRecipeBook(root);
  const archive = JSON.parse(await readFile(path.join(root, 'catalog/archive.json'), 'utf8'));
  const fresh = book.recipes.filter(entry => entry.recipe.id.startsWith('fresh-'));
  assert.equal(fresh.length, 4);
  assert.ok(fresh.every(entry => entry.dishCount === 1));
  assert.equal(book.recipes.length, 10);
  assert.ok(book.recipes.every(entry => entry.dishCount === 1));
  assert.equal(book.archivedCount, 54);
  assert.equal(archive.archivedRecipeIds.length, 54);
  for (const id of ['responsive-product-launch', 'shared-result-ritual', 'permission-ladder-publish']) {
    assert.ok(archive.archivedRecipeIds.includes(id));
    assert.ok(!book.recipes.some(entry => entry.recipe.id === id));
  }
  for (const id of ['standard-service-business', 'standard-developer-portfolio', 'standard-developer-homepage']) {
    const entry = book.recipes.find(item => item.recipe.id === id);
    assert.ok(entry, `Standard website recipe ${id} is active`);
    assert.equal(entry.dishCount, 1);
  }
  for (const id of archive.archivedRecipeIds) assert.ok(!book.recipes.some(entry => entry.recipe.id === id));
  for (const id of ['extend-conduit-design-system', 'extend-qrng-design-system', 'extend-emotitone-design-system']) {
    const entry = book.recipes.find(item => item.recipe.id === id);
    assert.ok(entry.fixtures.some(fixture => fixture.path.includes('/upstream/') && fixture.text?.length > 100));
  }
});
