import { artifactUrl, briefChanged, dishesFor, dishSkillKey, modelFamily, shortHash, skillLabelFor } from '../lib/registry';
import { effortLabel } from '../lib/effort-label';
import { configurationFacets, environmentName, harnessKey, harnessLabel } from '../lib/configuration-label';
import { CHEF_FAULT_LABELS, isNoDish, platesOf, standingVerdict } from '../lib/outcomes';
import type { Plate, Recipe, Registry } from '../types';

/** The counter: every Dish, and every No Dish where a configuration could not make the Recipe, grouped under its Recipe. */
export function DishGallery({ registry, recipes, dishes, onOpen }: { registry: Registry; recipes: Recipe[]; dishes: Plate[]; onOpen: (recipe: Recipe, dish: Plate) => void }) {
  const facets = configurationFacets(registry.configurations);
  const showEnvironment = facets.harnesses.length > 1 || facets.environments.length > 1;
  const entries = recipes.flatMap(recipe => dishesFor(dishes, recipe.id).reverse().map(dish => ({ recipe, dish })));
  return <div className="recipe-grid dish-grid" aria-label="Dishes">{entries.map(({ recipe, dish }) => {
        const config = registry.configurations.find(item => item.configHash === dish.identity.configHash);
        const model = modelFamily(config?.model ?? dish.identity.requestedModel);
        const effort = config?.reasoningEffort ?? dish.identity.reasoningEffort;
        const iterations = dishesFor(platesOf(registry), recipe.id, dish.recipe.hash, dish.identity.configHash, dishSkillKey(dish));
        const verdict = standingVerdict(registry.verdicts, dish);
        const outcome = `${isNoDish(dish) ? `No Dish, ${CHEF_FAULT_LABELS[dish.fault.code].toLowerCase()}, ` : ''}${verdict ? `${verdict.verdict} by Burooj, ` : ''}`;
        const harnessEnvironment = showEnvironment ? [harnessLabel(config ? harnessKey(config) : dish.identity.harness), config && environmentName(config)].filter(Boolean).join(' · ') : '';
        const skillLabel = skillLabelFor(registry, dish);
        const iteration = iterations.findIndex(item => item.id === dish.id) + 1;
        const date = new Date(dish.executedAt).toLocaleString('en', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return <article className="recipe-card dish-card" key={dish.id} data-dish-id={dish.id} data-recipe-id={recipe.id} data-outcome={isNoDish(dish) ? 'no-dish' : verdict?.verdict === 'failed' ? 'failed-by-burooj' : 'cooked'}>
          <button className="recipe-card__open" onClick={() => onOpen(recipe, dish)} aria-label={`Open ${recipe.title}, ${outcome}${model}, ${effort} effort, ${harnessEnvironment ? `${harnessEnvironment}, ` : ''}${skillLabel.toLowerCase()}, iteration ${iteration}, ${date}`}>
            <div className="recipe-card__preview" aria-hidden="true" inert>
              {isNoDish(dish) ? <div className="recipe-card__no-dish"><span className="no-dish__plate" /><b>No Dish</b><span>{CHEF_FAULT_LABELS[dish.fault.code]}</span></div> : dish.artifact.preview ? <img src={artifactUrl(dish, dish.artifact.preview)} alt="" loading="lazy" /> : dish.artifact.kind === 'web'
                ? <iframe src={artifactUrl(dish)} title={`${recipe.title} preview`} tabIndex={-1} loading="lazy" sandbox="allow-scripts" />
                : <div className="recipe-card__transcript"><span>{dish.artifact.kind === 'session' ? 'Conversation' : dish.artifact.kind}</span><p>{recipe.turns[0]?.content.slice(0, 240)}</p><span>{recipe.turns.length} turns</span></div>}
            </div>
            <span className="recipe-card__body">
              <span className="recipe-card__eyebrow">
                <span className="dish-card__recipe-tag"><span className="dish-card__recipe-tag-label">Recipe</span><span>{recipe.title}</span></span>
                {isNoDish(dish) && <span className="dish-card__outcome" data-outcome="no-dish" title={`${dish.fault.reason} The model's own outcome; Kitchen faults never appear here.`}>No Dish · chef fault</span>}
                {verdict && <span className="dish-card__outcome" data-outcome={verdict.verdict} title={verdict.note}>{verdict.verdict === 'failed' ? 'Failed by Burooj' : 'Passed by Burooj'}</span>}
              </span>
              <span className="recipe-card__title"><span>{model} <span className="dish-card__effort" title={`${effort} reasoning effort`}>{effortLabel(effort)}</span></span><span aria-hidden="true">↗</span></span>
              {harnessEnvironment && <span className="dish-card__environment">{harnessEnvironment}</span>}
              <span className="dish-card__metadata"><span>Iteration {iteration}</span>{(dish.skill || recipe.skills) && <span className="dish-card__skill" title={dish.skill ? `Skill layer ${dish.skill.id} · ${shortHash(dish.skill.hash)}` : 'No skill layer was mounted'}>{skillLabel}</span>}<time dateTime={dish.executedAt}>{date}</time></span>
              <span className="dish-card__revision" title={dish.recipe.hash}>Recipe v{dish.recipe.version} · {shortHash(dish.recipe.hash)}{briefChanged(dish, recipe) && <span className="dish-card__changed" title="The recipe's brief was edited after this Dish was cooked"> · brief changed since this Dish</span>}</span>
            </span>
          </button>
        </article>;
      })}</div>;
}
