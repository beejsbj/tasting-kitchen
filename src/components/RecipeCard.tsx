import { Badge } from './Badge';
import { ModelChoices } from './ModelChoices';
import { artifactUrl, dishesFor } from '../lib/registry';
import type { Configuration, Dish, Recipe } from '../types';
export function RecipeCard({ recipe, dishes, configurations, index, onOpen }: { recipe: Recipe; dishes: Dish[]; configurations: Configuration[]; index: number; onOpen: (dish?: Dish) => void }) {
  const ordered = dishesFor(dishes, recipe.id).reverse();
  const dish = ordered[0];
  const hashes = [...new Set(ordered.map((item) => item.identity.configHash))];
  const available = hashes.flatMap((hash) => configurations.filter((config) => config.configHash === hash));
  return <article className="recipe-card">
    <button className="recipe-card__open" onClick={() => onOpen(dish)} aria-label={`Open ${recipe.title}`}>
      <div className="recipe-card__preview" aria-hidden="true" inert>
        {dish?.artifact.preview ? <img src={artifactUrl(dish, dish.artifact.preview)} alt="" loading={index < 4 ? 'eager' : 'lazy'} /> : dish?.artifact.kind === 'web'
          ? <iframe src={artifactUrl(dish)} title={`${recipe.title} preview`} tabIndex={-1} loading={index < 4 ? 'eager' : 'lazy'} sandbox="allow-scripts" />
          : <div className="recipe-card__transcript"><span>Conversation</span><p>{recipe.turns[0]?.content.slice(0, 240)}</p><span>{recipe.turns.length} turns</span></div>}
      </div>
      <span className="recipe-card__body">
        <span className="recipe-card__eyebrow"><span>No. {String(index + 1).padStart(2, '0')}</span><Badge origin={recipe.origin} /><span>{dishes.length} dishes</span></span>
        <span className="recipe-card__title">{recipe.title}<span aria-hidden="true">↗</span></span>
        <span className="recipe-card__summary">{recipe.summary}</span>
      </span>
    </button>
    <ModelChoices configurations={available} selectedId={available.find((config) => config.configHash === dish?.identity.configHash)?.id} label={`Models for ${recipe.title}`} onSelect={(config) => onOpen(ordered.find((item) => item.identity.configHash === config.configHash))} />
  </article>;
}
