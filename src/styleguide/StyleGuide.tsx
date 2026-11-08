import { Info, BookOpen } from "lucide-react";
import { ControlPopover, IconButton } from "../components/ui/ViewerControls";
import { KitchenHero } from "../components/KitchenHero";
import { useState } from "react";
import { PaneAxisPicker } from "../components/ComparisonControls";
import { Badge } from "../components/Badge";
import { KitchenButton } from "../components/KitchenButton";
import { Mark } from "../components/Mark";
import { DishGallery } from "../components/DishGallery";
import { dishesFor, dishSkillKey, modelFamily, NO_SKILL } from "../lib/registry";
import type { Configuration, Registry } from "../types";

/** A live pane picker over the recipe with the most Dishes. */
function ConfigurationSpecimen({ registry }: { registry: Registry }) {
  const recipe = [...registry.recipes].sort((a, b) => dishesFor(registry.dishes, b.id).length - dishesFor(registry.dishes, a.id).length)[0];
  const recipeDishes = recipe ? dishesFor(registry.dishes, recipe.id) : [];
  const first = registry.configurations.find((config) => recipeDishes.some((dish) => dish.identity.configHash === config.configHash)) ?? registry.configurations[0];
  const [config, setConfig] = useState<Configuration | undefined>(first);
  if (!config) return null;
  const skillKey = recipeDishes.find((dish) => dish.identity.configHash === config.configHash)?.skill ? dishSkillKey(recipeDishes.find((dish) => dish.identity.configHash === config.configHash)!) : NO_SKILL;
  return <PaneAxisPicker label="Configuration specimen" context={{ configurations: registry.configurations, recipeDishes, layerChoices: [], showLayers: false }} pane={{ config, skillKey, repeats: [] }} onConfig={setConfig} onLayer={() => undefined} />;
}

export function StyleGuide({ registry, onExit }: { registry: Registry; onExit: () => void }) {
  return <main className="styleguide"><header><Mark /><KitchenButton onClick={onExit}>Back to the Kitchen</KitchenButton></header>
    <section className="styleguide__direction"><p className="eyebrow">Enamel kitchen · September 2026</p><h1>Porcelain, cobalt, steel.</h1><p>A tiled backsplash and enamel sign establish the room. Steel trays hold the artifacts; compact labels hold the controls. The viewer gives its space back to the dish.</p></section>
    <KitchenHero recipes={registry.recipes.length} dishes={registry.dishes.length} models={new Set(registry.configurations.map((config) => modelFamily(config.model))).size} />
    <section className="styleguide__section"><h2>Material &amp; hierarchy</h2><div className="swatches">{["canvas", "surface", "ink", "signal"].map((token) => <span key={token} data-token={token}>{token}<code>--{token}</code></span>)}</div><p>Helvetica Neue / Helvetica for direct, compact hierarchy; monospace for receipts and labels. The wordmark is a unique specimen, not a configurable icon family.</p></section>
    <section className="styleguide__section"><h2>Controls &amp; states</h2><div className="styleguide__row"><KitchenButton tone="primary" onClick={onExit}>Open latest dish →</KitchenButton><KitchenButton onClick={onExit}>Inspect the recipe</KitchenButton><KitchenButton className="styleguide__focus-demo" onClick={onExit}>Visible focus</KitchenButton><KitchenButton disabled>Unavailable</KitchenButton><KitchenButton aria-pressed onClick={onExit}>Selected</KitchenButton></div><p>Cobalt marks the selected model and effort. Secondary controls use porcelain. Focus is outlined; disabled controls recede. Reduced motion removes transitions.</p><div className="styleguide__row"><Badge origin="textbook" /><Badge origin="mothers" /><Badge origin="hybrid" /></div><p>Textbook: a familiar task. Mother’s: from lived practice. Hybrid: a recognizable task carrying a personal constraint.</p></section>
    <section className="styleguide__section"><h2>Configuration axes</h2><div className="max-w-md"><ConfigurationSpecimen registry={registry} /></div><p>A pane is one value per axis: model, effort, harness, and environment or tier where they vary. Each list offers only values with a Dish for the recipe; a filled mark has a Dish, a ring is reachable but not cooked, a dash names a combination that does not exist. Changing the model may move harness or effort, and the option says so; changing a lower axis never moves the model. “Compare by” holds the first pane still and lays out one pane per value of a single axis.</p></section>
    <section className="styleguide__section"><h2>The artifact on the counter</h2><DishGallery registry={registry} recipes={registry.recipes.slice(0, 2)} dishes={registry.dishes} onOpen={onExit} /><p>Every accepted Dish shares one continuous grid. Each card names its executed recipe and carries the exact result link, model, effort and iteration.</p></section>
    <section className="styleguide__section"><h2>Artifact controls</h2><div className="flex gap-2"><IconButton aria-label="Recipe sidebar example" onClick={onExit}><BookOpen size={19} /></IconButton><ControlPopover label="Receipt example" icon={<Info size={19} />}><p className="m-0 text-sm">Receipts and model selection use Radix popovers. The recipe uses a Radix dialog styled as a right-hand sheet.</p></ControlPopover></div><p>Tailwind styles the floating controls. The artifact occupies the viewport; controls reveal details on demand. Escape closes the active panel and restores focus.</p></section>
    <footer>These specimens import the application’s components. No separate visual implementation.</footer>
  </main>;
}
