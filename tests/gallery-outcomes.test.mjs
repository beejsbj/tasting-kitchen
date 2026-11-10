import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { budgetLabel, durationLabel, isDish, isNoDish, noDishLabel, outcomeOf, passedNoDishLabel, plateCountLabel, platesOf, standingVerdict } from '../src/lib/outcomes.ts';
import { resolveRecipeSelection } from '../src/lib/selection.ts';
import { readGalleryState, writeGalleryState } from '../src/lib/url-state.ts';
import { dishesFor } from '../src/lib/registry.ts';

const HASH = (digit) => `sha256:${String(digit).repeat(64)}`;
const configuration = (id, configHash) => ({ id, label: id, provider: 'p', model: `${id}-model`, harness: 'codex-cli', reasoningEffort: 'high', serviceTier: 'default', personality: 'none', capabilities: [], configHash, executionProfile: { id: 'x', label: 'x', runtime: 'linux-host', sandbox: 's', approvalPolicy: 'a', nativeWeb: 'disabled', networkPolicy: 'n', filesystemBoundary: 'f' } });
const dish = (id, configHash, executedAt, extra = {}) => ({ id, dishHash: HASH(id.length % 10), recipe: { id: 'r', version: '1.0.0', hash: HASH(1) }, identity: { configHash, requestedModel: 'm', observedModel: 'm' }, executedAt, artifact: { kind: 'web', entry: 'artifact/index.html', files: [], treeHash: HASH(2) }, artifactBase: `/dishes/${id}/`, ...extra });
const noDish = (id, configHash, executedAt, code = 'checks-failed', checks = ['render']) => ({ id, outcome: 'no-dish', recipe: { id: 'r', version: '1.0.0', hash: HASH(1) }, identity: { configHash, requestedModel: 'm', observedModel: null }, executedAt, failedAt: executedAt, fault: { class: 'chef', code, stage: 'validation', reason: 'The output did not pass the Recipe\'s required checks.', ...(checks ? { checks } : {}) }, validation: { passed: false, report: 'validation.json' }, publicTrace: 'trace.json', artifact: null, noDishHash: HASH(3), artifactBase: `/dishes/${id}/` });
const verdict = (dishValue, value, decidedAt, extra = {}) => ({ schemaVersion: 1, id: `verdict_${dishValue.id}_${decidedAt}`, plateId: dishValue.id, plateHash: dishValue.dishHash ?? dishValue.noDishHash, judge: { kind: 'owner', name: 'Burooj' }, verdict: value, note: 'n', decidedAt, ...extra });

const cooked = dish('dish_a', 'c1', '2026-01-01');
const failed = dish('dish_b', 'c2', '2026-01-02');
const plate = noDish('nodish_c', 'c3', '2026-01-03');
const registry = {
  configurations: [configuration('one', 'c1'), configuration('two', 'c2'), configuration('three', 'c3')],
  skills: [], dishes: [cooked, failed], noDishes: [plate],
  verdicts: [verdict(failed, 'passed', '2026-02-01'), verdict(failed, 'failed', '2026-03-01'), verdict(cooked, 'failed', '2026-03-01', { plateHash: HASH(9) })],
};

test('outcomes: cooked, No Dish, and failed by Burooj; his verdict outranks the passed checks', () => {
  assert.deepEqual(platesOf(registry).map((item) => item.id), ['dish_a', 'dish_b', 'nodish_c']);
  assert.equal(isNoDish(plate), true);
  assert.equal(isDish(plate), false);
  assert.equal(isDish(cooked), true);
  assert.equal(outcomeOf(registry, cooked), 'cooked', 'a verdict pinned to another hash does not attach');
  assert.equal(outcomeOf(registry, failed), 'failed-by-burooj', 'the newest owner verdict stands');
  assert.equal(outcomeOf(registry, plate), 'no-dish');
  assert.equal(standingVerdict(registry.verdicts, failed).verdict, 'failed');
  assert.equal(standingVerdict(registry.verdicts, plate), undefined, 'a No Dish with no verdict carries none');
  const overruled = { verdicts: [verdict(plate, 'passed', '2026-04-01'), verdict(plate, 'passed', '2026-04-02', { plateHash: HASH(8) })] };
  assert.equal(standingVerdict(overruled.verdicts, plate).id, `verdict_${plate.id}_2026-04-01`, 'a pass pins the No Dish hash');
  assert.equal(outcomeOf(overruled, plate), 'no-dish', 'a passed No Dish stays a No Dish on the counter; the verdict shows beside the fault');
  assert.equal(outcomeOf({ verdicts: [verdict(failed, 'passed', '2026-04-01'), ...registry.verdicts] }, failed), 'cooked', 'a later pass replaces the fail');
});

