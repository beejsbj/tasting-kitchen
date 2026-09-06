import { CounterFilters } from "./components/CounterFilters";
import { RecipeBook } from './components/RecipeBook';
import { KitchenNavigation } from './components/KitchenNavigation';
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Home, Columns2, SlidersHorizontal, Info, ExternalLink, NotebookPen } from "lucide-react";
import { ControlPopover, IconButton } from "./components/ui/ViewerControls";
import { ArtifactPane } from "./components/ArtifactPane";
import { KitchenButton } from "./components/KitchenButton";
import { KitchenHero } from "./components/KitchenHero";
import { Mark } from "./components/Mark";
import { RecipeBrief } from "./components/RecipeBrief";
import { ModelChoices } from "./components/ModelChoices";
import { latestDish, resolveRecipeSelection, selectionForDish } from "./lib/selection";
import { DishGallery } from "./components/DishGallery";
import { artifactUrl, dishesFor, loadRegistry, modelFamily, recipeAtRevision, reviewsForDish, shortHash } from "./lib/registry";
import { readGalleryState, writeGalleryState, type GalleryState } from "./lib/url-state";
import { StyleGuide } from "./styleguide/StyleGuide";
import type { Configuration, Dish, Recipe, Registry } from "./types";

function useUrlState() {
  const [state, setState] = useState<GalleryState>(() => readGalleryState());
  useEffect(() => {
    const onPop = () => setState(readGalleryState());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const update = useCallback((patch: Partial<GalleryState>, mode: "push" | "replace" = "push") => {
    const next = { ...readGalleryState(), ...patch };
    writeGalleryState(next, mode);
    setState(next);
  }, []);
  return [state, update] as const;
}

function configLabel(config: Configuration) {
  return `${modelFamily(config.model)} · ${config.reasoningEffort} · ${config.serviceTier}${config.historical ? " · preserved" : ""}`;
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-state__mark" aria-hidden="true">—</span><h2>{title}</h2><div>{children}</div></div>;
}

export default function App() {
  const [registry, setRegistry] = useState<Registry>();
  const [error, setError] = useState("");
  const [state, update] = useUrlState();
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [state.recipe, state.editRecipe, state.view, state.styleguide]);
  useEffect(() => { loadRegistry().then(setRegistry).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Catalog unavailable")); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]') && state.recipe && !state.brief) update({ recipe: "", revision: "", dishes: [] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.recipe, state.brief, update]);
  const configurations = useMemo(() => registry?.configurations.filter((config) =>
    (state.family === "all" || modelFamily(config.model) === state.family) && (state.effort === "all" || config.reasoningEffort === state.effort) &&
    (state.harness === "all" || config.harness === state.harness) && (state.tier === "all" || config.serviceTier === state.tier)) ?? [], [registry, state.family, state.effort, state.harness, state.tier]);
  const visibleRecipes = useMemo(() => {
    if (!registry) return [];
    const configHashes = new Set(configurations.map((config) => config.configHash));
    return registry.recipes.filter((recipe) =>
      (state.cuisine === "all" || recipe.cuisines.includes(state.cuisine)) &&
      (state.origin === "all" || recipe.origin === state.origin) &&
      `${recipe.title} ${recipe.summary}`.toLowerCase().includes(state.query.toLowerCase()) &&
      ((state.family === "all" && state.effort === "all" && state.harness === "all" && state.tier === "all") || registry.dishes.some((dish) => dish.recipe.id === recipe.id && configHashes.has(dish.identity.configHash)))).sort((a, b) => Number(b.kind === "web") - Number(a.kind === "web"));
  }, [registry, state.cuisine, state.origin, state.query, state.family, state.effort, state.harness, state.tier, configurations]);

  if (!registry) return <main className="loading-screen"><Mark /><p role={error ? "alert" : "status"}>{error || "Setting the table…"}</p>{error && <KitchenButton onClick={() => window.location.reload()}>Try again</KitchenButton>}</main>;
  const families = [...new Set(registry.configurations.map((config) => modelFamily(config.model)))];
  const allRecipes = registry.recipes;
  const currentRecipe = allRecipes.find((recipe) => recipe.id === state.recipe);
  const closeRecipe = () => update({ recipe: "", revision: "", dishes: [], brief: false });
  const openRecipe = (recipe: Recipe, dish?: Dish) => {
    const latest = dish ?? latestDish(dishesFor(registry.dishes, recipe.id));
    if (latest) update({ ...selectionForDish(registry, latest), view: 'dishes', editRecipe: '', brief: false });
  };

  if (state.styleguide) return <StyleGuide registry={registry} onExit={() => update({ styleguide: false })} />;
  const navigate = (view: 'dishes' | 'recipes' | 'menus') => update({ view, recipe: '', editRecipe: '', menu: '', revision: '', dishes: [], brief: false });
  if (state.view === 'recipes' && !state.recipe) return <main className="kitchen"><KitchenNavigation active="recipes" onNavigate={navigate} /><div className="counter-content"><RecipeBook selectedId={state.editRecipe} onSelect={editRecipe => update({ editRecipe })} registry={registry} onDishes={id => { const recipe = registry.recipes.find(item => item.id === id); if (recipe) openRecipe(recipe); }} /></div><footer className="kitchen-footer"><Mark /><KitchenButton onClick={() => update({ styleguide: true })}>Visual system ↗</KitchenButton></footer></main>;
  if (state.recipe && !currentRecipe) return <main className="kitchen"><Mark /><EmptyState title="That recipe isn’t on the public counter."><p>It may be private, uncooked, or no longer available at this address.</p><KitchenButton onClick={closeRecipe}>Back to dishes</KitchenButton></EmptyState></main>;

  if (currentRecipe) {
    const recipeDishes = dishesFor(registry.dishes, currentRecipe.id);
    const hashes = [...new Set(recipeDishes.map((dish) => dish.recipe.hash))];
    const resolved = resolveRecipeSelection(registry, currentRecipe, state);
    const recipeHash = resolved.recipeHash;
    const revision = registry.recipeRevisions.find((item) => item.recipeId === currentRecipe.id && item.hash === recipeHash);
    const recipe = recipeAtRevision(currentRecipe, revision);
    const slots = resolved.slots.filter((slot): slot is typeof slot & { config: Configuration } => Boolean(slot.config));
    const selected = slots.map((slot) => slot.config);
    const viewerConfigurations = [...registry.configurations].sort((a, b) => {
      const latestA = latestDish(recipeDishes.filter((dish) => dish.recipe.hash === recipeHash && dish.identity.configHash === a.configHash));
      const latestB = latestDish(recipeDishes.filter((dish) => dish.recipe.hash === recipeHash && dish.identity.configHash === b.configHash));
      return (latestB?.executedAt ?? '').localeCompare(latestA?.executedAt ?? '') || (latestB?.id ?? '').localeCompare(latestA?.id ?? '');
    });
    const dimensions = new Set(selected.map((config) => JSON.stringify({ harness: config.harness, effort: config.reasoningEffort, tier: config.serviceTier, profile: config.executionProfile, personality: config.personality, capabilities: [...config.capabilities].sort() })));
    const harnessVersions = new Set(slots.map(({ dish }) => dish?.identity.harnessVersion).filter(Boolean));
    const drift = slots.some(({ dish }) => dish && (dish.identity.requestedModel !== dish.identity.observedModel || (dish.identity.observedServiceTier && dish.identity.observedServiceTier !== dish.identity.serviceTier)));
    const comparisonNote = slots.some((slot) => !slot.dish) ? "Incomplete coverage for these settings" : drift ? "Observed configuration drift — inspect receipts" : (dimensions.size > 1 || harnessVersions.size > 1) ? "Same recipe revision · settings differ" : "Same recipe revision · inspect configuration receipts";
    function chooseConfig(index: number, id: string) {
      const models = selected.map((config) => config.id); models[index] = id;
      const dishes = [...state.dishes]; dishes[index] = "";
      update({ models, dishes });
    }
    const addComparison = () => {
      const next = registry.configurations.find((candidate) => !selected.some((config) => config.id === candidate.id) && recipeDishes.some((dish) => dish.recipe.hash === recipeHash && dish.identity.configHash === candidate.configHash)) ?? selected[0];
      if (next) update({ models: [...selected.map((config) => config.id), next.id], dishes: slots.map((slot) => slot.dish?.id ?? '') });
    };
    const chooseRepeat = (index: number, id: string) => { const dishes = slots.map((slot) => slot.dish?.id ?? ''); dishes[index] = id; update({ dishes }); };
    return <main className="tasting-room tasting-room--immersive">
      <h1 className="sr-only">{currentRecipe.title}</h1>
      <section className="comparison-grid" style={{ "--columns": Math.max(1, slots.length) } as React.CSSProperties} aria-label="Artifact comparison">
        {slots.map(({ config, dish }, index) => <article className="comparison-slot" key={`${index}-${config.id}`}>
          {slots.length > 1 && <div className="pane-label">{index + 1} · {modelFamily(config.model)} · {config.reasoningEffort}</div>}
          <ArtifactPane recipe={recipe} variant={config} dish={dish} reviews={[]} />
        </article>)}
      </section>
      <nav aria-label="Artifact controls" className="viewer-dock fixed right-3 top-4 z-30 flex max-h-[calc(100dvh-2rem)] flex-col items-center gap-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 p-1.5 text-slate-800 shadow-lg backdrop-blur-md sm:right-5 sm:top-6">
        <IconButton aria-label="Back to dishes" title="Back to dishes" onClick={closeRecipe}><Home size={19} /></IconButton>
        <IconButton aria-label="Open recipe in book" title="Open recipe in book" onClick={() => update({ view: 'recipes', editRecipe: currentRecipe.id, recipe: '', brief: false })}><NotebookPen size={19} /></IconButton>
        <IconButton aria-label="Compare another" title="Compare another" disabled={selected.length >= 3 || !selected.length} onClick={addComparison}><Columns2 size={19} /></IconButton>
        <ControlPopover label="Models and comparison" icon={<SlidersHorizontal size={19} />}>
          <h2 className="mb-4 text-base font-semibold">{currentRecipe.title}</h2>
          {slots.map(({ config, repeats, dish }, index) => <section key={index} className="mb-4 border-b border-slate-100 pb-4 last:mb-0 last:border-0 last:pb-0">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-slate-500">{slots.length > 1 ? `Pane ${index + 1}` : 'Model & thinking'}</span>{slots.length > 1 && <button className="min-h-8 rounded-md border-0 bg-transparent px-2 text-xs text-slate-500 hover:bg-slate-100" aria-label={`Remove configuration ${index + 1}`} onClick={() => update({ models: selected.filter((_, i) => i !== index).map((item) => item.id), dishes: slots.filter((_, i) => i !== index).map((item) => item.dish?.id ?? '') })}>Remove</button>}</div>
            <ModelChoices configurations={viewerConfigurations} selectedId={config.id} label={`Configuration ${index + 1}`} onSelect={(candidate) => chooseConfig(index, candidate.id)} />
            {repeats.length > 1 && slots.length > 1 && <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label={`Dishes for configuration ${index + 1}`}>{repeats.map((repeat, i) => <IconButton key={repeat.id} aria-label={`Repeat ${i + 1} for configuration ${index + 1}`} aria-pressed={dish?.id === repeat.id} onClick={() => chooseRepeat(index, repeat.id)}>{i + 1}</IconButton>)}</div>}
          </section>)}
          {hashes.length > 1 && <div className="mt-4 border-t border-slate-200 pt-3"><p className="text-xs text-slate-500">Recipe revision</p><div className="pill-row">{hashes.map((hash) => <KitchenButton key={hash} aria-pressed={recipeHash === hash} onClick={() => update({ revision: hash, dishes: [] })}>{shortHash(hash)}</KitchenButton>)}</div></div>}
          {slots.length > 1 && <p className="mb-0 mt-4 text-xs leading-relaxed text-slate-500">{comparisonNote}</p>}
        </ControlPopover>
        <IconButton aria-label="Read the recipe" title="Read the recipe" data-brief-control onClick={() => update({ brief: true }, "replace")}><BookOpen size={19} /></IconButton>
        <ControlPopover label="Configuration receipts" icon={<Info size={19} />}>
          <h2 className="mb-3 text-base font-semibold">Configuration receipts</h2>
          {slots.map(({ dish, config }, index) => <section key={index} className="receipt border-b border-slate-100 last:border-0"><h3 className="text-sm font-semibold">{modelFamily(config.model)} · {config.reasoningEffort}</h3>{dish ? <><dl><dt>Requested</dt><dd>{dish.identity.requestedModel}</dd><dt>Observed</dt><dd>{dish.identity.observedModel}</dd><dt>Harness</dt><dd>{dish.identity.harness} {dish.identity.harnessVersion}</dd><dt>Tier requested / observed</dt><dd>{dish.identity.requestedServiceTier ?? dish.identity.serviceTier} / {dish.identity.observedServiceTier ?? 'not recorded'}</dd><dt>Recipe revision</dt><dd>{shortHash(dish.recipe.hash)}</dd><dt>Executed</dt><dd>{new Date(dish.executedAt).toLocaleString()}</dd></dl><a href={artifactUrl(dish, 'dish.json')} target="_blank" rel="noreferrer">Immutable manifest ↗</a>{reviewsForDish(registry.reviews, dish).flatMap((review) => review.probes.map((probe) => <p key={`${review.id}-${probe.id}`} className="mt-3 text-xs">{review.reviewerKind} review · {probe.verdict}: {probe.finding}</p>))}<a className="mt-3 block" href={artifactUrl(dish)} target="_blank" rel="noreferrer">Open artifact ↗</a></> : <p>No dish for these settings.</p>}</section>)}
        </ControlPopover>
        {slots.length === 1 && slots[0].dish && <a aria-label="Open artifact in new tab" title="Open artifact in new tab" className="inline-flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100" href={artifactUrl(slots[0].dish)} target="_blank" rel="noreferrer"><ExternalLink size={18} /></a>}
        {slots.length === 1 && slots[0].repeats.length > 1 && <div className="flex flex-col gap-1 border-t border-slate-200 pt-1" role="group" aria-label="Dishes for configuration 1">{slots[0].repeats.map((repeat, i) => <IconButton key={repeat.id} aria-label={`Repeat ${i + 1} for configuration 1`} aria-pressed={slots[0].dish?.id === repeat.id} onClick={() => chooseRepeat(0, repeat.id)}>{i + 1}</IconButton>)}</div>}
      </nav>
      {((state.revision && !hashes.includes(state.revision)) || resolved.slots.some((slot) => !slot.config)) && <div role="status" className="fixed left-4 top-4 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">This selection is unavailable. <KitchenButton onClick={() => openRecipe(currentRecipe)}>Open latest dish</KitchenButton></div>}

      {state.brief && <RecipeBrief recipe={recipe} reviews={slots.flatMap(({ dish, config }) => reviewsForDish(registry.reviews, dish).map((review) => ({ review, variant: config })))} onClose={() => update({ brief: false }, "replace")} />}
    </main>;
  }

  const menuRevision = registry.menuRevisions.find((menu) => menu.menuId === state.menu && (!state.menuRevision || menu.hash === state.menuRevision));
  return <main className="kitchen">
    <a className="skip-link" href="#counter-content">Skip to the dishes</a>
    <KitchenNavigation active={state.view === 'menus' ? 'menus' : 'dishes'} onNavigate={navigate} />
    <KitchenHero recipes={registry.recipes.length} dishes={registry.dishes.length} models={families.length} />
    <section className="counter-content" id="counter-content" tabIndex={-1}>
      <header className="section-heading"><h2>{state.view === 'menus' ? 'Menus' : 'Dishes'}</h2><span>{state.view === 'menus' ? `${registry.menus.length} public menus` : `${registry.dishes.filter(dish => visibleRecipes.some(recipe => recipe.id === dish.recipe.id) && configurations.some(config => config.configHash === dish.identity.configHash)).length} dishes`}</span></header>
      {state.view !== 'menus' && <CounterFilters registry={registry} state={state} update={update} />}
      {state.view !== "menus" && (visibleRecipes.length ? <DishGallery registry={registry} recipes={visibleRecipes} dishes={registry.dishes.filter(dish => configurations.some(config => config.configHash === dish.identity.configHash))} onOpen={openRecipe} /> : registry.dishes.length === 0 ? <EmptyState title="No dishes yet."><p>The active recipes haven’t been cooked yet. Open the recipe book to see what’s ready.</p><KitchenButton tone="primary" onClick={() => navigate('recipes')}>Browse recipes</KitchenButton></EmptyState> : <EmptyState title="No matching dishes."><p>Try another model or clear your filters.</p><KitchenButton onClick={() => update({ query: "", cuisine: "all", origin: "all", family: "all", effort: "all", harness: "all", tier: "all" })}>Clear filters</KitchenButton></EmptyState>)}
      {state.view === "menus" && (registry.menus.length ? <><div className="menu-grid">{registry.menus.map((menu) => <KitchenButton className="menu-card" key={menu.id} onClick={() => update({ menu: menu.id, menuRevision: "" })}><span className="eyebrow">A Menu for comparison</span><strong>{menu.title}</strong><span>{menu.summary}</span><span>Inspect the Menu →</span></KitchenButton>)}</div>{menuRevision && <section className="menu-detail"><header><h3>{menuRevision.title}</h3><label className="field">Menu revision<select value={menuRevision.hash} onChange={(event) => update({ menuRevision: event.target.value })}>{registry.menuRevisions.filter((item) => item.menuId === menuRevision.menuId).map((item) => <option key={item.hash} value={item.hash}>{shortHash(item.hash)}</option>)}</select></label><p>All {menuRevision.recipes.length} pinned recipes count toward coverage. A blank cell stays blank.</p></header><div className="coverage-scroll"><table className="coverage-table"><caption>Coverage by exact requested configuration</caption><thead><tr><th scope="col">Recipe</th>{registry.configurations.map((config) => <th scope="col" key={config.id}>{configLabel(config)}<small>{menuRevision.recipes.filter((member) => dishesFor(registry.dishes, member.recipeId, member.recipeHash, config.configHash).length).length}/{menuRevision.recipes.length} represented</small></th>)}</tr></thead><tbody>{menuRevision.recipes.map((member) => { const recipe = allRecipes.find((item) => item.id === member.recipeId); return <tr key={member.recipeId}><th scope="row">{recipe?.title ?? member.recipeId}<small>{shortHash(member.recipeHash)}</small></th>{registry.configurations.map((config) => { const count = dishesFor(registry.dishes, member.recipeId, member.recipeHash, config.configHash).length; return <td key={config.id}>{count && recipe ? <KitchenButton onClick={() => update({ recipe: recipe.id, revision: member.recipeHash, models: [config.id], dishes: [] })}>{count} {count === 1 ? "dish" : "dishes"} ↗</KitchenButton> : <span className="missing-cell">Not cooked</span>}</td>; })}</tr>; })}</tbody></table></div></section>}</> : <EmptyState title="No menus yet."><p>Menus group recipes for comparison. They appear here once every recipe has a dish.</p><KitchenButton tone="primary" onClick={() => update({ view: "recipes" })}>Browse recipes →</KitchenButton></EmptyState>)}
    </section>
    <footer className="kitchen-footer"><Mark /><KitchenButton onClick={() => update({ styleguide: true })}>Visual system ↗</KitchenButton></footer>
  </main>;
}
