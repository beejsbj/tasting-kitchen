import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRegistry } from '../lib/taste/registry.mjs';

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
 * One model through several harnesses and environments, as the catalog will
 * hold once the Claude Code and Hermes adapters land. Each synthetic Dish
 * replays an existing artifact of `recipeId`; served only to browser checks.
 */
export function withHarnessConfigurations(registry, recipeId) {
  const base = registry.configurations[0];
  const source = registry.dishes.find(dish => dish.recipe.id === recipeId && dish.artifact.kind === 'web');
  const setups = [
    ['claude-opus-high-clean', 'claude-code', 'claude-opus-5-5', 'high', 'clean'],
    ['claude-opus-max-clean', 'claude-code', 'claude-opus-5-5', 'max', 'clean'],
    ['claude-opus-high-personal', 'claude-code', 'claude-opus-5-5', 'high', 'personal'],
    ['claude-sonnet-high-clean', 'claude-code', 'claude-sonnet-5-5', 'high', 'clean'],
    ['hermes-opus-high-clean', 'hermes', 'anthropic/claude-opus-5.5', 'high', 'clean'],
    ['hermes-opus-high-personal-rose', 'hermes', 'anthropic/claude-opus-5.5', 'high', 'personal', 'rose'],
  ];
  const configurations = setups.map(([id, harness, model, reasoningEffort, environment, harnessProfile]) => ({
    ...base, id, harness, model, provider: 'anthropic', reasoningEffort, label: id, configHash: `sha256:fixture-${id}`,
    executionProfile: { ...base.executionProfile, id: `${harness}-${environment}-fixture`, label: `via ${harness}`, environment, ...(harnessProfile && { harnessProfile }) },
  }));
  const dishes = configurations.map((configuration, index) => ({
    ...source, id: `dish_fixture_${configuration.id}`, executedAt: `2099-02-0${index + 1}T00:00:00.000Z`, dishHash: `sha256:fixture-dish-${configuration.id}`,
    identity: { ...source.identity, variantId: configuration.id, harness: configuration.harness, harnessVersion: '9.9.9', requestedModel: configuration.model, observedModel: configuration.model, reasoningEffort: configuration.reasoningEffort, configHash: configuration.configHash },
    receipt: { ...source.receipt, configuration },
  }));
  return { ...registry, configurations: [...registry.configurations, ...configurations], dishes: [...registry.dishes, ...dishes] };
}
