import assert from 'node:assert/strict';
import test from 'node:test';
import { readGalleryState, writeGalleryState } from '../src/lib/url-state.ts';
import { axisOptions, axisValue, carryComparisonSelection, compareByNote, comparisonValues, defaultComparisonSelection, MAX_PANES, modelName, snapshotOptions, toggleComparisonValue } from '../src/lib/configuration-axes.ts';
import { differingDimensions } from '../src/lib/configuration-label.ts';

const profile = { id: 'p', label: 'p', runtime: 'linux-host', sandbox: 'danger-full-access', approvalPolicy: 'never', nativeWeb: 'disabled', networkPolicy: 'not-enforced', filesystemBoundary: 'not-a-secrecy-boundary' };
const configuration = (id, harness, model, reasoningEffort, environment, harnessProfile, extra = {}) => ({
  id, harness, model, reasoningEffort, serviceTier: 'default', personality: 'none', capabilities: ['files', 'shell'], configHash: `sha256:${id}`,
  executionProfile: { ...profile, ...(environment && { environment }), ...(harnessProfile && { harnessProfile }) }, ...extra,
});
const claude = (name, effort, environment) => configuration(`claude-${name}-${effort}-${environment}`, 'claude-code', `claude-${name}-5-5`, effort, environment);
const hermes = (name, effort, environment) => configuration(`hermes-${name}-${effort}-${environment}`, 'hermes', `anthropic/claude-${name}-5.5`, effort, environment, environment === 'personal' ? 'rose' : undefined);
const opusHighClean = claude('opus', 'high', 'clean');
const catalog = [
  opusHighClean, claude('opus', 'max', 'clean'), claude('opus', 'high', 'personal'), claude('sonnet', 'high', 'clean'), claude('sonnet', 'max', 'clean'), claude('haiku', 'high', 'clean'),
  hermes('opus', 'high', 'clean'), hermes('opus', 'high', 'personal'), hermes('sonnet', 'high', 'clean'),
  configuration('codex-sol-high', 'codex-cli', 'gpt-5.6-sol', 'high'),
  configuration('cursor-composer', 'cursor-agent', 'composer-2.5[fast=false]', 'adaptive'),
];
/** Dish counts per configuration id; anything absent is uncooked. */
const counts = (entries) => (config) => entries[config.id] ?? 0;
const cooked = counts({ 'claude-opus-high-clean': 2, 'claude-opus-max-clean': 1, 'claude-opus-high-personal': 1, 'claude-sonnet-high-clean': 1, 'claude-haiku-high-clean': 1, 'hermes-opus-high-clean': 1, 'hermes-opus-high-personal': 1, 'codex-sol-high': 1, 'cursor-composer': 1 });
const byValue = (options) => Object.fromEntries(options.map((option) => [option.value, option]));

