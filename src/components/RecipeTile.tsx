import { Badge } from "./Badge";
import type { Dish, Recipe, Variant } from "../types";
import { artifactUrl, recipeSupported } from "../lib/registry";

export function RecipeTile({ recipe, variant, dish, index, onOpen }: { recipe: Recipe; variant: Variant; dish?: Dish; index: number; onOpen: () => void }) {
  const supported = recipeSupported(recipe, variant);
  const preview = dish?.artifact.preview ? artifactUrl(dish, dish.artifact.preview) : null;
  return (
    <article className="recipe-tile">
      <span className="recipe-tile__visual">
        {preview ? <img src={preview} alt="" /> : dish?.artifact.kind === "web" ? <iframe src={artifactUrl(dish)} title={`${recipe.title} preview`} tabIndex={-1} sandbox="allow-scripts" /> : <span className="recipe-tile__empty" data-kind={recipe.kind}><i>{supported ? recipe.status === "draft" ? "Draft" : "Not tasted yet" : "Unsupported"}</i><b>{recipe.kind}</b></span>}
      </span>
      <button className="recipe-tile__open" onClick={onOpen} aria-label={`Open ${recipe.title}`}>
        <span className="recipe-tile__meta"><i>{String(index + 1).padStart(3, "0")}</i><Badge origin={recipe.origin} /></span>
        <span className="recipe-tile__title">{recipe.title}</span>
        <span className="recipe-tile__summary">{recipe.summary}</span>
      </button>
    </article>
  );
}
