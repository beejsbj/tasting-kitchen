import { Info, BookOpen } from "lucide-react";
import { ControlPopover, IconButton } from "../components/ui/ViewerControls";
import { KitchenHero } from "../components/KitchenHero";
import { ModelChoices } from "../components/ModelChoices";
import { Badge } from "../components/Badge";
import { KitchenButton } from "../components/KitchenButton";
import { Mark } from "../components/Mark";
import { RecipeCard } from "../components/RecipeCard";
import { dishesFor, modelFamily } from "../lib/registry";
import type { Registry } from "../types";

export function StyleGuide({ registry, onExit }: { registry: Registry; onExit: () => void }) {
  return <main className="styleguide"><header><Mark /><KitchenButton onClick={onExit}>Back to the Kitchen</KitchenButton></header>
    <section className="styleguide__direction"><p className="eyebrow">Enamel kitchen · September 2026</p><h1>Porcelain, cobalt, steel.</h1><p>A tiled backsplash and enamel sign establish the room. Steel trays hold the artifacts; compact labels hold the controls. The viewer gives its space back to the dish.</p></section>
    <KitchenHero recipes={registry.recipes.length} dishes={registry.dishes.length} models={new Set(registry.configurations.map((config) => modelFamily(config.model))).size} />
    <section className="styleguide__section"><h2>Material &amp; hierarchy</h2><div className="swatches">{["canvas", "surface", "ink", "signal"].map((token) => <span key={token} data-token={token}>{token}<code>--{token}</code></span>)}</div><p>Helvetica Neue / Helvetica for direct, compact hierarchy; monospace for receipts and labels. The wordmark is a unique specimen, not a configurable icon family.</p></section>
    <section className="styleguide__section"><h2>Controls &amp; states</h2><div className="styleguide__row"><KitchenButton tone="primary" onClick={onExit}>Open latest dish →</KitchenButton><KitchenButton onClick={onExit}>Inspect the recipe</KitchenButton><KitchenButton className="styleguide__focus-demo" onClick={onExit}>Visible focus</KitchenButton><KitchenButton disabled>Unavailable</KitchenButton><KitchenButton aria-pressed onClick={onExit}>Selected</KitchenButton></div><p>Cobalt marks the selected model and effort. Secondary controls use porcelain. Focus is outlined; disabled controls recede. Reduced motion removes transitions.</p><div className="styleguide__row"><Badge origin="textbook" /><Badge origin="mothers" /><Badge origin="hybrid" /></div><p>Textbook: a familiar task. Mother’s: from lived practice. Hybrid: a recognizable task carrying a personal constraint.</p></section>
    <section className="styleguide__section"><h2>Models & thinking effort</h2><ModelChoices configurations={registry.configurations} selectedId={registry.configurations[0]?.id} onSelect={onExit} /><p>A family button selects its latest available configuration; effort buttons select an exact configuration. Receipt details retain harness, tier, and preserved identity.</p></section>
    <section className="styleguide__section"><h2>The artifact on the counter</h2><div className="recipe-grid">{registry.recipes.slice(0, 2).map((recipe, index) => <RecipeCard key={recipe.id} recipe={recipe} index={index} configurations={registry.configurations} dishes={dishesFor(registry.dishes, recipe.id)} onOpen={onExit} />)}</div><p>RecipeCard imports the lineage Badge and shows a real immutable artifact. The preview and title open the latest dish. Each model and effort button opens a concrete result. The same component appears on the public counter.</p></section>
    <section className="styleguide__section"><h2>Artifact controls</h2><div className="flex gap-2"><IconButton aria-label="Recipe sidebar example" onClick={onExit}><BookOpen size={19} /></IconButton><ControlPopover label="Receipt example" icon={<Info size={19} />}><p className="m-0 text-sm">Receipts and model selection use Radix popovers. The recipe uses a Radix dialog styled as a right-hand sheet.</p></ControlPopover></div><p>Tailwind styles the floating controls. The artifact occupies the viewport; controls reveal details on demand. Escape closes the active panel and restores focus.</p></section>
    <footer>These specimens import the application’s components. No separate visual implementation.</footer>
  </main>;
}
