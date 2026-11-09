import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readGalleryState, writeGalleryState } from '../src/lib/url-state.ts';
import { axisSetsForDish, comparisonConfigurations, serviceTierDrift, dishesFor, modelFamily, observationDisagreements, observationsForDish, briefChanged, catalogChanges, skillForDish } from '../src/lib/registry.ts';
import { claudeModelName, configurationFacets, configurationHeading, differenceNote, differingDimensions, environmentKey, environmentKeyLabel, environmentLabel, environmentName, harnessKey, harnessLabel, slugModelName } from '../src/lib/configuration-label.ts';
import { latestDish, resolveRecipeSelection, selectionForDish } from '../src/lib/selection.ts';
import { liveConnectionsOff, liveHomeName, liveMemoryLine, liveSetupLine } from '../src/lib/live-receipt.ts';

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

test('snapshot Repeats share a setup digest: a Dish of an earlier setup is its own group', () => {
  const snap = (id, digest, executedAt) => ({ ...selectionDish(id, 'current', 'sha256:current', executedAt), identity: { configHash: 'sha256:current', setupDigest: digest } });
  const registry = selectionRegistry([snap('first', 'sha256:setup-a', '2026-01-01T00:00:00Z'), snap('second', 'sha256:setup-a', '2026-01-02T00:00:00Z'), snap('edited', 'sha256:setup-b', '2026-01-03T00:00:00Z')]);
  const latest = resolveRecipeSelection(registry, selectionRecipe, { models: ['current-config'], dishes: [] });
  assert.deepEqual(latest.slots[0].repeats.map((dish) => dish.id), ['edited'], 'the newest setup stands alone');
  const earlier = resolveRecipeSelection(registry, selectionRecipe, { models: ['current-config'], dishes: ['first'] });
  assert.deepEqual(earlier.slots[0].repeats.map((dish) => dish.id), ['first', 'second']);
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
  const state = readGalleryState('?harness=hermes&environment=snapshot:rose&tier=default');
  assert.equal(state.harness, 'hermes');
  assert.equal(state.environment, 'snapshot:rose');
  writeGalleryState(state);
  assert.equal(new URLSearchParams(calls[0][2].slice(1)).get('environment'), 'snapshot:rose');
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
const toggles = (memory, connections) => ({ memory, connections });
const withProfile = (config, extra) => ({ ...config, executionProfile: { ...config.executionProfile, ...extra } });
const claudePersonal = withProfile(configuration('claude-snapshot', 'claude-code', 'snapshot'), toggles('on', 'off'));
const hermesPersonal = withProfile(configuration('hermes-snapshot', 'hermes', 'snapshot', 'rose', { model: 'anthropic/claude-opus-5.5' }), toggles('on', 'off'));
const hermesQuiet = withProfile(hermesPersonal, { memory: 'off' });
const claudeLive = withProfile(configuration('claude-live', 'claude-code', 'live'), toggles('on', 'off'));
const claudeLiveConnected = withProfile(claudeLive, { connections: 'on' });
const legacy = configuration('legacy', 'codex-cli', undefined, undefined, { model: 'gpt-5.6-sol' });

test('harness and environment labels read plainly and unknown harnesses keep their id', () => {
  assert.deepEqual(['claude-code', 'hermes', 'codex-cli', 'cursor-agent', 'future-harness'].map(harnessLabel), ['Claude Code', 'Hermes', 'Codex CLI', 'Cursor Agent', 'future-harness']);
  assert.equal(environmentLabel(claudeClean), 'Clean');
  assert.equal(environmentLabel(hermesPersonal), 'Snapshot · rose');
  assert.equal(environmentLabel(hermesPersonal, false), 'Snapshot');
  assert.equal(environmentLabel(hermesQuiet), 'Snapshot · rose · no memory');
  assert.equal(environmentLabel(hermesQuiet, false), 'Snapshot · no memory', 'the toggles stay when the profile is dropped');
  assert.equal(environmentLabel(claudeLive), 'Live · connections off');
  assert.equal(environmentLabel(claudeLiveConnected), 'Live · connections on');
  assert.equal(environmentLabel(legacy), undefined);
  assert.equal(environmentName(legacy), 'Not declared');
  assert.equal(environmentName(claudeClean), 'Clean');
  assert.deepEqual([claudeClean, hermesPersonal, hermesQuiet, claudeLiveConnected, legacy].map((config) => environmentKey(config)), ['clean', 'snapshot:rose', 'snapshot:rose+no-memory', 'live+connections', 'undeclared']);
  assert.equal(environmentKeyLabel('snapshot:rose+no-memory+connections'), 'Snapshot · rose · no memory · connections on');
  assert.equal(configurationHeading(claudeClean, 'Opus'), 'Opus 5.5 · High · Claude Code · Clean');
  assert.equal(configurationHeading(hermesPersonal, 'Opus'), 'Opus 5.5 · High · Hermes · Snapshot · rose');
  assert.equal(configurationHeading(claudeLive, 'Opus'), 'Opus 5.5 · High · Claude Code · Live · connections off');
  assert.equal(configurationHeading(legacy, 'Sol'), 'Sol · High · Codex CLI');
});

const codexLive = withProfile(configuration('codex-live', 'codex-cli', 'live', undefined, { model: 'gpt-6.1-sol' }), toggles('on', 'off'));
const cursorLive = withProfile(configuration('cursor-live', 'cursor-agent', 'live', undefined, { model: 'composer-2.5[fast=false]', reasoningEffort: 'adaptive' }), toggles('on', 'on'));
const hermesOtto = withProfile(configuration('hermes-otto-live', 'hermes', 'live', 'otto', { model: 'gpt-6-luna' }), toggles('on', 'off'));
const hermesDefault = withProfile(hermesOtto, { harnessProfile: 'default' });

test('live labels name the harness, the profile and what is off, so a live Dish never reads as clean', () => {
  assert.equal(configurationHeading(codexLive, 'Sol'), 'Sol · High · Codex CLI · Live · connections off');
  assert.equal(configurationHeading(cursorLive, 'Composer'), 'Composer · Adaptive · Cursor Agent · Live · connections on');
  assert.equal(configurationHeading(hermesOtto, 'Luna'), 'Luna · High · Hermes · Live · otto · connections off');
  assert.equal(environmentLabel(hermesDefault), 'Live · default · connections off');
  assert.equal(environmentLabel(withProfile(codexLive, { connections: 'on' })), 'Live · connections on');
  assert.deepEqual([hermesOtto, hermesDefault, codexLive].map((config) => environmentKey(config)), ['live:otto', 'live:default', 'live']);
  assert.equal(environmentKeyLabel('live:otto'), 'Live · otto · connections off');
  assert.deepEqual(configurationFacets([codexLive, cursorLive, hermesOtto, hermesDefault]).environments.map((item) => item.label), ['Live · connections off', 'Live · connections on', 'Live · otto · connections off', 'Live · default · connections off']);
});

test('live receipts say where the Run wrote and which toggles the harness could not switch', () => {
  const short = (hash) => hash.slice(0, 8);
  assert.equal(liveHomeName(codexLive), '~/.codex');
  assert.equal(liveHomeName(hermesOtto), 'otto profile');
  assert.match(liveSetupLine(codexLive, { digestAtStart: 'abcdef0123456789' }, short), /^his real ~\/\.codex, writes kept \(session rollouts, history, logs.*\) · abcdef01 at start$/);
  assert.match(liveSetupLine(hermesOtto, {}, short), /^his real otto profile, writes kept \(its session database, memory and plugin hooks\)$/);
  assert.match(liveSetupLine(cursorLive, {}, short), /~\/\.cursor, writes kept \(chats and CLI state\)/);
  assert.equal(liveMemoryLine(claudeLive, 'on'), 'on · writes to your real memory');
  assert.match(liveMemoryLine(cursorLive, 'on'), /cannot switch it off/);
  assert.match(liveMemoryLine(hermesOtto, 'on'), /cannot switch it off/);
  assert.match(liveMemoryLine(codexLive, 'on'), /not forced/);
  assert.equal(liveMemoryLine(codexLive, 'off'), 'off');
  assert.match(liveConnectionsOff(hermesOtto), /MCP servers and plugins can still start/);
  assert.match(liveConnectionsOff(codexLive), /plugins, apps and each MCP server/);
  assert.equal(liveConnectionsOff(claudeLive), 'off');
});

test('facets list the values present, so a single-harness catalog has nothing to choose', () => {
  assert.deepEqual(configurationFacets([legacy, { ...legacy, id: 'other' }]), { harnesses: [{ id: 'codex-cli', label: 'Codex CLI' }], environments: [{ id: 'undeclared', label: 'Not declared' }] });
  assert.deepEqual(configurationFacets([claudeClean, claudePersonal, hermesPersonal, hermesQuiet, claudeLive]), {
    harnesses: [{ id: 'claude-code', label: 'Claude Code' }, { id: 'hermes', label: 'Hermes' }],
    environments: [{ id: 'clean', label: 'Clean' }, { id: 'snapshot', label: 'Snapshot' }, { id: 'snapshot:rose', label: 'Snapshot · rose' }, { id: 'snapshot:rose+no-memory', label: 'Snapshot · rose · no memory' }, { id: 'live', label: 'Live · connections off' }],
  });
});

test('the comparison note names the one dimension that differs, without crediting the harness alone', () => {
  const slot = (config, skillKey = 'none') => ({ config, skillKey });
  assert.deepEqual(differingDimensions([slot(claudeClean), slot(claudeClean)]), []);
  assert.deepEqual(differingDimensions([slot(claudeClean), slot(claudePersonal)]), ['environment']);
  assert.match(differenceNote(['environment']), /^Same brief · only the environment differs/);
  // The same model under Hermes' own spelling, with its own profile, is still only a harness difference.
  assert.deepEqual(differingDimensions([slot(claudePersonal), slot(hermesPersonal)]), ['harness']);
  assert.match(differenceNote(['harness']), /^Same brief · only the harness differs · its own prompt, tools, route and defaults come with it/);
  assert.deepEqual(differingDimensions([slot(hermesPersonal), slot({ ...hermesPersonal, executionProfile: { ...hermesPersonal.executionProfile, harnessProfile: 'other' } })]), ['environment']);
  // Across harnesses a toggle still counts: memory off against memory on is an environment difference too.
  assert.deepEqual(differingDimensions([slot(claudePersonal), slot(hermesQuiet)]), ['harness', 'environment']);
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
  assert.equal(serviceTierDrift({ serviceTier: 'standard', requestedServiceTier: 'default', observedServiceTier: 'standard' }), false);
  assert.equal(serviceTierDrift({ serviceTier: 'standard', requestedServiceTier: 'priority', observedServiceTier: 'standard' }), true);
  assert.equal(serviceTierDrift({ serviceTier: 'default' }), false);
  assert.equal(serviceTierDrift({ serviceTier: 'default', requestedServiceTier: 'priority' }), false);
});

test('the main artifact pane receives its Dish reviews, not an empty list', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /<ArtifactPane[^>]*reviews=\{\[\]\}/u);
  assert.match(app, /<ArtifactPane[^>]*reviews=\{reviewsForDish\(registry\.reviews, dish\)\}/u);
});

