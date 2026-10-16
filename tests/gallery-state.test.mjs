import assert from 'node:assert/strict';
import test from 'node:test';
import { readGalleryState, writeGalleryState } from '../src/lib/url-state.ts';
import { axisSetsForDish, comparisonConfigurations, dishesFor, observationDisagreements, observationsForDish, briefChanged, catalogChanges, skillForDish } from '../src/lib/registry.ts';
import { latestDish, resolveRecipeSelection, selectionForDish } from '../src/lib/selection.ts';

test('links preserve repeated configuration slots, and selected Dishes', () => {
  const calls = [];
  globalThis.window = { location: { pathname: '/' }, history: { pushState: (...args) => calls.push(args), replaceState: (...args) => calls.push(args) } };
  const state = readGalleryState('?view=models&family=Luna&recipe=a&models=luna,luna&dishes=first,second&brief=1');
  assert.deepEqual(state.models, ['luna', 'luna']);
  writeGalleryState(state);
  assert.deepEqual(readGalleryState(calls[0][2].slice(1)), state);
  delete globalThis.window;
});

test('legacy domain deep links translate without emitting retired vocabulary', () => {
  assert.equal(readGalleryState('?domain=ui-visual').cuisine, 'ui-visual');
  assert.equal(readGalleryState('?view=untrusted').view, 'dishes');
  assert.equal(readGalleryState('?models=a,b,c,d').models.length, 3);
});

test('Repeats share recipe hash and configuration and retain deterministic order', () => {
  const make = (id, hash, config, time) => ({ id, recipe: { id: 'r', hash }, identity: { configHash: config }, executedAt: time });
  const dishes = [make('b','old','one','2026-01-01'), make('z','new','one','2026-01-02'), make('a','old','one','2026-01-01'), make('c','old','two','2026-01-01')];
  assert.deepEqual(dishesFor(dishes, 'r', 'old', 'one').map((dish) => dish.id), ['a', 'b']);
});

test('a Dish cooked from an older brief is marked, not hidden', () => {
  const current = { id: 'r', recipeHash: 'new' };
  assert.equal(briefChanged({ recipe: { hash: 'old' } }, current), true);
  assert.equal(briefChanged({ recipe: { hash: 'new' } }, current), false);
});

test('a Dish whose configuration or skill left the catalog reports what changed', () => {
  const registry = { configurations: [{ configHash: 'sha256:new' }], skills: [{ id: 'hand-drawn', label: 'Hand-drawn', skillHash: 'sha256:skill-new' }] };
  assert.deepEqual(catalogChanges(registry, { identity: { configHash: 'sha256:new' } }), []);
  assert.deepEqual(catalogChanges(registry, { identity: { configHash: 'sha256:old' }, skill: { id: 'hand-drawn', hash: 'sha256:skill-old' } }), ['configuration', 'skill layer']);
  assert.deepEqual(skillForDish(registry, { skill: { id: 'hand-drawn', hash: 'sha256:skill-old' } }), { id: 'hand-drawn', label: 'Hand-drawn', hash: 'sha256:skill-old', historical: true });
});

test('historical configurations stay selectable after a current configuration changes', () => {
  const oldConfiguration = { id: 'luna', model: 'old-model', configHash: 'sha256:old' };
  const configs = comparisonConfigurations({
    configurations: [{ id: 'luna', model: 'new-model', configHash: 'sha256:new' }],
    dishes: [{ identity: { configHash: 'sha256:old' }, receipt: { configuration: oldConfiguration } }, { identity: { configHash: 'sha256:new' } }],
  });
  assert.equal(configs.length, 2);
  assert.equal(configs[1].model, 'old-model');
  assert.equal(configs[1].configHash, 'sha256:old');
  assert.equal(configs[1].historical, true);
  assert.notEqual(configs[0].id, configs[1].id);
});

test('human and Jev observations remain distinct and disagreements are preserved', () => {
  const dish = { id: 'dish-one', dishHash: 'sha256:dish', recipe: { id: 'recipe-one' } };
  const axisSet = { rubricHash: 'sha256:rubric', contexts: [{ kind: 'recipe', id: 'recipe-one' }] };
  const observation = (kind, levelId) => ({ dishId: dish.id, dishHash: dish.dishHash, axisSet: { hash: axisSet.rubricHash }, source: { kind }, axes: [{ axisId: 'care', levelId }] });
  const observations = [observation('human', 'specific'), observation('jev', 'partial')];
  assert.equal(observationsForDish(observations, dish).length, 2);
  assert.equal(axisSetsForDish([axisSet], dish).length, 1);
  assert.deepEqual(observationDisagreements(observations), [{ axisId: 'care', human: 'specific', jev: 'partial', rubricHash: 'sha256:rubric' }]);
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

test('an older-brief Dish stays selectable under its recipe', () => {
  const oldDish = selectionDish('old-dish', 'old', 'sha256:current', '2026-01-01T00:00:00Z');
  const resolved = resolveRecipeSelection(selectionRegistry([oldDish]), selectionRecipe, { models: ['current-config'], dishes: ['old-dish'] });
  assert.equal(resolved.slots[0].dish.id, 'old-dish');
  assert.equal(briefChanged(resolved.slots[0].dish, selectionRecipe), true);
});

test('Repeats do not mix briefs', () => {
  const old = selectionDish('old-dish', 'old', 'sha256:current', '2026-01-01T00:00:00Z');
  const fresh = selectionDish('new-dish', 'current', 'sha256:current', '2026-01-02T00:00:00Z');
  const registry = selectionRegistry([old, fresh]);
  const latest = resolveRecipeSelection(registry, selectionRecipe, { models: ['current-config'], dishes: [] });
  assert.deepEqual(latest.slots[0].repeats.map((dish) => dish.id), ['new-dish']);
  const picked = resolveRecipeSelection(registry, selectionRecipe, { models: ['current-config'], dishes: ['old-dish'] });
  assert.deepEqual(picked.slots[0].repeats.map((dish) => dish.id), ['old-dish']);
});

test('selectionForDish uses the exact preserved configuration snapshot', () => {
  const dish = selectionDish('preserved-dish', 'old', 'sha256:preserved', '2026-01-01T00:00:00Z');
  assert.deepEqual(selectionForDish(selectionRegistry([dish]), dish), {
    recipe: 'r', models: ['preserved-config'], skills: ['none'], dishes: ['preserved-dish'],
  });
});

test('a selected Repeat is preserved while defaults choose the latest Repeat', () => {
  const first = selectionDish('first', 'old', 'sha256:current', '2026-01-01T00:00:00Z');
  const second = selectionDish('second', 'old', 'sha256:current', '2026-01-02T00:00:00Z');
  const registry = selectionRegistry([second, first]);
  const selected = resolveRecipeSelection(registry, selectionRecipe, {
    models: ['current-config'], dishes: ['first'],
  });
  const defaulted = resolveRecipeSelection(registry, selectionRecipe, {
    models: ['current-config'], dishes: [],
  });
  assert.deepEqual(selected.slots[0].repeats.map((dish) => dish.id), ['first', 'second']);
  assert.equal(selected.slots[0].dish.id, 'first');
  assert.equal(defaulted.slots[0].dish.id, 'second');
});
