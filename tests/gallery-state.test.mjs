import assert from 'node:assert/strict';
import test from 'node:test';
import { readGalleryState, writeGalleryState } from '../src/lib/url-state.ts';
import { comparisonConfigurations, dishesFor, recipeAtRevision } from '../src/lib/registry.ts';

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
