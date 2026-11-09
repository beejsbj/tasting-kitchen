import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRegistry } from '../lib/taste/registry.mjs';

/**
 * Synthetic Dishes show this routed 1×1 image on the counter rather than
 * dozens of sandboxed iframes of one artifact, which race Playwright's
 * interception of out-of-process frames and reach the dev server directly.
 */
const FIXTURE_PREVIEW = 'fixture-preview.png';
const PREVIEW_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');

/** Archived real artifacts plus one synthetic Repeat, served only to this browser test. */
export async function galleryBrowserFixture(context) {
  const root = path.resolve(import.meta.dirname, '..');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taste-browser-'));
  try {
    for (const directory of ['catalog', 'dishes', 'reviews']) await fs.cp(path.join(root, directory), path.join(temporary, directory), { recursive: true });
    const originals = ['ui-visual/responsive-product-launch', 'ui-visual/shared-result-ritual', 'agentic-assistant/permission-ladder-publish'];
    for (const relative of originals) {
      const file = path.join(temporary, 'catalog/recipes', relative, 'recipe.json');
      const recipe = JSON.parse(await fs.readFile(file, 'utf8')); recipe.status = 'ready';
      await fs.writeFile(file, JSON.stringify(recipe));
    }
    await buildRegistry({ repoRoot: temporary });
    const registry = JSON.parse(await fs.readFile(path.join(temporary, 'public/data/registry.json'), 'utf8'));
    const first = registry.dishes.find(dish => dish.artifact.kind === 'web');
    registry.dishes.push({ ...first, id: 'dish_browser_extra', executedAt: '2099-01-01T00:00:00.000Z' });
    await context.route('**/data/registry.json', route => route.fulfill({ json: registry }));
    await context.route(/\/(?:dishes|data\/fixtures)\//u, async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//u, '');
      if (relative.endsWith(`/${FIXTURE_PREVIEW}`)) return route.fulfill({ body: PREVIEW_PNG, contentType: 'image/png' });
      const file = path.resolve(temporary, 'public', relative);
      if (!file.startsWith(path.join(temporary, 'public') + path.sep)) return route.abort();
      await route.fulfill({ path: file, headers: { 'Access-Control-Allow-Origin': '*', ...(relative.startsWith('dishes/') ? { 'Content-Security-Policy': "sandbox allow-scripts allow-forms; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'" } : {}) } });
    });
    return () => fs.rm(temporary, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }); throw error;
  }
}

/**
 * Many Claude configurations on one recipe, as the catalog will hold once the
 * Claude Code and Hermes adapters land: four models × two efforts × two
 * harnesses × two environments (clean and a snapshot of his setup), beside the
 * shipped Codex and Cursor ones. Haiku at Max and Fable through Hermes' rose
 * snapshot stay uncooked, and two
 * configurations also have a Dish through the recipe's hand-drawn skill layer.
 * Each synthetic Dish replays an existing artifact of `recipeId`; served only
 * to browser checks.
 */
const FIXTURE_SETUP_DIGEST = `sha256:${'5'.repeat(64)}`;
/** The receipt setup of a fixture snapshot Dish; undefined for clean ones. */
function snapshotSetup({ executionProfile: { environment, harnessProfile } }) {
  if (environment !== 'snapshot') return undefined;
  return { environment, ...(harnessProfile && { harnessProfile }), memory: 'on', connections: 'off', digest: FIXTURE_SETUP_DIGEST, entries: [{ entry: 'SOUL.md', files: 1, bytes: 10, digest: FIXTURE_SETUP_DIGEST }] };
}

