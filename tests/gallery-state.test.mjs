import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readGalleryState, writeGalleryState } from '../src/lib/url-state.ts';
import { axisSetsForDish, comparisonConfigurations, serviceTierDrift, dishesFor, modelFamily, observationDisagreements, observationsForDish, briefChanged, catalogChanges, skillForDish } from '../src/lib/registry.ts';
import { claudeModelName, configurationFacets, configurationHeading, differenceNote, differingDimensions, environmentKey, environmentLabel, environmentName, harnessLabel } from '../src/lib/configuration-label.ts';
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
  assert.equal(readGalleryState('?models=a,b,c,d,e,f,g').models.length, 6, 'six panes is the most a link keeps');
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

test('historical configurations still report catalog changes after gallery reconstruction', () => {
  const old = selectionDish('old', 'old', 'sha256:old', '2026-01-01T00:00:00Z');
  old.receipt = { configuration: { id: 'model', model: 'old-model', configHash: 'sha256:old' } };
  const registry = { configurations: [{ id: 'model', configHash: 'sha256:new' }], dishes: [old], skills: [] };
  registry.configurations = comparisonConfigurations(registry);
  assert.deepEqual(catalogChanges(registry, old), ['configuration']);
  assert.deepEqual(catalogChanges(registry, { identity: { configHash: 'sha256:new' } }), []);
});

test('Dish URLs survive configuration edits and skill repins while filters follow the catalog', () => {
  const oldConfig = { id: 'model', model: 'old-model', configHash: 'sha256:old-config' };
  const old = {
    ...selectionDish('old', 'old', oldConfig.configHash, '2026-01-01T00:00:00Z'),
    skill: { id: 'method', hash: 'sha256:old-skill' }, receipt: { configuration: oldConfig },
  };
  const before = { configurations: [oldConfig], skills: [{ id: 'method', skillHash: old.skill.hash }], dishes: [old] };
  const link = selectionForDish(before, old);
  assert.deepEqual(link.skills, ['sha256:old-skill']);
  const fresh = {
    ...selectionDish('fresh', 'current', 'sha256:new-config', '2026-01-02T00:00:00Z'),
    skill: { id: 'method', hash: 'sha256:new-skill' },
  };
  const after = {
    configurations: [{ ...oldConfig, configHash: fresh.identity.configHash }],
    skills: [{ id: 'method', skillHash: fresh.skill.hash }], dishes: [old, fresh],
  };
  after.configurations = comparisonConfigurations(after);
  // Both newly serialized hashes and old mutable-id links retain the explicit Dish.
  for (const skills of [link.skills, ['method']]) {
    const { slots: [slot] } = resolveRecipeSelection(after, selectionRecipe, { ...link, skills });
    assert.equal(slot.dish.id, old.id);
    assert.equal(slot.config.configHash, old.identity.configHash);
    assert.equal(slot.skillKey, old.skill.hash);
    assert.deepEqual(slot.repeats.map(dish => dish.id), [old.id]);
  }
  const filtered = resolveRecipeSelection(after, selectionRecipe, { models: ['model'], skills: ['method'], dishes: [] });
  assert.equal(filtered.slots[0].dish.id, fresh.id);
  assert.equal(filtered.slots[0].config.configHash, fresh.identity.configHash);
  const dishOnly = resolveRecipeSelection(after, selectionRecipe, { models: [], skills: [], dishes: [old.id] });
  assert.equal(dishOnly.slots[0].dish.id, old.id);
});

test('explicit Dish slots retain independent identities and unavailable Dishes stay empty', () => {
  const plain = selectionDish('plain', 'current', 'sha256:current', '2026-01-01T00:00:00Z');
  const layered = { ...selectionDish('layered', 'old', 'sha256:preserved', '2026-01-02T00:00:00Z'), skill: { id: 'method', hash: 'sha256:skill' } };
  const foreign = { ...plain, id: 'foreign', recipe: { id: 'another-recipe', hash: 'current' } };
  const registry = selectionRegistry([plain, layered, foreign]);
  const { slots } = resolveRecipeSelection(registry, selectionRecipe, {
    models: ['current-config', 'current-config', 'current-config'],
    skills: ['method', 'none', 'none'], dishes: ['plain', 'layered', 'foreign'],
  });
  assert.equal(slots[0].dish.id, plain.id);
  assert.equal(slots[0].skillKey, 'none');
  assert.equal(slots[1].dish.id, layered.id);
  assert.equal(slots[1].config.configHash, layered.identity.configHash);
  assert.equal(slots[1].skillKey, layered.skill.hash);
  assert.equal(slots[2].dish, undefined);
  assert.deepEqual(slots[2].repeats, []);
  const missing = resolveRecipeSelection(registry, selectionRecipe, { models: ['current-config'], skills: [], dishes: ['deleted'] });
  assert.equal(missing.slots[0].dish, undefined);
});

