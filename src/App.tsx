import { useCallback, useEffect, useMemo, useState } from "react";
import { ArtifactPane } from "./components/ArtifactPane";
import { KitchenButton } from "./components/KitchenButton";
import { KitchenHero } from "./components/KitchenHero";
import { Mark } from "./components/Mark";
import { RecipeBrief } from "./components/RecipeBrief";
import { ModelChoices } from "./components/ModelChoices";
import { latestDish, resolveRecipeSelection, selectionForDish } from "./lib/selection";
import { RecipeCard } from "./components/RecipeCard";
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
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [state.recipe, state.view, state.styleguide]);
  useEffect(() => { loadRegistry().then(setRegistry).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Catalog unavailable")); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state.recipe && !state.brief) update({ recipe: "", revision: "", dishes: [] });
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
    if (latest) update({ ...selectionForDish(registry, latest), brief: false });
  };

  if (state.styleguide) return <StyleGuide registry={registry} onExit={() => update({ styleguide: false })} />;
  if (state.recipe && !currentRecipe) return <main className="kitchen"><Mark /><EmptyState title="That recipe isn’t on the public counter."><p>It may be private, uncooked, or no longer available at this address.</p><KitchenButton onClick={closeRecipe}>Back to recipes</KitchenButton></EmptyState></main>;

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
    return <main className="tasting-room">
      <header className="tasting-room__header"><KitchenButton onClick={closeRecipe}>← Counter</KitchenButton><Mark /><KitchenButton onClick={() => update({ brief: true }, "replace")} data-brief-control>Read the recipe ↗</KitchenButton></header>
      <section className="tasting-room__intro"><div><h1>{currentRecipe.title}</h1></div>{hashes.length > 1 && <details className="revision-picker"><summary>Revision {shortHash(recipeHash)}</summary><div className="pill-row">{hashes.map((hash) => <KitchenButton key={hash} aria-pressed={recipeHash === hash} onClick={() => update({ revision: hash, dishes: [] })}>{shortHash(hash)}{hash === currentRecipe.recipeHash ? ' · latest' : ''}</KitchenButton>)}</div></details>}</section>
      {state.revision && !hashes.includes(state.revision) && <p role="status" className="helper">No public dishes for this revision. <KitchenButton onClick={() => openRecipe(currentRecipe)}>Open latest dish</KitchenButton></p>}
      {resolved.slots.some((slot) => !slot.config) && <p role="status">This configuration is unavailable. <KitchenButton onClick={() => openRecipe(currentRecipe)}>Open latest dish</KitchenButton></p>}
      <div className="comparison-toolbar"><p>{selected.length > 1 ? comparisonNote : `${slots[0]?.dish ? new Date(slots[0].dish.executedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not cooked'} · ${shortHash(recipeHash)}`}</p><KitchenButton disabled={selected.length >= 3 || !selected.length} onClick={() => {
        const next = registry.configurations.find((candidate) => !selected.some((config) => config.id === candidate.id) && recipeDishes.some((dish) => dish.recipe.hash === recipeHash && dish.identity.configHash === candidate.configHash)) ?? selected[0];
        if (next) update({ models: [...selected.map((config) => config.id), next.id], dishes: slots.map((slot) => slot.dish?.id ?? '') });
      }}>+ Compare{selected.length > 1 ? ' another' : ''}</KitchenButton></div>
      <section className="comparison-grid" style={{ "--columns": Math.max(1, slots.length) } as React.CSSProperties} aria-label="Artifact comparison">
        {slots.map(({ config, repeats, dish }, index) => <article className="comparison-slot" key={`${index}-${config.id}`}>
          <header className="comparison-slot__head"><ModelChoices configurations={viewerConfigurations} selectedId={config.id} label={`Configuration ${index + 1}`} onSelect={(candidate) => chooseConfig(index, candidate.id)} />{slots.length > 1 && <KitchenButton aria-label={`Remove configuration ${index + 1}`} onClick={() => update({ models: selected.filter((_, i) => i !== index).map((item) => item.id), dishes: slots.filter((_, i) => i !== index).map((item) => item.dish?.id ?? '') })}>×</KitchenButton>}</header>
          <div className="comparison-slot__repeat">{repeats.length > 1 ? <div className="repeat-pills" role="group" aria-label={`Dishes for configuration ${index + 1}`}><span>Repeat</span>{repeats.map((repeat, i) => <KitchenButton key={repeat.id} aria-label={`Repeat ${i + 1} for configuration ${index + 1}`} aria-pressed={dish?.id === repeat.id} title={new Date(repeat.executedAt).toLocaleString()} onClick={() => { const dishes = slots.map((slot) => slot.dish?.id ?? ''); dishes[index] = repeat.id; update({ dishes }); }}>{i + 1}</KitchenButton>)}</div> : <span>{config.model} · {config.reasoningEffort}</span>}{dish && <a href={artifactUrl(dish)} target="_blank" rel="noreferrer">Open artifact ↗</a>}</div>
          <ArtifactPane recipe={recipe} variant={config} dish={dish} reviews={reviewsForDish(registry.reviews, dish)} />
          {dish && <details className="receipt"><summary>Configuration &amp; receipt <code>{shortHash(dish.dishHash)}</code></summary><dl><dt>Requested</dt><dd>{dish.identity.requestedModel}</dd><dt>Observed</dt><dd>{dish.identity.observedModel}</dd><dt>Harness</dt><dd>{dish.identity.harness} {dish.identity.harnessVersion}</dd><dt>Effort</dt><dd>{dish.identity.reasoningEffort}</dd><dt>Tier requested / observed</dt><dd>{dish.identity.requestedServiceTier ?? dish.identity.serviceTier} / {dish.identity.observedServiceTier ?? "not recorded"}</dd><dt>Recipe revision</dt><dd>{shortHash(dish.recipe.hash)}</dd><dt>Executed</dt><dd>{new Date(dish.executedAt).toLocaleString()}</dd></dl><a href={artifactUrl(dish, "dish.json")} target="_blank" rel="noreferrer">Immutable manifest ↗</a></details>}
        </article>)}
      </section>

      {state.brief && <RecipeBrief recipe={recipe} reviews={slots.flatMap(({ dish, config }) => reviewsForDish(registry.reviews, dish).map((review) => ({ review, variant: config })))} onClose={() => update({ brief: false }, "replace")} />}
    </main>;
  }

  const menuRevision = registry.menuRevisions.find((menu) => menu.menuId === state.menu && (!state.menuRevision || menu.hash === state.menuRevision));
  return <main className="kitchen">
    <a className="skip-link" href="#counter-content">Skip to the recipes</a>
    <header className="kitchen-header"><KitchenButton className="brand-button" aria-label="Tasting Kitchen home" onClick={() => update({ view: 'recipes', menu: '', cuisine: 'all', origin: 'all', query: '', family: 'all', effort: 'all', harness: 'all', tier: 'all' })}><Mark /></KitchenButton><nav aria-label="Browse the Kitchen">{(['recipes', 'menus'] as const).map((view) => <KitchenButton key={view} aria-current={(state.view === view || view === 'recipes' && state.view === 'models') ? 'page' : undefined} onClick={() => update({ view, menu: '' })}>{view === 'recipes' ? 'Recipes' : 'Menus'}</KitchenButton>)}</nav></header>
    <KitchenHero recipes={registry.recipes.length} dishes={registry.dishes.length} models={families.length} />
    <section className="counter-content" id="counter-content" tabIndex={-1}>
      <header className="section-heading"><h2>{state.view === 'menus' ? 'Menus' : 'Recipes'}</h2><span>{state.view === 'menus' ? `${registry.menus.length} public menus` : `${visibleRecipes.length} on the counter`}</span></header>
      {state.view !== 'menus' && <div className="counter-controls">
        <div className="counter-filters"><label className="search-field"><span className="sr-only">Search recipes</span><span aria-hidden="true">⌕</span><input type="search" placeholder="Search recipes" value={state.query} onChange={(event) => update({ query: event.target.value }, 'replace')} /></label><details className="filter-details"><summary>Cuisine & lineage{state.cuisine !== 'all' || state.origin !== 'all' ? ' •' : ''}</summary><div><div className="pill-row" role="group" aria-label="Cuisine"><KitchenButton aria-pressed={state.cuisine === 'all'} onClick={() => update({ cuisine: 'all' })}>All cuisines</KitchenButton>{registry.cuisines.filter((cuisine) => allRecipes.some((recipe) => recipe.cuisines.includes(cuisine.id))).map((cuisine) => <KitchenButton key={cuisine.id} aria-pressed={state.cuisine === cuisine.id} onClick={() => update({ cuisine: cuisine.id })}>{cuisine.label}</KitchenButton>)}</div><div className="pill-row" role="group" aria-label="Lineage">{['all', 'textbook', 'mothers', 'hybrid'].map((origin) => <KitchenButton key={origin} aria-pressed={state.origin === origin} onClick={() => update({ origin })}>{origin === 'all' ? 'All lineages' : origin === 'mothers' ? 'Mother’s' : origin === 'textbook' ? 'Textbook' : 'Hybrid'}</KitchenButton>)}</div></div></details></div>
        <div className="family-tabs" role="group" aria-label="Filter by model"><span className="control-label">Models</span><KitchenButton aria-pressed={state.family === 'all'} onClick={() => update({ family: 'all', effort: 'all' })}>All</KitchenButton>{families.map((family) => <KitchenButton key={family} aria-pressed={family === state.family} onClick={() => update({ family, effort: 'all' })}>{family}</KitchenButton>)}</div>
        {state.family !== 'all' && <div className="effort-filters pill-row" role="group" aria-label="Filter by thinking effort"><span className="control-label">Thinking</span><KitchenButton aria-pressed={state.effort === 'all'} onClick={() => update({ effort: 'all' })}>All efforts</KitchenButton>{[...new Set(registry.configurations.filter((config) => modelFamily(config.model) === state.family).map((config) => config.reasoningEffort))].map((effort) => <KitchenButton key={effort} aria-pressed={state.effort === effort} onClick={() => update({ effort })}>{effort}</KitchenButton>)}</div>}
        {(state.harness !== 'all' || state.tier !== 'all') && <KitchenButton onClick={() => update({ harness: 'all', tier: 'all' })}>Clear saved harness / tier filter ×</KitchenButton>}
      </div>}
      {state.view !== "menus" && (visibleRecipes.length ? <div className="recipe-grid">{visibleRecipes.map((recipe, index) => <RecipeCard key={recipe.id} recipe={recipe} index={index} configurations={registry.configurations} dishes={dishesFor(registry.dishes, recipe.id).filter((dish) => configurations.some((config) => config.configHash === dish.identity.configHash))} onOpen={(dish) => openRecipe(recipe, dish)} />)}</div> : <EmptyState title="No matching recipes."><p>Try another model or clear your filters.</p><KitchenButton onClick={() => update({ query: "", cuisine: "all", origin: "all", family: "all", effort: "all", harness: "all", tier: "all" })}>Clear filters</KitchenButton></EmptyState>)}
      {state.view === "menus" && (registry.menus.length ? <><div className="menu-grid">{registry.menus.map((menu) => <KitchenButton className="menu-card" key={menu.id} onClick={() => update({ menu: menu.id, menuRevision: "" })}><span className="eyebrow">A Menu for comparison</span><strong>{menu.title}</strong><span>{menu.summary}</span><span>Inspect the Menu →</span></KitchenButton>)}</div>{menuRevision && <section className="menu-detail"><header><h3>{menuRevision.title}</h3><label className="field">Menu revision<select value={menuRevision.hash} onChange={(event) => update({ menuRevision: event.target.value })}>{registry.menuRevisions.filter((item) => item.menuId === menuRevision.menuId).map((item) => <option key={item.hash} value={item.hash}>{shortHash(item.hash)}</option>)}</select></label><p>All {menuRevision.recipes.length} pinned recipes count toward coverage. A blank cell stays blank.</p></header><div className="coverage-scroll"><table className="coverage-table"><caption>Coverage by exact requested configuration</caption><thead><tr><th scope="col">Recipe</th>{registry.configurations.map((config) => <th scope="col" key={config.id}>{configLabel(config)}<small>{menuRevision.recipes.filter((member) => dishesFor(registry.dishes, member.recipeId, member.recipeHash, config.configHash).length).length}/{menuRevision.recipes.length} represented</small></th>)}</tr></thead><tbody>{menuRevision.recipes.map((member) => { const recipe = allRecipes.find((item) => item.id === member.recipeId); return <tr key={member.recipeId}><th scope="row">{recipe?.title ?? member.recipeId}<small>{shortHash(member.recipeHash)}</small></th>{registry.configurations.map((config) => { const count = dishesFor(registry.dishes, member.recipeId, member.recipeHash, config.configHash).length; return <td key={config.id}>{count && recipe ? <KitchenButton onClick={() => update({ recipe: recipe.id, revision: member.recipeHash, models: [config.id], dishes: [] })}>{count} {count === 1 ? "dish" : "dishes"} ↗</KitchenButton> : <span className="missing-cell">Not cooked</span>}</td>; })}</tr>; })}</tbody></table></div></section>}</> : <EmptyState title="No menus yet."><p>Menus group recipes for comparison. They appear here once every recipe has a dish.</p><KitchenButton tone="primary" onClick={() => update({ view: "recipes" })}>Browse recipes →</KitchenButton></EmptyState>)}
    </section>
    <footer className="kitchen-footer"><Mark /><KitchenButton onClick={() => update({ styleguide: true })}>Visual system ↗</KitchenButton></footer>
  </main>;
}