export function withHarnessConfigurations(registry, recipeId) {
  const base = registry.configurations[0];
  const source = registry.dishes.find(dish => dish.recipe.id === recipeId && dish.artifact.kind === 'web');
  const skill = registry.skills?.find(item => item.id === 'hand-drawn');
  const models = [['opus', '5-5', '5.5'], ['sonnet', '5-5', '5.5'], ['haiku', '5-5', '5.5'], ['fable', '5-1', '5.1']];
  const setups = models.flatMap(([name, dashed, dotted]) => ['high', 'max'].flatMap(effort => [
    [`claude-${name}-${effort}-clean`, 'claude-code', `claude-${name}-${dashed}`, effort, 'clean'],
    [`claude-${name}-${effort}-snapshot`, 'claude-code', `claude-${name}-${dashed}`, effort, 'snapshot'],
    [`hermes-${name}-${effort}-clean`, 'hermes', `anthropic/claude-${name}-${dotted}`, effort, 'clean'],
    [`hermes-${name}-${effort}-snapshot-rose`, 'hermes', `anthropic/claude-${name}-${dotted}`, effort, 'snapshot', 'rose'],
  ]));
  const configurations = setups.map(([id, harness, model, reasoningEffort, environment, harnessProfile]) => ({
    ...base, id, harness, model, provider: 'anthropic', reasoningEffort, serviceTier: 'default', label: id, configHash: `sha256:fixture-${id}`,
    executionProfile: { ...base.executionProfile, id: `${harness}-${environment}-fixture`, label: `via ${harness}`, environment, ...(harnessProfile && { harnessProfile }), ...(environment === 'snapshot' && { memory: 'on', connections: 'off' }) },
  }));
  const uncooked = id => /^claude-haiku-max|^hermes-haiku-max|^hermes-fable-.*-snapshot/u.test(id);
  const cooked = configurations.filter(configuration => !uncooked(configuration.id));
  const dish = (configuration, index, layer) => ({
    ...source, artifact: { ...source.artifact, preview: FIXTURE_PREVIEW }, id: `dish_fixture_${configuration.id}${layer ? '_hand-drawn' : ''}`, executedAt: `2099-02-01T${String(index % 24).padStart(2, '0')}:${layer ? '00' : '30'}:00.000Z`, dishHash: `sha256:fixture-dish-${configuration.id}${layer ? '-hand-drawn' : ''}`,
    identity: { ...source.identity, variantId: configuration.id, harness: configuration.harness, harnessVersion: '9.9.9', requestedModel: configuration.model, observedModel: configuration.model, reasoningEffort: configuration.reasoningEffort, serviceTier: 'default', configHash: configuration.configHash, ...(snapshotSetup(configuration) && { setupDigest: FIXTURE_SETUP_DIGEST }) },
    ...(layer ? { skill: { id: skill.id, hash: skill.skillHash } } : { skill: undefined }),
    receipt: { ...source.receipt, configuration, ...(snapshotSetup(configuration) && { setup: snapshotSetup(configuration) }) },
  });
  const layered = skill ? cooked.filter(configuration => ['claude-opus-high-clean', 'claude-sonnet-high-clean'].includes(configuration.id)) : [];
  const dishes = [...cooked.map((configuration, index) => dish(configuration, index)), ...layered.map((configuration, index) => dish(configuration, index, true))];
  const recipes = skill ? registry.recipes.map(recipe => recipe.id === recipeId ? { ...recipe, skills: { optional: true, layers: [skill.id] } } : recipe) : registry.recipes;
  // The shipped catalog now holds real Claude Code configurations; the fixture's set stands in for them,
  // so keeping both would make each fixture configuration a Snapshot sibling of a real one.
  const shipped = registry.configurations.filter(configuration => configuration.harness !== 'claude-code');
  return { ...registry, recipes, configurations: [...shipped, ...configurations], dishes: [...registry.dishes, ...dishes] };
}

/**
 * Many OpenRouter models on one recipe through Hermes, free ones among them, as
 * a free-model selector would leave the catalog: enough that the Model chip and
 * the counter's model facet must search and group by maker. Served only to
 * browser checks.
 */
export const MANY_MODELS = [
  'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-lightning:free', 'cohere/north-mini-code:free',
  'liquid/lfm-3-1.7b:free', 'stealth/crouton-alpha', 'x-ai/grok-4.7', 'z-ai/glm-5.3', 'qwen/qwen3.8-max-0902', 'mistralai/mistral-large-4-0', 'deepseek/deepseek-v4-pro-0813', 'moonshotai/kimi-k3.1-pro',
];
export function withManyModels(registry, recipeId) {
  const base = registry.configurations.find(configuration => configuration.harness === 'hermes' && configuration.executionProfile.route === 'openrouter') ?? registry.configurations[0];
  const source = registry.dishes.find(dish => dish.recipe.id === recipeId && dish.artifact.kind === 'web');
  const configurations = MANY_MODELS.map(model => {
    const id = `fixture-many-${model.replace(/[^a-z0-9]+/gu, '-')}`;
    const free = model.endsWith(':free') || model === 'stealth/crouton-alpha';
    return {
      ...base, id, label: id, model, provider: model.split('/')[0], reasoningEffort: 'high', configHash: `sha256:fixture-${id}`,
      executionProfile: { ...base.executionProfile, upstream: model.split('/')[0] },
      ...(free && { materialized: { template: 'hermes-openrouter-clean', spec: `hermes:openrouter/${model}@high:clean`, at: '2099-03-01T00:00:00.000Z', free: true, source: 'fixture' } }),
    };
  });
  const dishes = configurations.map((configuration, index) => ({
    ...source, artifact: { ...source.artifact, preview: FIXTURE_PREVIEW }, id: `dish_many_${index}`, executedAt: `2099-03-01T${String(index).padStart(2, '0')}:00:00.000Z`, dishHash: `sha256:fixture-many-${index}`, skill: undefined,
    identity: { ...source.identity, variantId: configuration.id, harness: 'hermes', harnessVersion: '9.9.9', requestedModel: configuration.model, observedModel: configuration.model, reasoningEffort: 'high', serviceTier: 'default', configHash: configuration.configHash },
    receipt: { ...source.receipt, configuration },
  }));
  return { ...registry, configurations: [...registry.configurations, ...configurations], dishes: [...registry.dishes, ...dishes] };
}