const viaRoute = (id, harness, model, extra = {}) => configuration(id, harness, 'clean', undefined, { model, ...extra, executionProfile: { ...profile, environment: 'clean', route: 'openrouter' } });
const directOpus = viaRoute('direct-opus', 'direct-api', 'anthropic/claude-opus-5.5', { capabilities: [] });
const hermesRouted = viaRoute('hermes-routed', 'hermes', 'anthropic/claude-opus-5.5');
const t3Claude = configuration('t3-claude', 't3', 'clean', undefined, { harnessPath: ['t3', 'claude-code'] });

test('a harness key carries the path and a declared route; labels read them plainly', () => {
  assert.deepEqual([claudeClean, legacy, directOpus, hermesRouted, t3Claude].map(harnessKey), ['claude-code', 'codex-cli', 'direct-api@openrouter', 'hermes@openrouter', 't3>claude-code']);
  assert.deepEqual(['direct-api@openrouter', 'hermes@openrouter', 't3>claude-code', 't3>codex-cli', 'direct-api'].map(harnessLabel), ['Direct API · OpenRouter', 'Hermes · OpenRouter', 'T3 → Claude Code', 'T3 → Codex CLI', 'Direct API']);
  assert.equal(configurationHeading(directOpus, 'Opus'), 'Opus 5.5 · High · Direct API · OpenRouter · Clean');
  assert.equal(configurationHeading(t3Claude, 'Opus'), 'Opus 5.5 · High · T3 → Claude Code · Clean');
  assert.deepEqual(configurationFacets([claudeClean, hermesRouted, directOpus, t3Claude]).harnesses.map((facet) => facet.label), ['Claude Code', 'Hermes · OpenRouter', 'Direct API · OpenRouter', 'T3 → Claude Code']);
  assert.deepEqual(differingDimensions([claudeClean, directOpus].map((config) => ({ config, skillKey: 'none' }))), ['harness', 'other settings'], 'the same model through another delivery path differs by harness');
  assert.deepEqual(differingDimensions([claudeClean, t3Claude].map((config) => ({ config, skillKey: 'none' }))), ['harness']);
});

test('maker/slug models read as their family and name', () => {
  assert.deepEqual(['google/gemini-4-argon', 'x-ai/grok-4.7', 'deepseek/deepseek-v4-pro-0813', 'z-ai/glm-5.3', 'qwen/qwen3.8-max-0902', 'moonshotai/kimi-k3.1-pro'].map(modelFamily), ['Gemini', 'Grok', 'DeepSeek', 'GLM', 'Qwen', 'Kimi']);
  assert.equal(modelFamily('anthropic/claude-opus-5.5'), 'Opus', 'a Claude slug keeps its Claude family');
  assert.deepEqual(['google/gemini-4-argon', 'deepseek/deepseek-v4-pro-0813', 'z-ai/glm-5.3', 'meta/muse-wonder'].map(slugModelName), ['Gemini 4 Argon', 'DeepSeek V4 Pro 0813', 'GLM 5.3', 'Muse Wonder']);
  assert.equal(slugModelName('gpt-5.6-sol'), undefined);
});
