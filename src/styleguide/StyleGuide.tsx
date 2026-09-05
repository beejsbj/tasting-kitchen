import { Badge } from "../components/Badge";
import { KitchenButton } from "../components/KitchenButton";
import { Mark } from "../components/Mark";
import { RecipeCard } from "../components/RecipeCard";
import { dishesFor } from "../lib/registry";
import type { Registry } from "../types";

export function StyleGuide({ registry, onExit }: { registry: Registry; onExit: () => void }) {
  return <main className="styleguide"><header><Mark /><KitchenButton onClick={onExit}>Back to the Kitchen</KitchenButton></header>
    <section className="styleguide__direction"><p className="eyebrow">Frozen direction · The working counter</p><h1>A place to inspect.<br />Room to notice.</h1><p>Cool paper and stainless tones. Ink typography. A vermilion order ticket. Generous artifact surfaces, with the working details close to hand.</p><p className="helper">Considered: the existing blackbox gallery and a cobalt technical archive. This direction brings the sense of a working Kitchen into browsing while keeping the artifacts primary.</p></section>
    <section className="styleguide__section"><h2>Material &amp; hierarchy</h2><div className="swatches">{["canvas", "surface", "ink", "signal"].map((token) => <span key={token} data-token={token}>{token}<code>--{token}</code></span>)}</div><p>Helvetica Neue / Helvetica for direct, compact hierarchy; monospace for receipts and labels. The wordmark is a unique specimen, not a configurable icon family.</p></section>
    <section className="styleguide__section"><h2>Controls &amp; states</h2><div className="styleguide__row"><KitchenButton tone="primary" onClick={onExit}>Start tasting →</KitchenButton><KitchenButton onClick={onExit}>Inspect the recipe</KitchenButton><KitchenButton className="styleguide__focus-demo" onClick={onExit}>Visible focus</KitchenButton><KitchenButton disabled>Unavailable</KitchenButton><KitchenButton aria-pressed onClick={onExit}>Selected</KitchenButton></div><p>Primary actions use the signal color. Secondary controls stay on the work surface. Focus is outlined; disabled controls recede; selected filters invert. Reduced motion removes transitions.</p><div className="styleguide__row"><Badge origin="textbook" /><Badge origin="mothers" /><Badge origin="hybrid" /></div><p>Textbook: a familiar task. Mother’s: from lived practice. Hybrid: a recognizable task carrying a personal constraint.</p></section>
    <section className="styleguide__section"><h2>The artifact on the counter</h2><div className="recipe-grid">{registry.recipes.slice(0, 2).map((recipe, index) => <RecipeCard key={recipe.id} recipe={recipe} index={index} dishes={dishesFor(registry.dishes, recipe.id)} onOpen={onExit} />)}</div><p>RecipeCard imports the lineage Badge and shows a real immutable artifact. Its preview, task, and available model families form one selectable object. The same component appears on the public counter.</p></section>
    <footer>These specimens import the application’s components. No separate visual implementation.</footer>
  </main>;
}
