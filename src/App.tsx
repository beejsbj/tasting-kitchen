import { useCallback, useEffect, useMemo, useState } from "react";
import { ArtifactPane } from "./components/ArtifactPane";
import { Badge } from "./components/Badge";
import { KitchenButton } from "./components/KitchenButton";
import { Mark } from "./components/Mark";
import { RecipeBrief } from "./components/RecipeBrief";
import { RecipeCard } from "./components/RecipeCard";
import { artifactUrl, dishesFor, loadRegistry, modelFamily, recipeAtRevision, reviewsForDish, shortHash } from "./lib/registry";
import { readGalleryState, writeGalleryState, type GalleryState } from "./lib/url-state";
import { StyleGuide } from "./styleguide/StyleGuide";
import type { Configuration, Recipe, Registry } from "./types";

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
  return `${modelFamily(config.model)} · ${config.reasoningEffort} · ${config.serviceTier}`;
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
  const openRecipe = (recipe: Recipe, revision = "") => update({
    recipe: recipe.id, revision, dishes: [], brief: false,
    models: configurations.filter((config) => registry.dishes.some((dish) => dish.recipe.id === recipe.id && dish.identity.configHash === config.configHash)).slice(0, 2).map((config) => config.id),
  });
  const chosenConfigs = state.models.map((id) => registry.configurations.find((config) => config.id === id)).filter((config): config is Configuration => Boolean(config));

  if (state.styleguide) return <StyleGuide registry={registry} onExit={() => update({ styleguide: false })} />;
  if (state.recipe && !currentRecipe) return <main className="kitchen"><Mark /><EmptyState title="That recipe isn’t on the public counter."><p>It may be private, uncooked, or no longer available at this address.</p><KitchenButton onClick={closeRecipe}>Back to recipes</KitchenButton></EmptyState></main>;

  if (currentRecipe) {
    const recipeDishes = dishesFor(registry.dishes, currentRecipe.id);
    const hashes = [...new Set(recipeDishes.map((dish) => dish.recipe.hash))];
    const recipeHash = hashes.includes(state.revision) ? state.revision : recipeDishes.at(-1)?.recipe.hash ?? currentRecipe.recipeHash;
    const revision = registry.recipeRevisions.find((item) => item.recipeId === currentRecipe.id && item.hash === recipeHash);
    const recipe = recipeAtRevision(currentRecipe, revision);
    const defaults = registry.configurations.filter((config) => recipeDishes.some((dish) => dish.identity.configHash === config.configHash)).slice(0, 2);
    const selected = chosenConfigs.length ? chosenConfigs : defaults;
    const slots = selected.map((config, index) => {
      const repeats = dishesFor(registry.dishes, recipe.id, recipeHash, config.configHash);
      return { config, repeats, dish: repeats.find((dish) => dish.id === state.dishes[index]) ?? repeats[0] };
    });
    const dimensions = new Set(selected.map((config) => JSON.stringify({ harness: config.harness, effort: config.reasoningEffort, tier: config.serviceTier, profile: config.executionProfile, personality: config.personality, capabilities: [...config.capabilities].sort() })));
    const harnessVersions = new Set(slots.map(({ dish }) => dish?.identity.harnessVersion).filter(Boolean));
    const drift = slots.some(({ dish }) => dish && (dish.identity.requestedModel !== dish.identity.observedModel || (dish.identity.observedServiceTier && dish.identity.observedServiceTier !== dish.identity.requestedServiceTier)));
    const comparisonNote = slots.some((slot) => !slot.dish) ? "Incomplete coverage for these settings" : drift ? "Observed configuration drift — inspect receipts" : (dimensions.size > 1 || harnessVersions.size > 1) ? "Same recipe revision · settings differ" : "Same recipe revision · inspect configuration receipts";
    function chooseConfig(index: number, id: string) {
      const models = selected.map((config) => config.id); models[index] = id;
      const dishes = [...state.dishes]; dishes[index] = "";
      update({ models, dishes });
    }
    return <main className="tasting-room">
      <header className="tasting-room__header"><KitchenButton onClick={closeRecipe}>← Counter</KitchenButton><Mark /><KitchenButton onClick={() => update({ brief: true })} data-brief-control>Read the recipe ↗</KitchenButton></header>
      <section className="tasting-room__intro"><div><Badge origin={recipe.origin} /><h1>{recipe.title}</h1><p>{recipe.summary}</p></div><label className="field">Recipe revision<select aria-label="Recipe revision" value={recipeHash} onChange={(event) => update({ revision: event.target.value, dishes: [] })}>{hashes.map((hash) => <option key={hash} value={hash}>{shortHash(hash)}{hash === currentRecipe.recipeHash ? " · latest cooked" : " · preserved"}</option>)}</select></label></section>
      {state.revision && !hashes.includes(state.revision) && <p role="status" className="helper">That revision has no public Dishes here. Showing the latest available revision.</p>}
      <div className="comparison-toolbar"><p><span className="status-dot" />{comparisonNote}</p><div><KitchenButton disabled={selected.length >= 3} onClick={() => update({ models: [...selected.map((config) => config.id), selected[0]?.id ?? registry.configurations[0].id] })}>+ Compare another</KitchenButton><span className="helper">Same configuration twice compares Repeats.</span></div></div>
      <section className="comparison-grid" style={{ "--columns": Math.max(1, slots.length) } as React.CSSProperties} aria-label="Artifact comparison">
        {slots.map(({ config, repeats, dish }, index) => <article className="comparison-slot" key={`${index}-${config.id}`}>
          <header className="comparison-slot__head"><label className="field"><span>Configuration {String(index + 1).padStart(2, "0")}</span><select aria-label={`Configuration ${index + 1}`} value={config.id} onChange={(event) => chooseConfig(index, event.target.value)}>{registry.configurations.map((candidate) => <option key={candidate.id} value={candidate.id}>{configLabel(candidate)} · {candidate.harness}</option>)}</select></label>{slots.length > 1 && <KitchenButton aria-label={`Remove configuration ${index + 1}`} onClick={() => update({ models: selected.filter((_, i) => i !== index).map((item) => item.id), dishes: slots.filter((_, i) => i !== index).map((item) => item.dish?.id ?? "") })}>×</KitchenButton>}</header>
          <div className="comparison-slot__repeat"><label>Dish<select aria-label={`Dish for configuration ${index + 1}`} disabled={!repeats.length} value={dish?.id ?? ""} onChange={(event) => { const dishes = slots.map((slot) => slot.dish?.id ?? ""); dishes[index] = event.target.value; update({ dishes }); }}>{!repeats.length && <option value="">Not cooked</option>}{repeats.map((repeat, i) => <option value={repeat.id} key={repeat.id}>{i + 1} of {repeats.length} · {new Date(repeat.executedAt).toLocaleDateString()}</option>)}</select></label>{dish && <a href={artifactUrl(dish)} target="_blank" rel="noreferrer">Open artifact ↗</a>}</div>
          <ArtifactPane recipe={recipe} variant={config} dish={dish} reviews={reviewsForDish(registry.reviews, dish)} />
          {dish && <details className="receipt"><summary>Configuration &amp; receipt <code>{shortHash(dish.dishHash)}</code></summary><dl><dt>Requested</dt><dd>{dish.identity.requestedModel}</dd><dt>Observed</dt><dd>{dish.identity.observedModel}</dd><dt>Harness</dt><dd>{dish.identity.harness} {dish.identity.harnessVersion}</dd><dt>Effort</dt><dd>{dish.identity.reasoningEffort}</dd><dt>Tier requested / observed</dt><dd>{dish.identity.requestedServiceTier ?? dish.identity.serviceTier} / {dish.identity.observedServiceTier ?? "not recorded"}</dd><dt>Recipe revision</dt><dd>{shortHash(dish.recipe.hash)}</dd><dt>Executed</dt><dd>{new Date(dish.executedAt).toLocaleString()}</dd></dl><a href={artifactUrl(dish, "dish.json")} target="_blank" rel="noreferrer">Immutable manifest ↗</a></details>}
        </article>)}
      </section>
      <footer className="room-footer">An accepted Dish passed its required checks. Taste is yours.</footer>
      {state.brief && <RecipeBrief recipe={recipe} reviews={slots.flatMap(({ dish, config }) => reviewsForDish(registry.reviews, dish).map((review) => ({ review, variant: config })))} onClose={() => update({ brief: false })} />}
    </main>;
  }

  const menuRevision = registry.menuRevisions.find((menu) => menu.menuId === state.menu && (!state.menuRevision || menu.hash === state.menuRevision));
  return <main className="kitchen">
    <a className="skip-link" href="#counter-content">Skip to the recipes</a>
    <header className="kitchen-header"><KitchenButton className="brand-button" aria-label="Tasting Kitchen home" onClick={() => update({ view: "recipes", menu: "", cuisine: "all", origin: "all", query: "", family: "all", effort: "all", harness: "all", tier: "all" })}><Mark /></KitchenButton><nav aria-label="Browse the Kitchen">{(["recipes", "menus", "models"] as const).map((view) => <KitchenButton key={view} aria-current={state.view === view ? "page" : undefined} onClick={() => update({ view, menu: "", family: "all", effort: "all", harness: "all", tier: "all" })}>{view[0].toUpperCase() + view.slice(1)}</KitchenButton>)}</nav><span className="kitchen-header__note"><span className="status-dot" />Open for tasting</span></header>
    <section className="counter-hero"><div><p className="eyebrow">A working collection of model instincts</p><h1>Same recipe.<br /><span>Different instincts.</span></h1><p className="counter-hero__description">Give models something worth making.<br />Explore what comes back. Develop your own taste.</p></div><aside className="counter-ticket"><span className="eyebrow">On the counter</span><div><strong>{registry.recipes.length.toString().padStart(2, "0")}</strong><span>recipes<br />with something to taste</span></div><div className="counter-ticket__foot"><span>{registry.dishes.length} preserved dishes</span><span>{families.length} model families</span></div><p>Every artifact keeps its brief, configuration and history.</p></aside></section>
    <section className="counter-content" id="counter-content">
      <header className="section-heading"><div><p className="eyebrow">{state.view === "menus" ? "Deliberate combinations" : state.view === "models" ? "Follow a fingerprint" : "Choose your first taste"}</p><h2>{state.view === "menus" ? "The Menus" : state.view === "models" ? "Model shelf" : "The recipe counter"}</h2></div><span>{state.view === "menus" ? `${registry.menus.length} public menus` : `${visibleRecipes.length} recipes on view`}</span></header>
      {state.view !== "menus" && <div className="counter-filters"><label className="search-field"><span className="sr-only">Search recipes</span><span aria-hidden="true">⌕</span><input type="search" placeholder="Find something worth making…" value={state.query} onChange={(event) => update({ query: event.target.value }, "replace")} /></label><label className="field"><span>Cuisine</span><select aria-label="Cuisine" value={state.cuisine} onChange={(event) => update({ cuisine: event.target.value })}><option value="all">All cuisines</option>{registry.cuisines.filter((cuisine) => allRecipes.some((recipe) => recipe.cuisines.includes(cuisine.id))).map((cuisine) => <option key={cuisine.id} value={cuisine.id}>{cuisine.label}</option>)}</select></label><label className="field"><span>Lineage</span><select aria-label="Lineage" value={state.origin} onChange={(event) => update({ origin: event.target.value })}><option value="all">All lineages</option><option value="textbook">Textbook · familiar tasks</option><option value="mothers">Mother’s · from lived practice</option><option value="hybrid">Hybrid · a personal constraint</option></select></label></div>}
      {state.view === "models" && <div className="model-facets"><div className="family-tabs" aria-label="Model family"><KitchenButton aria-pressed={state.family === "all"} onClick={() => update({ family: "all" })}>All models</KitchenButton>{families.map((family) => <KitchenButton key={family} aria-pressed={family === state.family} onClick={() => update({ family })}>{family}</KitchenButton>)}</div><label className="field">Reasoning effort<select aria-label="Reasoning effort" value={state.effort} onChange={(event) => update({ effort: event.target.value })}><option value="all">All efforts</option>{[...new Set(registry.configurations.map((config) => config.reasoningEffort))].map((effort) => <option key={effort}>{effort}</option>)}</select></label>{([{ key: "harness", label: "Harness", values: registry.configurations.map((config) => config.harness) }, { key: "tier", label: "Service tier", values: registry.configurations.map((config) => config.serviceTier) }] as const).map(({ key, label, values }) => <label className="field" key={key}>{label}<select aria-label={label} value={state[key]} onChange={(event) => update({ [key]: event.target.value })}><option value="all">All {key === "tier" ? "tiers" : "harnesses"}</option>{[...new Set(values)].map((value) => <option key={value}>{value}</option>)}</select></label>)}<p>Family browsing may include different settings. Open a recipe to inspect exact configurations.</p></div>}
      {state.view !== "menus" && (visibleRecipes.length ? <div className="recipe-grid">{visibleRecipes.map((recipe, index) => <RecipeCard key={recipe.id} recipe={recipe} index={index} dishes={dishesFor(registry.dishes, recipe.id).filter((dish) => configurations.some((config) => config.configHash === dish.identity.configHash))} onOpen={() => openRecipe(recipe)} />)}</div> : <EmptyState title="Nothing on this part of the counter yet."><p>Try another search or remove a filter. Only recipes with accepted Dishes appear here.</p><KitchenButton onClick={() => update({ query: "", cuisine: "all", origin: "all", family: "all", effort: "all", harness: "all", tier: "all" })}>Clear filters</KitchenButton></EmptyState>)}
      {state.view === "menus" && (registry.menus.length ? <><div className="menu-grid">{registry.menus.map((menu) => <KitchenButton className="menu-card" key={menu.id} onClick={() => update({ menu: menu.id, menuRevision: "" })}><span className="eyebrow">A Menu for comparison</span><strong>{menu.title}</strong><span>{menu.summary}</span><span>Inspect the Menu →</span></KitchenButton>)}</div>{menuRevision && <section className="menu-detail"><header><h3>{menuRevision.title}</h3><label className="field">Menu revision<select value={menuRevision.hash} onChange={(event) => update({ menuRevision: event.target.value })}>{registry.menuRevisions.filter((item) => item.menuId === menuRevision.menuId).map((item) => <option key={item.hash} value={item.hash}>{shortHash(item.hash)}</option>)}</select></label><p>All {menuRevision.recipes.length} pinned recipes count toward coverage. A blank cell stays blank.</p></header><div className="coverage-scroll"><table className="coverage-table"><caption>Coverage by exact requested configuration</caption><thead><tr><th scope="col">Recipe</th>{registry.configurations.map((config) => <th scope="col" key={config.id}>{configLabel(config)}<small>{menuRevision.recipes.filter((member) => dishesFor(registry.dishes, member.recipeId, member.recipeHash, config.configHash).length).length}/{menuRevision.recipes.length} represented</small></th>)}</tr></thead><tbody>{menuRevision.recipes.map((member) => { const recipe = allRecipes.find((item) => item.id === member.recipeId); return <tr key={member.recipeId}><th scope="row">{recipe?.title ?? member.recipeId}<small>{shortHash(member.recipeHash)}</small></th>{registry.configurations.map((config) => { const count = dishesFor(registry.dishes, member.recipeId, member.recipeHash, config.configHash).length; return <td key={config.id}>{count && recipe ? <KitchenButton onClick={() => update({ recipe: recipe.id, revision: member.recipeHash, models: [config.id], dishes: [] })}>{count} {count === 1 ? "dish" : "dishes"} ↗</KitchenButton> : <span className="missing-cell">Not cooked</span>}</td>; })}</tr>; })}</tbody></table></div></section>}</> : <EmptyState title="The first Menu is still being prepared."><p>A Menu reaches this shelf when every recipe in its exact revision has something to taste. Individual recipes are already on the counter.</p><KitchenButton tone="primary" onClick={() => update({ view: "recipes" })}>Browse recipes →</KitchenButton></EmptyState>)}
    </section>
    <aside className="kitchen-note"><span className="note-symbol" aria-hidden="true">↔</span><div><h2>A fingerprint takes more than one impression.</h2><p>Try a neighboring recipe. Revisit a result. Compare a Repeat. The differences are here for you to notice, not for a leaderboard to settle.</p></div></aside>
    <footer className="kitchen-footer"><Mark /><span>Made for human taste.</span><KitchenButton onClick={() => update({ styleguide: true })}>Inside the visual system ↗</KitchenButton></footer>
  </main>;
}