test('the URL keeps up to six panes and the compare axis, and drops an unknown axis', () => {
  const calls = [];
  globalThis.window = { location: { pathname: '/' }, history: { pushState: (...args) => calls.push(args), replaceState: (...args) => calls.push(args) } };
  const state = readGalleryState('?recipe=r&models=a,b,c,d,e,f&skills=none,none,none,none,none,none&dishes=one,,,,,&compare=harness');
  assert.equal(MAX_PANES, 6);
  assert.deepEqual(state.models, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(state.compare, 'harness');
  writeGalleryState(state);
  assert.deepEqual(readGalleryState(calls[0][2].slice(1)), state, 'slots and axis round-trip');
  assert.equal(readGalleryState('?compare=vibes').compare, '', 'an unknown axis is ignored');
  assert.equal(readGalleryState('').compare, '');
  writeGalleryState({ ...state, compare: '' });
  assert.equal(new URLSearchParams(calls[1][2].slice(1)).has('compare'), false, 'panes chosen one by one carry no axis');
  delete globalThis.window;
});

test('models read plainly across harness spellings and vendors', () => {
  assert.deepEqual(['claude-opus-5-5', 'anthropic/claude-opus-5.5', 'gpt-5.6-sol', 'gpt-6-astra', 'composer-2.5[fast=false]', 'mystery'].map(modelName), ['Opus 5.5', 'Opus 5.5', 'Sol 5.6', 'Astra 6', 'Composer 2.5', 'mystery']);
  assert.equal(axisValue(hermes('opus', 'high', 'clean'), 'model'), axisValue(opusHighClean, 'model'), 'one model through two harnesses is one axis value');
  assert.equal(axisValue(hermes('opus', 'high', 'personal'), 'environment'), 'personal:rose');
});

test('a pane lists only cooked values and its own, marks uncooked ones, and explains impossible ones', () => {
  const effort = byValue(axisOptions(catalog, opusHighClean, 'effort', cooked));
  assert.deepEqual(Object.keys(effort), ['high', 'max', 'adaptive'], 'efforts with a Dish anywhere on the recipe, in effort order');
  assert.equal(effort.max.status, 'cooked');
  assert.equal(effort.max.config.id, 'claude-opus-max-clean');
  assert.equal(effort.adaptive.status, 'impossible', 'no Opus through Claude Code at adaptive effort');
  assert.equal(effort.adaptive.reason, 'No configuration for Opus 5.5 · Claude Code · Clean · Adaptive');
  assert.equal(axisOptions(catalog, opusHighClean, 'effort', cooked).at(-1).value, 'adaptive', 'impossible values sink below reachable ones');

  const sonnetMax = axisOptions(catalog, claude('sonnet', 'max', 'clean'), 'effort', cooked);
  assert.equal(byValue(sonnetMax).max.status, 'uncooked', 'a configuration that exists without a Dish stays reachable, marked');
  assert.equal(byValue(sonnetMax).max.selected, true);

  const harness = byValue(axisOptions(catalog, opusHighClean, 'harness', cooked));
  assert.equal(harness.hermes.config.id, 'hermes-opus-high-clean', 'a new harness keeps the model, effort and environment');
  assert.deepEqual(harness.hermes.changes, []);
  assert.equal(harness['codex-cli'].status, 'impossible', 'a harness never moves the model');
});

test('changing the model may move lower axes, and the option says how', () => {
  const model = byValue(axisOptions(catalog, opusHighClean, 'model', cooked));
  assert.equal(model['Sonnet 5.5'].config.id, 'claude-sonnet-high-clean', 'the closest configuration keeps harness, environment and effort');
  assert.deepEqual(model['Sonnet 5.5'].changes, []);
  assert.equal(model['gpt-5.6-sol'].config.id, 'codex-sol-high');
  assert.deepEqual(model['gpt-5.6-sol'].changes.map((change) => change.label), ['Codex CLI', 'Unspecified']);
  const fromMax = byValue(axisOptions(catalog, claude('opus', 'max', 'clean'), 'model', cooked));
  assert.equal(fromMax['Sonnet 5.5'].config.id, 'claude-sonnet-max-clean', 'holding effort wins over finding a Dish');
  assert.equal(fromMax['Sonnet 5.5'].status, 'uncooked');
  assert.equal(fromMax['Haiku 5.5'].config.id, 'claude-haiku-high-clean');
  assert.deepEqual(fromMax['Haiku 5.5'].changes.map((change) => change.axis), ['effort']);
});

test('a preserved snapshot beside the current configuration is offered only when it exists', () => {
  const preserved = { ...opusHighClean, id: 'claude-opus-high-clean--old', configHash: 'sha256:old', historical: true };
  assert.deepEqual(snapshotOptions(catalog, opusHighClean).map((config) => config.id), ['claude-opus-high-clean']);
  assert.deepEqual(snapshotOptions([...catalog, preserved], opusHighClean).map((config) => config.id), ['claude-opus-high-clean', 'claude-opus-high-clean--old']);
  const model = byValue(axisOptions([preserved, ...catalog], claude('sonnet', 'high', 'clean'), 'model', counts({ 'claude-opus-high-clean': 1, 'claude-sonnet-high-clean': 1 })));
  assert.equal(model['Opus 5.5'].config.id, 'claude-opus-high-clean', 'the current configuration wins over a preserved twin');
});

test('compare by harness holds model, effort and environment kind, and leads with the held pane', () => {
  const values = comparisonValues(catalog, opusHighClean, 'harness', cooked);
  assert.deepEqual(values.map((item) => [item.value, item.config.id, item.isolated, item.held]), [
    ['claude-code', 'claude-opus-high-clean', true, true],
    ['hermes', 'hermes-opus-high-clean', true, false],
    ['codex-cli', 'codex-sol-high', false, false],
    ['cursor-agent', 'cursor-composer', false, false],
  ]);
  assert.deepEqual(values[2].differs.map((item) => item.axis), ['model', 'environment'], 'a value that cannot hold the rest names what else moves');
  const personal = comparisonValues(catalog, claude('opus', 'high', 'personal'), 'harness', cooked);
  assert.equal(personal.find((item) => item.value === 'hermes').config.id, 'hermes-opus-high-personal', 'personal pairs with personal, whatever the harness profile');
  assert.equal(personal.find((item) => item.value === 'hermes').isolated, true);
  assert.deepEqual(defaultComparisonSelection(values), ['claude-code', 'hermes'], 'a fresh comparison opens the isolated, cooked values');
});

test('compare by model and effort; uncooked isolated values are offered but not opened', () => {
  const models = comparisonValues(catalog, opusHighClean, 'model', cooked);
  assert.deepEqual(models.filter((item) => item.isolated).map((item) => item.label), ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']);
  const efforts = comparisonValues(catalog, claude('sonnet', 'high', 'clean'), 'effort', cooked);
  assert.deepEqual(efforts.filter((item) => item.isolated).map((item) => [item.value, item.dishes]), [['high', 1], ['max', 0]]);
  assert.deepEqual(defaultComparisonSelection(efforts), ['high'], 'Sonnet at Max exists but has no Dish, so it waits to be chosen');
  const layered = comparisonValues(catalog, opusHighClean, 'harness', counts({ 'claude-opus-high-clean': 1 }), cooked);
  assert.deepEqual(layered.map((item) => [item.value, item.dishes]).slice(0, 2), [['claude-code', 1], ['hermes', 0]], 'a value cooked only in another skill layer is listed, uncooked in this one');
});

test('choosing values keeps the held pane first, the limit, and survives a new held pane', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(toggleComparisonValue(['a', 'c'], 'b', 'a', order), ['a', 'b', 'c'], 'values keep offer order');
  assert.deepEqual(toggleComparisonValue(['a', 'b', 'c'], 'b', 'a', order), ['a', 'c']);
  assert.deepEqual(toggleComparisonValue(['a', 'b'], 'a', 'a', order), ['a', 'b'], 'the held value cannot be cleared');
  assert.deepEqual(toggleComparisonValue(['a', 'b', 'c', 'd', 'e', 'f'], 'g', 'a', order), ['a', 'b', 'c', 'd', 'e', 'f'], 'six panes is the most');
  const values = comparisonValues(catalog, claude('opus', 'max', 'clean'), 'model', cooked);
  assert.deepEqual(carryComparisonSelection(['high-held', 'Sonnet 5.5', 'Haiku 5.5'], values), ['Opus 5.5', 'Sonnet 5.5'], 'values still offered stay; Haiku has no Max configuration');
  assert.deepEqual(carryComparisonSelection(['Opus 5.5', 'gone'], values), defaultComparisonSelection(values), 'nothing left to carry reopens the defaults');
});

test('the compare-by note states what was held and never credits the varied axis alone', () => {
  const slot = (config) => ({ config, skillKey: 'none' });
  const harness = differingDimensions([slot(opusHighClean), slot(hermes('opus', 'high', 'clean'))]);
  assert.equal(compareByNote('harness', ['Opus 5.5', 'High', 'Clean'], harness), 'Holding Opus 5.5 · High · Clean · only the harness differs · its own prompt, tools and defaults come with it');
  assert.equal(compareByNote('environment', ['Opus 5.5', 'High', 'Claude Code'], ['environment']), 'Holding Opus 5.5 · High · Claude Code · only the environment differs · what the setup adds');
  assert.equal(compareByNote('skill', ['Opus 5.5'], ['skill layer']), 'Holding Opus 5.5 · only the skill layer differs · the model still decides how to use it');
  assert.equal(compareByNote('model', ['Claude Code'], ['model']), 'Holding Claude Code · only the model differs');
  const loose = differingDimensions([slot(opusHighClean), slot(catalog.find((config) => config.id === 'codex-sol-high'))]);
  assert.match(compareByNote('harness', ['Opus 5.5', 'High', 'Clean'], loose), /harness varies, and so does model, environment · not an isolated comparison$/);
  assert.match(compareByNote('effort', ['Opus 5.5'], []), /only one effort on the counter$/);
});