test('a No Dish reads plainly and counts as a plate, never as a dish', () => {
  assert.equal(noDishLabel(plate), 'No Dish · Failed the required checks (render)');
  assert.equal(noDishLabel(noDish('nodish_d', 'c3', '2026-01-04', 'refused', null)), 'No Dish · Declined the Recipe');
  // His pass says "checks failed" only where the checks failed.
  assert.equal(passedNoDishLabel(plate), 'Passed by Burooj · checks failed · No Dish · Failed the required checks (render)');
  assert.equal(passedNoDishLabel(noDish('nodish_d', 'c3', '2026-01-04', 'refused', null)), 'Passed by Burooj · No Dish · Declined the Recipe');
  assert.equal(plateCountLabel([cooked, failed]), '2 dishes');
  assert.equal(plateCountLabel([cooked, plate]), '1 dish · 1 no dish');
  assert.equal(plateCountLabel([plate]), '1 no dish');
  assert.equal(plateCountLabel([]), 'not cooked');
});

test('a pane for a configuration that could not make the Recipe holds its No Dish, and Repeats mix outcomes of one cell', () => {
  const recipe = { id: 'r', recipeHash: HASH(1) };
  const retry = dish('dish_e', 'c3', '2026-02-01');
  const withRetry = { ...registry, dishes: [...registry.dishes, retry] };
  const [pane] = resolveRecipeSelection(registry, recipe, { models: ['three'], skills: [], dishes: [] }).slots;
  assert.equal(pane.dish.id, 'nodish_c');
  assert.deepEqual(resolveRecipeSelection(withRetry, recipe, { models: ['three'], skills: [], dishes: [] }).slots[0].repeats.map((item) => item.id), ['nodish_c', 'dish_e']);
  const [explicit] = resolveRecipeSelection(withRetry, recipe, { models: [], skills: [], dishes: ['nodish_c'] }).slots;
  assert.equal(explicit.dish.id, 'nodish_c');
  assert.equal(explicit.config.id, 'three');
  // Compare by and coverage count the No Dish in its cell.
  assert.equal(dishesFor(platesOf(registry), 'r', HASH(1), 'c3').length, 1);
});

test('the outcome filter is URL-addressable and defaults to all', () => {
  assert.equal(readGalleryState('').outcome, 'all');
  assert.equal(readGalleryState('?outcome=no-dish').outcome, 'no-dish');
  const calls = [];
  globalThis.window = { location: { pathname: '/' }, history: { pushState: (...args) => calls.push(args), replaceState: (...args) => calls.push(args) } };
  try {
    writeGalleryState({ ...readGalleryState(''), outcome: 'failed-by-burooj' });
    assert.match(calls[0][2], /outcome=failed-by-burooj/u);
  } finally {
    delete globalThis.window;
  }
});

test('the gallery renders No Dishes in panes and on the counter, and shows the verdict above the artifact', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const pane = readFileSync(new URL('../src/components/ArtifactPane.tsx', import.meta.url), 'utf8');
  const counter = readFileSync(new URL('../src/components/DishGallery.tsx', import.meta.url), 'utf8');
  const filters = readFileSync(new URL('../src/components/CounterFilters.tsx', import.meta.url), 'utf8');
  assert.match(app, /<ArtifactPane[^>]*verdict=\{standingVerdict\(registry\.verdicts, dish\)\}/u);
  assert.match(app, /platesOf\(registry\)/u);
  assert.match(pane, /if \(isNoDish\(dish\)\) return <NoDishPane/u);
  assert.match(pane, /<VerdictMark verdict=\{verdict\} \/><ArtifactReviewMark/u, 'the verdict leads, the automated review stays');
  assert.match(pane, /<VerdictMark verdict=\{verdict\} checks=\{plate\.fault\.code === 'checks-failed' \? 'failed' : 'not-run'\} \/>/u, 'a passed No Dish says the checks failed only where they did');
  assert.match(counter, /data-outcome=\{isNoDish\(dish\) \? 'no-dish'/u);
  assert.match(filters, /aria-label="Filter by outcome"/u);
  // Distinct but not shaming: a No Dish never uses the danger colour.
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css.split('/* No Dish:')[1] ?? '', /var\(--danger\)/u);
});

test('a spent budget names itself on the plate', () => {
  assert.equal(durationLabel(600), '10 min');
  assert.equal(durationLabel(5400), '1 h 30 min');
  assert.equal(durationLabel(45), '45 s');
  assert.equal(budgetLabel({ seconds: 600, modelTurns: 40 }), '10 min · 40 model turns per prompt');
  assert.equal(budgetLabel({ modelTurns: 1 }), '1 model turn per prompt');
  const timedOut = { ...noDish('nodish_t', 'c3', '2026-01-05', 'out-of-time', null), fault: { class: 'chef', code: 'out-of-time', stage: 'execution', reason: 'r', budget: { seconds: 600 } } };
  assert.equal(noDishLabel(timedOut), 'No Dish · Ran out of time (budget 10 min)');
  const turnedOut = { ...timedOut, fault: { ...timedOut.fault, code: 'out-of-turns', budget: { modelTurns: 40 } } };
  assert.equal(noDishLabel(turnedOut), 'No Dish · Ran out of turns (budget 40 model turns per prompt)');
});
