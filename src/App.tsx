import { CounterFilters } from "./components/CounterFilters";
import { RecipeBook } from './components/RecipeBook';
import { KitchenNavigation } from './components/KitchenNavigation';
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Home, Columns2, SlidersHorizontal, Info, ExternalLink, NotebookPen, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown } from "lucide-react";
import { ControlPopover, IconButton } from "./components/ui/ViewerControls";
import { ArtifactPane } from "./components/ArtifactPane";
import { KitchenButton } from "./components/KitchenButton";
import { KitchenHero } from "./components/KitchenHero";
import { Mark } from "./components/Mark";
import { RecipeBrief } from "./components/RecipeBrief";
import { ComparisonControls, comparisonValuesFor, heldLabels, valueOf, type ComparisonContext } from "./components/ComparisonControls";
import { TasteObservations } from "./components/TasteObservations";
import { latestDish, resolveRecipeSelection, selectionForDish, skillTokenForDish } from "./lib/selection";
import { DishGallery } from "./components/DishGallery";
import { artifactUrl, briefChanged, catalogChanges, dishesFor, dishSkillKey, loadRegistry, modelFamily, NO_SKILL, reviewsForDish, shortHash, serviceTierDrift, skillLabelFor } from "./lib/registry";
import { configurationFacets, configurationHeading, differenceNote, differingDimensions, environmentKey, environmentName, harnessLabel } from "./lib/configuration-label";
import { compareByNote, MAX_PANES } from "./lib/configuration-axes";
import { readGalleryState, writeGalleryState, type GalleryState } from "./lib/url-state";
import { StyleGuide } from "./styleguide/StyleGuide";
import { readDishVotes, saveDishVotes, syncDishVotes, voteFor, writeDishVote, type DishVote, type VoteMode } from './lib/dish-votes';
import type { Configuration, Dish, Recipe, Registry } from "./types";


/** "copy a1b2c3d4 · CLAUDE.md, memory, skills" for a snapshot; "his real home · a1b2c3d4 at start" for live. */
function setupReceiptLine(setup: NonNullable<NonNullable<Dish['receipt']>['setup']>, digest?: string) {
  if (setup.environment === 'live') return `his real home${setup.digestAtStart ? ` · ${shortHash(setup.digestAtStart)} at start` : ''}`;
  return `copy ${shortHash(digest ?? setup.digest ?? '')}${setup.entries?.length ? ` · ${setup.entries.map((entry) => entry.entry).join(', ')}` : ''}`;
}
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

function configLabel(config: Configuration, withEnvironment = false) {
  return `${modelFamily(config.model)} · ${config.reasoningEffort} · ${config.serviceTier}${withEnvironment ? ` · ${[harnessLabel(config.harness), environmentName(config)].filter(Boolean).join(" · ")}` : ""}${config.historical ? " · preserved" : ""}`;
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-state__mark" aria-hidden="true">—</span><h2>{title}</h2><div>{children}</div></div>;
}

