import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadDishes } from '../lib/taste/registry.mjs';
import { loadCatalog } from '../lib/taste/catalog.mjs';
import { readDishSidecars, verifyInputs } from '../lib/taste/receipts.mjs';
import { buildRecipeBook } from '../lib/taste/recipe-book.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('published Dishes keep their recipe identity and carry verified input and receipt sidecars', async () => {
  const [dishes, catalog] = await Promise.all([loadDishes(root), loadCatalog(root)]);
  const ids = new Set(dishes.map(dish => dish.recipe.id));
  assert.equal(dishes.length, 42);
  assert.equal(ids.size, 20);
  for (const dish of dishes) {
    assert.ok(catalog.recipes.some(recipe => recipe.id === dish.recipe.id), `${dish.recipe.id} is still in the catalog`);
    const directory = path.join(root, 'dishes', dish.id);
    const { inputs, receipt } = await readDishSidecars(directory);
    assert.equal(inputs.recipe.hash, dish.recipe.hash);
    assert.deepEqual(await verifyInputs(directory, inputs), []);
    assert.equal(receipt.configuration.configHash, dish.identity.configHash);
  }
});

test('the seventeen active recipes are cooked and browseable while the old backlog is archived', async () => {
  const book = await buildRecipeBook(root);
  const archive = JSON.parse(await readFile(path.join(root, 'catalog/archive.json'), 'utf8'));
  const fresh = book.recipes.filter(entry => entry.recipe.id.startsWith('fresh-'));
  assert.equal(fresh.length, 4);
  assert.ok(fresh.every(entry => entry.dishCount === 2));
  assert.equal(book.recipes.length, 17);
  const webRecipes = book.recipes.filter(entry => entry.recipe.kind === 'web');
  const sessionRecipes = book.recipes.filter(entry => entry.recipe.kind === 'session');
  assert.equal(webRecipes.length, 10);
  assert.ok(webRecipes.every(entry => entry.dishCount === 2));
  assert.equal(sessionRecipes.length, 7);
  assert.ok(sessionRecipes.every(entry => entry.dishCount === 1));
  assert.equal(book.archivedCount, 54);
  assert.equal(archive.archivedRecipeIds.length, 54);
  for (const id of ['responsive-product-launch', 'shared-result-ritual', 'permission-ladder-publish']) {
    assert.ok(archive.archivedRecipeIds.includes(id));
    assert.ok(!book.recipes.some(entry => entry.recipe.id === id));
  }
  for (const id of ['standard-service-business', 'standard-developer-portfolio', 'standard-developer-homepage']) {
    const entry = book.recipes.find(item => item.recipe.id === id);
    assert.ok(entry, `Standard website recipe ${id} is active`);
    assert.equal(entry.dishCount, 2);
  }
  for (const id of archive.archivedRecipeIds) assert.ok(!book.recipes.some(entry => entry.recipe.id === id));
  for (const id of ['extend-conduit-design-system', 'extend-qrng-design-system', 'extend-emotitone-design-system']) {
    const entry = book.recipes.find(item => item.recipe.id === id);
    assert.ok(entry.fixtures.some(fixture => fixture.path.includes('/upstream/') && fixture.text?.length > 100));
  }
});
