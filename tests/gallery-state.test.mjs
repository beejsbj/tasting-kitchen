import assert from 'node:assert/strict';
import test from 'node:test';
import { readGalleryState, writeGalleryState } from '../src/lib/url-state.ts';
import { comparisonConfigurations, dishesFor, recipeAtRevision } from '../src/lib/registry.ts';
import { latestDish, resolveRecipeSelection, selectionForDish } from '../src/lib/selection.ts';

test('links preserve repeated configuration slots, exact revision and selected Dishes', () => {
  const calls = [];
  globalThis.window = { location: { pathname: '/' }, history: { pushState: (...args) => calls.push(args), replaceState: (...args) => calls.push(args) } };
  const state = readGalleryState('?view=models&family=Luna&recipe=a&revision=sha256%3Aabc&models=luna,luna&dishes=first,second&brief=1');
  assert.deepEqual(state.models, ['luna', 'luna']);
  writeGalleryState(state);
  assert.deepEqual(readGalleryState(calls[0][2].slice(1)), state);
  delete globalThis.window;
});

test('legacy domain deep links translate without emitting retired vocabulary', () => {
  assert.equal(readGalleryState('?domain=ui-visual').cuisine, 'ui-visual');
  assert.equal(readGalleryState('?view=untrusted').view, 'recipes');
  assert.equal(readGalleryState('?models=a,b,c,d').models.length, 3);
});

test('Repeats share exact revision/configuration and retain deterministic order', () => {
  const make = (id, hash, config, time) => ({ id, recipe: { id: 'r', hash }, identity: { configHash: config }, executedAt: time });
  const dishes = [make('b','old','one','2026-01-01'), make('z','new','one','2026-01-02'), make('a','old','one','2026-01-01'), make('c','old','two','2026-01-01')];
  assert.deepEqual(dishesFor(dishes, 'r', 'old', 'one').map((dish) => dish.id), ['a', 'b']);
});

test('inspecting an old Dish uses its executed brief and input URLs', () => {
  const current = { id: 'r', recipeHash: 'new', turns: [{ content: 'new private draft' }], origin: 'hybrid' };
  const snapshot = { recipeId: 'r', hash: 'old', version: '1.0.0', execution: { turns: [{ content: 'original brief' }], setup: { fixtures: [{ url: '/old/exact-input' }] } }, display: { title: 'Original', summary: 'Preserved', lineage: 'textbook', cuisines: ['ui'] } };
  const viewed = recipeAtRevision(current, snapshot);
  assert.equal(viewed.turns[0].content, 'original brief');
  assert.equal(viewed.setup.fixtures[0].url, '/old/exact-input');
  assert.equal(viewed.recipeHash, 'old');
});

test('historical configurations stay selectable after a current configuration changes', () => {
  const configs = comparisonConfigurations({
    configurations: [{ id: 'luna', model: 'new-model', configHash: 'sha256:new' }],
    configurationRevisions: [{ hash: 'sha256:old', configuration: { id: 'luna', model: 'old-model' } }, { hash: 'sha256:new', configuration: { id: 'luna', model: 'new-model' } }],
    dishes: [{ identity: { configHash: 'sha256:old' } }],
  });
  assert.equal(configs.length, 2);
  assert.equal(configs[1].model, 'old-model');
  assert.equal(configs[1].configHash, 'sha256:old');
  assert.equal(configs[1].historical, true);
  assert.notEqual(configs[0].id, configs[1].id);
});

const selectionRecipe = { id: 'r', recipeHash: 'current' };
const selectionConfigs = [
  { id: 'current-config', configHash: 'sha256:current', model: 'sol-current' },
  { id: 'preserved-config', configHash: 'sha256:preserved', model: 'sol-preserved', historical: true },
];
const selectionDish = (id, hash, configHash, executedAt) => ({
  id, recipe: { id: 'r', hash }, identity: { configHash }, executedAt,
});
const selectionRegistry = (dishes) => ({ configurations: selectionConfigs, dishes });

test('latestDish orders by execution time then Dish ID', () => {
  const older = selectionDish('z', 'old', 'sha256:current', '2026-01-01T00:00:00Z');
  const sameTimeLowerId = selectionDish('a', 'old', 'sha256:current', '2026-01-02T00:00:00Z');
  const sameTimeHigherId = selectionDish('b', 'old', 'sha256:current', '2026-01-02T00:00:00Z');
  assert.equal(latestDish([older, sameTimeLowerId, sameTimeHigherId]).id, 'b');
});

test('an explicit missing revision has no cross-revision fallback', () => {
  const oldDish = selectionDish('old-dish', 'old', 'sha256:current', '2026-01-01T00:00:00Z');
  const resolved = resolveRecipeSelection(selectionRegistry([oldDish]), selectionRecipe, {
    revision: 'missing', models: ['current-config'], dishes: ['old-dish'],
  });
  assert.equal(resolved.recipeHash, 'missing');
  assert.equal(resolved.slots.length, 1);
  assert.equal(resolved.slots[0].repeats.length, 0);
  assert.equal(resolved.slots[0].dish, undefined);
});

test('selectionForDish uses the exact preserved configuration snapshot', () => {
  const dish = selectionDish('preserved-dish', 'old', 'sha256:preserved', '2026-01-01T00:00:00Z');
  assert.deepEqual(selectionForDish(selectionRegistry([dish]), dish), {
    recipe: 'r', revision: 'old', models: ['preserved-config'], dishes: ['preserved-dish'],
  });
});

test('a selected Repeat is preserved while defaults choose the latest Repeat', () => {
  const first = selectionDish('first', 'old', 'sha256:current', '2026-01-01T00:00:00Z');
  const second = selectionDish('second', 'old', 'sha256:current', '2026-01-02T00:00:00Z');
  const registry = selectionRegistry([second, first]);
  const selected = resolveRecipeSelection(registry, selectionRecipe, {
    revision: 'old', models: ['current-config'], dishes: ['first'],
  });
  const defaulted = resolveRecipeSelection(registry, selectionRecipe, {
    revision: 'old', models: ['current-config'], dishes: [],
  });
  assert.deepEqual(selected.slots[0].repeats.map((dish) => dish.id), ['first', 'second']);
  assert.equal(selected.slots[0].dish.id, 'first');
  assert.equal(defaulted.slots[0].dish.id, 'second');
});
