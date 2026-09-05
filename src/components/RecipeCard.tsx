import { Badge } from "./Badge";
import { artifactUrl, modelFamily } from "../lib/registry";
import type { Dish, Recipe } from "../types";
export function RecipeCard({ recipe, dishes, index, onOpen }: { recipe: Recipe; dishes: Dish[]; index: number; onOpen: () => void }) {
  const dish = dishes.find((item) => item.artifact.preview) ?? dishes[0];
  const families = [...new Set(dishes.map((item) => modelFamily(item.identity.requestedModel)))];
  return <article className="recipe-card">
    <div className="recipe-card__preview" aria-hidden="true" inert>
      {dish?.artifact.preview ? <img src={artifactUrl(dish, dish.artifact.preview)} alt="" loading="lazy" /> : dish?.artifact.kind === "web"
        ? <iframe src={artifactUrl(dish)} title={`${recipe.title} preview`} tabIndex={-1} loading="lazy" sandbox="allow-scripts" />
        : <div className="recipe-card__transcript"><span>Inside the conversation</span><p>{recipe.turns[0]?.content.slice(0, 240)}</p><span>{recipe.turns.length} turns · {dishes.length} preserved results</span></div>}
      <span className="recipe-card__stamp">{dish?.artifact.kind === "web" ? "Interactive artifact" : "Recorded session"}</span>
    </div>
    <button className="recipe-card__body" onClick={onOpen}>
      <span className="recipe-card__eyebrow"><span>Recipe {String(index + 1).padStart(2, "0")}</span><Badge origin={recipe.origin} /></span>
      <span className="recipe-card__title">{recipe.title}<span aria-hidden="true">↗</span></span>
      <span className="recipe-card__summary">{recipe.summary}</span>
      <span className="recipe-card__footer"><span>{families.join(" / ")}</span><span>{dishes.length} dishes</span></span>
    </button>
  </article>;
}