test('harness and environment filters are URL-addressable and default to all', () => {
  const calls = [];
  globalThis.window = { location: { pathname: '/' }, history: { pushState: (...args) => calls.push(args), replaceState: (...args) => calls.push(args) } };
  assert.equal(readGalleryState('').harness, 'all');
  assert.equal(readGalleryState('').environment, 'all');
  const state = readGalleryState('?harness=hermes&environment=personal:rose&tier=default');
  assert.equal(state.harness, 'hermes');
  assert.equal(state.environment, 'personal:rose');
  writeGalleryState(state);
  assert.equal(new URLSearchParams(calls[0][2].slice(1)).get('environment'), 'personal:rose');
  assert.deepEqual(readGalleryState(calls[0][2].slice(1)), state);
  writeGalleryState({ ...state, harness: 'all', environment: 'all' });
  assert.equal(calls[1][2].includes('environment'), false);
  delete globalThis.window;
});

test('model families cover Claude ids in both spellings without changing existing families', () => {
  for (const [model, family] of [['claude-opus-5-5', 'Opus'], ['claude-sonnet-5-5', 'Sonnet'], ['claude-haiku-5-5', 'Haiku'], ['claude-fable-5-1', 'Fable'], ['anthropic/claude-opus-5.5', 'Opus'], ['anthropic/claude-sonnet-5.5', 'Sonnet'], ['anthropic/claude-fable-5.1', 'Fable']]) assert.equal(modelFamily(model), family, model);
  for (const [model, family] of [['gpt-5.6-sol', 'Sol'], ['gpt-5.6-terra', 'Terra'], ['gpt-5.6-luna', 'Luna'], ['composer-2.5[fast=false]', 'Composer'], ['some-other-model', 'some-other-model']]) assert.equal(modelFamily(model), family, model);
  assert.equal(claudeModelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(claudeModelName('anthropic/claude-opus-5.5'), 'Opus 5.5');
  assert.equal(claudeModelName('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(claudeModelName('claude-opus-4-20250514'), undefined, 'a date suffix is not a minor version');
  assert.equal(claudeModelName('gpt-5.6-sol'), undefined);
});

const profile = { id: 'p', label: 'p', runtime: 'linux-host', sandbox: 'danger-full-access', approvalPolicy: 'never', nativeWeb: 'disabled', networkPolicy: 'not-enforced', filesystemBoundary: 'not-a-secrecy-boundary' };
const configuration = (id, harness, environment, harnessProfile, extra = {}) => ({
  id, harness, model: 'claude-opus-5-5', reasoningEffort: 'high', serviceTier: 'default', personality: 'none', capabilities: ['files', 'shell'], configHash: `sha256:${id}`,
  executionProfile: { ...profile, ...(environment && { environment }), ...(harnessProfile && { harnessProfile }) }, ...extra,
});
const claudeClean = configuration('claude-clean', 'claude-code', 'clean');
const claudePersonal = configuration('claude-personal', 'claude-code', 'personal');
const hermesPersonal = configuration('hermes-personal', 'hermes', 'personal', 'rose', { model: 'anthropic/claude-opus-5.5' });
const legacy = configuration('legacy', 'codex-cli', undefined, undefined, { model: 'gpt-5.6-sol' });

test('harness and environment labels read plainly and unknown harnesses keep their id', () => {
  assert.deepEqual(['claude-code', 'hermes', 'codex-cli', 'cursor-agent', 'future-harness'].map(harnessLabel), ['Claude Code', 'Hermes', 'Codex CLI', 'Cursor Agent', 'future-harness']);
  assert.equal(environmentLabel(claudeClean), 'Clean');
  assert.equal(environmentLabel(hermesPersonal), 'Personal · rose');
  assert.equal(environmentLabel(hermesPersonal, false), 'Personal');
  assert.equal(environmentLabel(legacy), undefined);
  assert.equal(environmentName(legacy), 'Not declared');
  assert.equal(environmentName(claudeClean), 'Clean');
  assert.deepEqual([claudeClean, hermesPersonal, legacy].map(environmentKey), ['clean', 'personal:rose', 'undeclared']);
  assert.equal(configurationHeading(claudeClean, 'Opus'), 'Opus 5.5 · High · Claude Code · Clean');
  assert.equal(configurationHeading(hermesPersonal, 'Opus'), 'Opus 5.5 · High · Hermes · Personal · rose');
  assert.equal(configurationHeading(legacy, 'Sol'), 'Sol · High · Codex CLI');
});

test('facets list the values present, so a single-harness catalog has nothing to choose', () => {
  assert.deepEqual(configurationFacets([legacy, { ...legacy, id: 'other' }]), { harnesses: [{ id: 'codex-cli', label: 'Codex CLI' }], environments: [{ id: 'undeclared', label: 'Not declared' }] });
  assert.deepEqual(configurationFacets([claudeClean, claudePersonal, hermesPersonal]), {
    harnesses: [{ id: 'claude-code', label: 'Claude Code' }, { id: 'hermes', label: 'Hermes' }],
    environments: [{ id: 'clean', label: 'Clean' }, { id: 'personal', label: 'Personal' }, { id: 'personal:rose', label: 'Personal · rose' }],
  });
});

test('the comparison note names the one dimension that differs, without crediting the harness alone', () => {
  const slot = (config, skillKey = 'none') => ({ config, skillKey });
  assert.deepEqual(differingDimensions([slot(claudeClean), slot(claudeClean)]), []);
  assert.deepEqual(differingDimensions([slot(claudeClean), slot(claudePersonal)]), ['environment']);
  assert.match(differenceNote(['environment']), /^Same brief · only the environment differs/);
  // The same model under Hermes' own spelling, with its own profile, is still only a harness difference.
  assert.deepEqual(differingDimensions([slot(claudePersonal), slot(hermesPersonal)]), ['harness']);
  assert.match(differenceNote(['harness']), /^Same brief · only the harness differs · its own prompt, tools and defaults come with it/);
  assert.deepEqual(differingDimensions([slot(hermesPersonal), slot({ ...hermesPersonal, executionProfile: { ...hermesPersonal.executionProfile, harnessProfile: 'other' } })]), ['environment']);
  assert.deepEqual(differingDimensions([slot(claudeClean), slot({ ...claudeClean, reasoningEffort: 'max' })]), ['effort']);
  assert.deepEqual(differingDimensions([slot(claudeClean), slot(claudeClean, 'sha256:skill')]), ['skill layer']);
  assert.deepEqual(differingDimensions([slot(claudeClean), slot({ ...hermesPersonal, reasoningEffort: 'max' })]), ['effort', 'harness', 'environment']);
  assert.equal(differenceNote(['effort', 'harness', 'environment']), 'Same brief · effort, harness, environment differ');
  assert.equal(differenceNote([]), undefined);
});

test('service tier drift compares the observed tier with the requested tier, honouring the fast to priority alias', () => {
  // Publication records serviceTier as the observed value, so it can never disagree with itself.
  assert.equal(serviceTierDrift({ serviceTier: 'priority', requestedServiceTier: 'default', observedServiceTier: 'priority' }), true);
  assert.equal(serviceTierDrift({ serviceTier: 'default', requestedServiceTier: 'priority', observedServiceTier: 'default' }), true);
  assert.equal(serviceTierDrift({ serviceTier: 'priority', requestedServiceTier: 'fast', observedServiceTier: 'priority' }), false);
  assert.equal(serviceTierDrift({ serviceTier: 'default', requestedServiceTier: 'default', observedServiceTier: 'default' }), false);
  assert.equal(serviceTierDrift({ serviceTier: 'default' }), false);
  assert.equal(serviceTierDrift({ serviceTier: 'default', requestedServiceTier: 'priority' }), false);
});

test('the main artifact pane receives its Dish reviews, not an empty list', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /<ArtifactPane[^>]*reviews=\{\[\]\}/u);
  assert.match(app, /<ArtifactPane[^>]*reviews=\{reviewsForDish\(registry\.reviews, dish\)\}/u);
});