export default function App() {
  const [registry, setRegistry] = useState<Registry>();
  const [error, setError] = useState("");
  const [dishVotes, setDishVotes] = useState(readDishVotes);
  const [voteMode, setVoteMode] = useState<VoteMode>('local');
  const [state, update] = useUrlState();
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [state.recipe, state.editRecipe, state.view, state.styleguide]);
  useEffect(() => { loadRegistry().then(setRegistry).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Catalog unavailable")); }, []);
  useEffect(() => { void syncDishVotes(readDishVotes()).then((result) => { setDishVotes(result.votes); setVoteMode(result.mode); }); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]') && state.recipe && !state.brief) update({ recipe: "", dishes: [] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.recipe, state.brief, update]);
  const configurations = useMemo(() => registry?.configurations.filter((config) =>
    (state.family === "all" || modelFamily(config.model) === state.family) && (state.effort === "all" || config.reasoningEffort === state.effort) &&
    (state.harness === "all" || config.harness === state.harness) && (state.environment === "all" || environmentKey(config) === state.environment) && (state.tier === "all" || config.serviceTier === state.tier)) ?? [], [registry, state.family, state.effort, state.harness, state.environment, state.tier]);
  // The skill filter is a skill id or "none"; Dishes carry the skill hash they ran with.
  const skillFilterKey = useMemo(() => state.skill === "all" ? undefined : state.skill === NO_SKILL ? NO_SKILL : registry?.skills?.find((skill) => skill.id === state.skill)?.skillHash ?? state.skill, [registry, state.skill]);
  const counterDishes = useMemo(() => registry?.dishes.filter((dish) => configurations.some((config) => config.configHash === dish.identity.configHash) && (!skillFilterKey || dishSkillKey(dish) === skillFilterKey)) ?? [], [registry, configurations, skillFilterKey]);
  const visibleRecipes = useMemo(() => {
    if (!registry) return [];
    const unfiltered = state.family === "all" && state.effort === "all" && state.harness === "all" && state.environment === "all" && state.tier === "all" && !skillFilterKey;
    return registry.recipes.filter((recipe) =>
      (state.cuisine === "all" || recipe.cuisines.includes(state.cuisine)) &&
      (state.origin === "all" || recipe.origin === state.origin) &&
      `${recipe.title} ${recipe.summary}`.toLowerCase().includes(state.query.toLowerCase()) &&
      (unfiltered || counterDishes.some((dish) => dish.recipe.id === recipe.id))).sort((a, b) => Number(b.kind === "web") - Number(a.kind === "web"));
  }, [registry, state.cuisine, state.origin, state.query, state.family, state.effort, state.harness, state.environment, state.tier, skillFilterKey, counterDishes]);

  if (!registry) return <main className="loading-screen"><Mark /><p role={error ? "alert" : "status"}>{error || "Setting the table…"}</p>{error && <KitchenButton onClick={() => window.location.reload()}>Try again</KitchenButton>}</main>;
  const families = [...new Set(registry.configurations.map((config) => modelFamily(config.model)))];
  const facets = configurationFacets(registry.configurations);
  const allRecipes = registry.recipes;
  const currentRecipe = allRecipes.find((recipe) => recipe.id === state.recipe);
  const closeRecipe = () => update({ recipe: "", skills: [], dishes: [], compare: "", brief: false });
  const openRecipe = (recipe: Recipe, dish?: Dish) => {
    const latest = dish ?? latestDish(dishesFor(registry.dishes, recipe.id));
    if (latest) update({ ...selectionForDish(registry, latest), compare: '', view: 'dishes', editRecipe: '', brief: false });
  };

  if (state.styleguide) return <StyleGuide registry={registry} onExit={() => update({ styleguide: false })} />;
  const navigate = (view: 'dishes' | 'recipes' | 'menus') => update({ view, recipe: '', editRecipe: '', menu: '', skills: [], dishes: [], compare: '', brief: false });
  if (state.view === 'recipes' && !state.recipe) return <main className="kitchen"><KitchenNavigation active="recipes" onNavigate={navigate} /><div className="counter-content"><RecipeBook selectedId={state.editRecipe} onSelect={editRecipe => update({ editRecipe })} registry={registry} onDishes={id => { const recipe = registry.recipes.find(item => item.id === id); if (recipe) openRecipe(recipe); }} /></div><footer className="kitchen-footer"><Mark /><KitchenButton onClick={() => update({ styleguide: true })}>Visual system ↗</KitchenButton></footer></main>;
  if (state.recipe && !currentRecipe) return <main className="kitchen"><Mark /><EmptyState title="That recipe isn’t on the public counter."><p>It may be private, uncooked, or no longer available at this address.</p><KitchenButton onClick={closeRecipe}>Back to dishes</KitchenButton></EmptyState></main>;

  if (currentRecipe) {
    const recipeDishes = dishesFor(registry.dishes, currentRecipe.id);
    const resolved = resolveRecipeSelection(registry, currentRecipe, state);
    const recipe = currentRecipe;
    const slots = resolved.slots.filter((slot): slot is typeof slot & { config: Configuration } => Boolean(slot.config));
    const selected = slots.map((slot) => slot.config);
    const differing = differingDimensions(slots);
    const skillLayers = (recipe.skills?.layers ?? []).map((id) => registry.skills?.find((skill) => skill.id === id)).filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
    const changedLayers = [...new Set(recipeDishes.filter((dish) => dish.skill && !skillLayers.some((skill) => skill.skillHash === dish.skill?.hash)).map((dish) => dish.skill!.hash))];
    const layerChoices = [{ token: NO_SKILL, key: NO_SKILL, label: 'Without skill' }, ...skillLayers.map((skill) => ({ token: skill.id, key: skill.skillHash, label: skill.label })), ...changedLayers.map((hash) => ({ token: hash, key: hash, label: `${recipeDishes.find((dish) => dish.skill?.hash === hash) ? skillLabelFor(registry, recipeDishes.find((dish) => dish.skill?.hash === hash)!) : 'Skill'} · catalog changed`, changed: true }))];
    const showLayers = Boolean(recipe.skills) || recipeDishes.some((dish) => dish.skill);
    const slotTokens = () => slots.map((slot) => slot.dish ? skillTokenForDish(registry, slot.dish) : layerChoices.find((choice) => choice.key === slot.skillKey)?.token ?? '');
    const harnessVersions = new Set(slots.map(({ dish }) => dish?.identity.harnessVersion).filter(Boolean));
    const drift = slots.some(({ dish }) => dish && (dish.identity.requestedModel !== dish.identity.observedModel || serviceTierDrift(dish.identity)));
    const briefHashes = new Set(slots.map(({ dish }) => dish?.recipe.hash).filter(Boolean));
    const context: ComparisonContext = { configurations: registry.configurations, recipeDishes, layerChoices, showLayers };
    // A "Compare by" link only holds when each pane is the configuration that axis value offers and no value repeats; otherwise the panes show as chosen one by one.
    const requested = slots.length > 1 ? state.compare : "";
    const offered = requested ? comparisonValuesFor(context, slots[0], requested) : [];
    const paneValues = requested ? slots.map((slot) => valueOf(slot, requested)) : [];
    const compare = requested && new Set(paneValues).size === slots.length && slots.every((slot, index) => offered.find((item) => item.value === paneValues[index])?.config.id === slot.config.id) ? requested : "";
    const comparisonNote = slots.some((slot) => !slot.dish) ? "Incomplete coverage for these settings" : briefHashes.size > 1 ? "These Dishes were cooked from different versions of the brief" : drift ? "Observed configuration drift — inspect receipts"
      : compare ? compareByNote(compare, heldLabels(context, slots[0], compare), differing) : differenceNote(differing) ?? (harnessVersions.size > 1 ? "Same brief · harness versions differ" : "Same brief · inspect configuration receipts");
    /** In a "Compare by" layout a pane is named by its value of the varied axis; the first also says what is held. */
    const compareValues = compare ? comparisonValuesFor(context, slots[0], compare) : [];
    const paneLabel = (slot: (typeof slots)[number], index: number) => {
      const full = `${configurationHeading(slot.config, modelFamily(slot.config.model))}${showLayers ? ` · ${slot.dish ? skillLabelFor(registry, slot.dish) : layerChoices.find((choice) => choice.key === slot.skillKey)?.label ?? 'Without skill'}` : ''}`;
      if (!compare) return <>{index + 1}<span className="pane-label__total" aria-hidden="true">/{slots.length}</span> · {full}</>;
      const value = compareValues.find((item) => item.value === valueOf(slot, compare));
      return <><span className="sr-only">{index + 1} · {full}</span><span aria-hidden="true">{index + 1}<span className="pane-label__total">/{slots.length}</span> · <b>{value?.label ?? full}</b>{value && !value.isolated && <> · also {value.differs.join(' · ')}</>}{index === 0 && <span className="pane-label__held"> · holding {heldLabels(context, slots[0], compare).join(' · ')}</span>}</span></>;
    };
    const columns = slots.length <= 3 ? Math.max(1, slots.length) : slots.length === 4 ? 2 : 3;
    const rows = Math.ceil(Math.max(1, slots.length) / columns);
    const addComparison = () => {
      const next = registry.configurations.find((candidate) => !selected.some((config) => config.id === candidate.id) && recipeDishes.some((dish) => dish.identity.configHash === candidate.configHash)) ?? selected[0];
      if (next) update({ compare: '', models: [...selected.map((config) => config.id), next.id], skills: [...slotTokens(), ''], dishes: slots.map((slot) => slot.dish?.id ?? '') });
    };
    const chooseRepeat = (index: number, id: string) => { const dishes = slots.map((slot) => slot.dish?.id ?? ''); dishes[index] = id; update({ skills: slotTokens(), dishes }); };
    const navigableDishes = [...recipeDishes].sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.id.localeCompare(b.id));
    const focusedDish = slots.length === 1 ? slots[0].dish : undefined;
    const focusedIndex = focusedDish ? navigableDishes.findIndex((dish) => dish.id === focusedDish.id) : -1;
    const navigateDish = (offset: -1 | 1) => {
      const dish = navigableDishes[focusedIndex + offset];
      if (dish) update({ ...selectionForDish(registry, dish), compare: '', brief: false });
    };
    const vote = (value: DishVote) => {
      if (focusedDish) setDishVotes((current) => {
        const next = writeDishVote(focusedDish.id, value, current);
        void saveDishVotes(next).then(setVoteMode);
        return next;
      });
    };
    return <main className="tasting-room tasting-room--immersive">
      <h1 className="sr-only">{currentRecipe.title}</h1>
      <section className="comparison-grid" data-panes={slots.length} style={{ "--columns": columns, "--rows": rows, "--panes": Math.max(1, slots.length) } as React.CSSProperties} aria-label="Artifact comparison">
        {slots.map(({ config, dish }, index) => <article className="comparison-slot" key={`${index}-${config.id}`}>
          {slots.length > 1 && <div className="pane-label">{paneLabel(slots[index], index)}</div>}
          <ArtifactPane recipe={recipe} variant={config} dish={dish} reviews={reviewsForDish(registry.reviews, dish)} />
        </article>)}
      </section>
      <nav aria-label="Artifact controls" className="viewer-dock fixed right-3 top-4 z-30 flex max-h-[calc(100dvh-2rem)] flex-col items-center gap-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 p-1.5 text-slate-800 shadow-lg backdrop-blur-md sm:right-5 sm:top-6">
        <IconButton aria-label="Back to dishes" title="Back to dishes" onClick={closeRecipe}><Home size={19} /></IconButton>
        <IconButton aria-label="Open recipe in book" title="Open recipe in book" onClick={() => update({ view: 'recipes', editRecipe: currentRecipe.id, recipe: '', brief: false })}><NotebookPen size={19} /></IconButton>
        {focusedDish && <div className="flex flex-col gap-1 border-t border-slate-200 pt-1" role="group" aria-label="Move between dishes for this recipe">
          <IconButton aria-label="Previous dish" title="Previous dish" disabled={focusedIndex <= 0} onClick={() => navigateDish(-1)}><ChevronLeft size={19} /></IconButton>
          <IconButton aria-label="Next dish" title="Next dish" disabled={focusedIndex >= navigableDishes.length - 1} onClick={() => navigateDish(1)}><ChevronRight size={19} /></IconButton>
        </div>}
        {focusedDish && <div className="flex flex-col gap-1 border-t border-slate-200 pt-1" role="group" aria-label={`Rate this dish · ${voteMode === 'synced' ? 'Synced to Tasting Kitchen' : 'Saved on this device'}`}>
          <IconButton aria-label="Good dish" title={`Good dish · ${voteMode === 'synced' ? 'Synced' : 'This device'}`} aria-pressed={voteFor(dishVotes, focusedDish.id) === 'up'} onClick={() => vote('up')}><ThumbsUp size={18} /></IconButton>
          <IconButton aria-label="Not a good dish" title={`Not a good dish · ${voteMode === 'synced' ? 'Synced' : 'This device'}`} aria-pressed={voteFor(dishVotes, focusedDish.id) === 'down'} onClick={() => vote('down')}><ThumbsDown size={18} /></IconButton>
        </div>}
        <IconButton aria-label="Compare another" title="Compare another" disabled={selected.length >= MAX_PANES || !selected.length} onClick={addComparison}><Columns2 size={19} /></IconButton>
        <ControlPopover label="Models and comparison" icon={<SlidersHorizontal size={19} />} className="w-[26rem]">
          <ComparisonControls context={context} title={currentRecipe.title} panes={slots} compare={compare} comparisonNote={comparisonNote} update={(patch) => update(patch)} />
        </ControlPopover>
        <IconButton aria-label="Read the recipe" title="Read the recipe" data-brief-control onClick={() => update({ brief: true }, "replace")}><BookOpen size={19} /></IconButton>
        <ControlPopover label="Configuration receipts" icon={<Info size={19} />}>
          <h2 className="mb-3 text-base font-semibold">Configuration receipts</h2>
          {slots.map(({ dish, config }, index) => <section key={index} className="receipt border-b border-slate-100 last:border-0"><h3 className="text-sm font-semibold">{configurationHeading(config, modelFamily(config.model))}</h3>{dish ? <><dl><dt>Requested</dt><dd>{dish.identity.requestedModel}</dd><dt>Observed</dt><dd>{dish.identity.observedModel}</dd><dt>Harness</dt><dd>{harnessLabel(dish.identity.harness)} {dish.identity.harnessVersion}</dd><dt>Environment</dt><dd>{environmentName(dish.receipt?.configuration ?? config, false)}</dd>{(dish.receipt?.configuration ?? config).executionProfile.harnessProfile && <><dt>Harness profile</dt><dd>{(dish.receipt?.configuration ?? config).executionProfile.harnessProfile}</dd></>}{dish.receipt?.setup && <><dt>Setup</dt><dd>{setupReceiptLine(dish.receipt.setup, dish.identity.setupDigest)}</dd><dt>Memory</dt><dd>{dish.receipt.setup.memory}</dd><dt>Connections</dt><dd>{dish.receipt.setup.connections === 'on' ? `on · ${dish.receipt.setup.loaded?.mcpServers.length ? dish.receipt.setup.loaded.mcpServers.join(', ') : 'no MCP servers reported'}${dish.receipt.setup.loaded?.plugins.length ? ` · plugins ${dish.receipt.setup.loaded.plugins.join(', ')}` : ''}` : 'off'}</dd></>}<dt>Skill layer</dt><dd>{dish.skill ? `${skillLabelFor(registry, dish)} · ${shortHash(dish.skill.hash)}` : 'none'}</dd><dt>Tier requested / observed</dt><dd>{dish.identity.requestedServiceTier ?? dish.identity.serviceTier} / {dish.identity.observedServiceTier ?? 'not recorded'}</dd><dt>Brief</dt><dd>{shortHash(dish.recipe.hash)}{briefChanged(dish, recipe) && <span className="receipt-note"> · brief changed since this Dish</span>}</dd><dt>Inputs</dt><dd>{dish.inputs ? `${dish.inputs.fixtures.length} recorded with this Dish` : "not recorded; the brief shows current inputs"}</dd>{catalogChanges(registry, dish).length > 0 && <><dt>Catalog</dt><dd><span className="receipt-note">catalog changed ({catalogChanges(registry, dish).join(", ")})</span></dd></>}<dt>Executed</dt><dd>{new Date(dish.executedAt).toLocaleString()}</dd></dl><a href={artifactUrl(dish, 'dish.json')} target="_blank" rel="noreferrer">Immutable manifest ↗</a>{reviewsForDish(registry.reviews, dish).flatMap((review) => review.probes.map((probe) => <p key={`${review.id}-${probe.id}`} className="mt-3 text-xs">{review.reviewerKind} review · {probe.verdict}: {probe.finding}</p>))}<a className="mt-3 block" href={artifactUrl(dish)} target="_blank" rel="noreferrer">Open artifact ↗</a></> : <p>No dish for these settings.</p>}</section>)}
        </ControlPopover>
        {focusedDish && <TasteObservations key={focusedDish.id} registry={registry} dish={focusedDish} />}
        {slots.length === 1 && slots[0].dish && <a aria-label="Open artifact in new tab" title="Open artifact in new tab" className="inline-flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100" href={artifactUrl(slots[0].dish)} target="_blank" rel="noreferrer"><ExternalLink size={18} /></a>}
        {slots.length === 1 && slots[0].repeats.length > 1 && <div className="flex flex-col gap-1 border-t border-slate-200 pt-1" role="group" aria-label="Dishes for configuration 1">{slots[0].repeats.map((repeat, i) => <IconButton key={repeat.id} aria-label={`Repeat ${i + 1} for configuration 1`} aria-pressed={slots[0].dish?.id === repeat.id} onClick={() => chooseRepeat(0, repeat.id)}>{i + 1}</IconButton>)}</div>}
      </nav>
      {resolved.slots.some((slot) => !slot.config) && <div role="status" className="fixed left-4 top-4 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">This selection is unavailable. <KitchenButton onClick={() => openRecipe(currentRecipe)}>Open latest dish</KitchenButton></div>}

      {state.brief && <RecipeBrief recipe={recipe} dish={focusedDish ?? slots.find((slot) => slot.dish)?.dish} reviews={slots.flatMap(({ dish, config }) => reviewsForDish(registry.reviews, dish).map((review) => ({ review, variant: config })))} onClose={() => update({ brief: false }, "replace")} />}
    </main>;
  }

  const openMenu = registry.menus.find((menu) => menu.id === state.menu);
  const menuMembers = (openMenu?.recipes ?? []).map((recipeId) => allRecipes.find((item) => item.id === recipeId)).filter((item): item is Recipe => Boolean(item));
  return <main className="kitchen">
    <a className="skip-link" href="#counter-content">Skip to the dishes</a>
    <KitchenNavigation active={state.view === 'menus' ? 'menus' : 'dishes'} onNavigate={navigate} />
    <KitchenHero recipes={registry.recipes.length} dishes={registry.dishes.length} models={families.length} />
    <section className="counter-content" id="counter-content" tabIndex={-1}>
      <header className="section-heading"><h2>{state.view === 'menus' ? 'Menus' : 'Dishes'}</h2><span>{state.view === 'menus' ? `${registry.menus.length} public menus` : `${counterDishes.filter(dish => visibleRecipes.some(recipe => recipe.id === dish.recipe.id)).length} dishes`}</span></header>
      {state.view !== 'menus' && <CounterFilters registry={registry} state={state} update={update} />}
      {state.view !== "menus" && (visibleRecipes.length ? <DishGallery registry={registry} recipes={visibleRecipes} dishes={counterDishes} onOpen={openRecipe} /> : registry.dishes.length === 0 ? <EmptyState title="No dishes yet."><p>The active recipes haven’t been cooked yet. Open the recipe book to see what’s ready.</p><KitchenButton tone="primary" onClick={() => navigate('recipes')}>Browse recipes</KitchenButton></EmptyState> : <EmptyState title="No matching dishes."><p>Try another model or clear your filters.</p><KitchenButton onClick={() => update({ query: "", cuisine: "all", origin: "all", family: "all", effort: "all", harness: "all", environment: "all", tier: "all", skill: "all" })}>Clear filters</KitchenButton></EmptyState>)}
      {state.view === "menus" && (registry.menus.length ? <><div className="menu-grid">{registry.menus.map((menu) => <KitchenButton className="menu-card" key={menu.id} onClick={() => update({ menu: menu.id })}><span className="eyebrow">A Menu for comparison</span><strong>{menu.title}</strong><span>{menu.summary}</span><span>Inspect the Menu →</span></KitchenButton>)}</div>{openMenu && <section className="menu-detail"><header><h3>{openMenu.title}</h3><p>All {menuMembers.length} recipes count toward coverage, measured against each recipe&apos;s current brief. A blank cell stays blank.</p></header><div className="coverage-scroll"><table className="coverage-table"><caption>Coverage by exact requested configuration</caption><thead><tr><th scope="col">Recipe</th>{registry.configurations.map((config) => <th scope="col" key={config.id}>{configLabel(config, facets.environments.length > 1 || facets.harnesses.length > 1)}<small>{menuMembers.filter((member) => dishesFor(registry.dishes, member.id, member.recipeHash, config.configHash).length).length}/{menuMembers.length} represented</small></th>)}</tr></thead><tbody>{menuMembers.map((recipe) => <tr key={recipe.id}><th scope="row">{recipe.title}<small>{shortHash(recipe.recipeHash)}</small></th>{registry.configurations.map((config) => { const count = dishesFor(registry.dishes, recipe.id, recipe.recipeHash, config.configHash).length; return <td key={config.id}>{count ? <KitchenButton onClick={() => update({ recipe: recipe.id, models: [config.id], skills: [], dishes: [], compare: '' })}>{count} {count === 1 ? "dish" : "dishes"} ↗</KitchenButton> : <span className="missing-cell">Not cooked</span>}</td>; })}</tr>)}</tbody></table></div></section>}</> : <EmptyState title="No menus yet."><p>Menus group recipes for comparison. They appear here once every recipe has a dish.</p><KitchenButton tone="primary" onClick={() => update({ view: "recipes" })}>Browse recipes →</KitchenButton></EmptyState>)}
    </section>
    <footer className="kitchen-footer"><Mark /><KitchenButton onClick={() => update({ styleguide: true })}>Visual system ↗</KitchenButton></footer>
  </main>;
}
