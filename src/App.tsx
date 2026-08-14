import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArtifactPane } from "./components/ArtifactPane";
import { ControlDock } from "./components/ControlDock";
import { DomainRail } from "./components/DomainRail";
import { Mark } from "./components/Mark";
import { ModelSelect } from "./components/ModelSelect";
import { RecipeBrief } from "./components/RecipeBrief";
import { RecipeTile } from "./components/RecipeTile";
import { dishFor, loadRegistry, reviewsForDish } from "./lib/registry";
import { readGalleryState, writeGalleryState, type GalleryState } from "./lib/url-state";
import { StyleGuide } from "./styleguide/StyleGuide";
import type { Registry } from "./types";

function useUrlState() {
  const [state, setState] = useState<GalleryState>(() => readGalleryState());
  useEffect(() => {
    const onPop = () => setState(readGalleryState());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const update = useCallback((patch: Partial<GalleryState>, mode: "push" | "replace" = "push") => {
    setState((current) => {
      const next = { ...current, ...patch };
      writeGalleryState(next, mode);
      return next;
    });
  }, []);
  return [state, update] as const;
}

function Loading({ error }: { error?: string }) {
  return <main className="loading-screen"><Mark /><p>{error ?? "Opening the kitchen…"}</p></main>;
}

export default function App() {
  const [registry, setRegistry] = useState<Registry>();
  const [error, setError] = useState("");
  const [state, updateState] = useUrlState();
  const briefWasOpen = useRef(state.brief);

  useEffect(() => { loadRegistry().then(setRegistry).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Registry unavailable")); }, []);

  const visibleRecipes = useMemo(() => {
    if (!registry) return [];
    const domainOrder = new Map(registry.domains.map((domain, index) => [domain.id, index]));
    return registry.recipes
      .filter((recipe) => recipe.status !== "hidden" && (state.domain === "all" || recipe.domain === state.domain))
      .sort((left, right) => (domainOrder.get(left.domain) ?? 99) - (domainOrder.get(right.domain) ?? 99) || Number(left.status === "draft") - Number(right.status === "draft") || left.title.localeCompare(right.title));
  }, [registry, state.domain]);
  const selectedRecipe = registry?.recipes.find((recipe) => recipe.id === state.recipe);
  const selectedVariants = useMemo(() => {
    if (!registry) return [];
    const ids = state.models.length ? state.models : [registry.variants[0]?.id];
    const resolved = ids.map((id) => registry.variants.find((variant) => variant.id === id)).filter((variant): variant is Registry["variants"][number] => Boolean(variant));
    return resolved.length ? resolved : registry.variants.slice(0, 1);
  }, [registry, state.models]);

  const stepRecipe = useCallback((direction: number) => {
    if (!registry || !selectedRecipe) return;
    const list = registry.recipes.filter((recipe) => recipe.status !== "hidden");
    const index = list.findIndex((recipe) => recipe.id === selectedRecipe.id);
    const next = list[(index + direction + list.length) % list.length];
    updateState({ recipe: next.id, domain: next.domain, brief: false });
  }, [registry, selectedRecipe, updateState]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!registry || !state.recipe) return;
      if (event.target instanceof HTMLElement && (event.target.matches("button, input, select, textarea") || event.target.isContentEditable)) return;
      if (event.key === "Escape") updateState(state.brief ? { brief: false } : { recipe: "", brief: false });
      if (!state.brief && event.key === "ArrowLeft") stepRecipe(-1);
      if (!state.brief && event.key === "ArrowRight") stepRecipe(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry, state.recipe, state.brief, stepRecipe, updateState]);

  useEffect(() => {
    if (briefWasOpen.current && !state.brief) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-brief-control]")?.focus());
    briefWasOpen.current = state.brief;
  }, [state.brief]);

  if (!registry) return <Loading error={error || undefined} />;
  if (state.styleguide) return <StyleGuide registry={registry} onExit={() => updateState({ styleguide: false }, "replace")} />;

  function chooseSlot(slot: number, id: string) {
    const models = [...selectedVariants.map((variant) => variant.id)];
    models[slot] = id;
    updateState({ models });
  }

  if (selectedRecipe) {
    const viewedDishes = selectedVariants.map((variant) => ({ variant, dish: dishFor(registry.dishes, selectedRecipe.id, variant.id) }));
    const reviewEntries = viewedDishes.flatMap(({ dish, variant }) => reviewsForDish(registry.reviews, dish).map((review) => ({ review, variant })));
    return (
      <main className={`viewer viewer--${selectedVariants.length}`}>
        <div className="viewer__underlay" inert={state.brief || undefined} aria-hidden={state.brief || undefined}>
          <div className="viewer__label"><Mark compact /><span>{registry.domains.find((domain) => domain.id === selectedRecipe.domain)?.label}</span><i>{selectedRecipe.kind}</i></div>
          <div className="viewer__grid">
            {viewedDishes.map(({ variant, dish }) => <ArtifactPane key={variant.id} recipe={selectedRecipe} variant={variant} dish={dish} reviews={reviewsForDish(registry.reviews, dish)} />)}
          </div>
          <ControlDock recipe={selectedRecipe} variants={registry.variants} selected={selectedVariants} onExit={() => updateState({ recipe: "", brief: false })} onBrief={() => updateState({ brief: !state.brief })} onModel={chooseSlot} onAdd={() => {
            const next = registry.variants.find((variant) => !selectedVariants.some((selected) => selected.id === variant.id));
            if (next) updateState({ models: [...selectedVariants.map((variant) => variant.id), next.id] });
          }} onPrevious={() => stepRecipe(-1)} onNext={() => stepRecipe(1)} />
        </div>
        {state.brief && <><button className="viewer__scrim" aria-label="Close recipe" onClick={() => updateState({ brief: false })} /><RecipeBrief recipe={selectedRecipe} domain={registry.domains.find((domain) => domain.id === selectedRecipe.domain)} reviews={reviewEntries} onClose={() => updateState({ brief: false })} /></>}
      </main>
    );
  }

  const activeDomain = registry.domains.find((domain) => domain.id === state.domain);
  const selectedCollection = selectedVariants[0] ?? registry.variants[0];
  const tasted = visibleRecipes.filter((recipe) => dishFor(registry.dishes, recipe.id, selectedCollection.id)).length;
  return (
    <main className="gallery">
      <header className="gallery-header"><Mark /><div><span>Collection</span><ModelSelect label="Choose model collection" variant={selectedCollection} variants={registry.variants} onChange={(id) => updateState({ models: [id] })} /></div></header>
      <DomainRail domains={registry.domains} recipes={registry.recipes} active={state.domain} onSelect={(domain) => updateState({ domain })} />
      <section className="gallery-content">
        <header className="gallery-content__heading"><div><p>{activeDomain ? "Use area" : "Recipe menu"}</p><h1>{activeDomain?.label ?? "See what each model reaches for."}</h1><span>{activeDomain?.description ?? "Same recipes. Exact configurations. The artifacts stay visible so you can learn the fingerprint yourself."}</span></div><dl><div><dt>Recipes</dt><dd>{visibleRecipes.length}</dd></div><div><dt>Tasted</dt><dd>{tasted}</dd></div><div><dt>Harness</dt><dd>Codex CLI</dd></div></dl></header>
        <div className="recipe-grid">{visibleRecipes.map((recipe, index) => <RecipeTile key={recipe.id} recipe={recipe} variant={selectedCollection} dish={dishFor(registry.dishes, recipe.id, selectedCollection.id)} index={index} onOpen={() => updateState({ recipe: recipe.id, models: [selectedCollection.id], brief: false })} />)}</div>
        <footer className="gallery-footer"><span>Human tasting, not model ranking.</span><button onClick={() => updateState({ styleguide: true }, "push")}>System specimen</button><time dateTime={registry.generatedAt}>Registry {new Date(registry.generatedAt).toLocaleDateString()}</time></footer>
      </section>
    </main>
  );
}
