import { artifactUrl, dishesFor, modelFamily, recipeAtRevision, shortHash } from '../lib/registry';
import { effortLabel } from '../lib/effort-label';
import type { Dish, Recipe, Registry } from '../types';

export function DishGallery({ registry, recipes, dishes, onOpen }: { registry: Registry; recipes: Recipe[]; dishes: Dish[]; onOpen: (recipe: Recipe, dish: Dish) => void }) {
  return <div className="dish-groups">{recipes.map(recipe => {
    const matches = dishesFor(dishes, recipe.id).reverse();
    if (!matches.length) return null;
    return <section className="dish-group" key={recipe.id} aria-labelledby={`dish-group-${recipe.id}`} data-recipe-id={recipe.id}>
      <header className="dish-group__heading"><div><h3 id={`dish-group-${recipe.id}`}>{recipe.title}</h3><p>{recipe.summary}</p></div><span>{matches.length} {matches.length === 1 ? 'dish' : 'dishes'}</span></header>
      <div className="recipe-grid">{matches.map((dish) => {
        const revision = registry.recipeRevisions.find(item => item.recipeId === recipe.id && item.hash === dish.recipe.hash);
        const executedRecipe = recipeAtRevision(recipe, revision);
        const config = registry.configurations.find(item => item.configHash === dish.identity.configHash);
        const model = modelFamily(config?.model ?? dish.identity.requestedModel);
        const effort = config?.reasoningEffort ?? dish.identity.reasoningEffort;
        const iterations = dishesFor(registry.dishes, recipe.id, dish.recipe.hash, dish.identity.configHash);
        const iteration = iterations.findIndex(item => item.id === dish.id) + 1;
        const date = new Date(dish.executedAt).toLocaleString('en', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return <article className="recipe-card dish-card" key={dish.id} data-dish-id={dish.id}>
          <button className="recipe-card__open" onClick={() => onOpen(recipe, dish)} aria-label={`Open ${executedRecipe.title}, ${model}, ${effort} effort, iteration ${iteration}, ${date}`}>
            <div className="recipe-card__preview" aria-hidden="true" inert>
              {dish.artifact.preview ? <img src={artifactUrl(dish, dish.artifact.preview)} alt="" loading="lazy" /> : dish.artifact.kind === 'web'
                ? <iframe src={artifactUrl(dish)} title={`${executedRecipe.title} preview`} tabIndex={-1} loading="lazy" sandbox="allow-scripts" />
                : <div className="recipe-card__transcript"><span>{dish.artifact.kind === 'session' ? 'Conversation' : dish.artifact.kind}</span><p>{executedRecipe.turns[0]?.content.slice(0, 240)}</p><span>{executedRecipe.turns.length} turns</span></div>}
            </div>
            <span className="recipe-card__body">
              <span className="recipe-card__title"><span>{model} <span className="dish-card__effort" title={`${effort} reasoning effort`}>{effortLabel(effort)}</span></span><span aria-hidden="true">↗</span></span>
              <span className="dish-card__metadata"><span>Iteration {iteration}</span><time dateTime={dish.executedAt}>{date}</time></span>
              <span className="dish-card__revision" title={dish.recipe.hash}>Recipe v{dish.recipe.version} · {shortHash(dish.recipe.hash)}</span>
            </span>
          </button>
        </article>;
      })}</div>
    </section>;
  })}</div>;
}
