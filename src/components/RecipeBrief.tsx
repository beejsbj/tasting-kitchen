import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { IconButton } from "./ui/ViewerControls";
import { useEffect, useState } from "react";
import { Badge } from "./Badge";
import { KitchenButton } from "./KitchenButton";
import { shortHash } from "../lib/registry";
import type { ArtifactReview, Recipe, Variant } from "../types";

type ReviewEntry = { review: ArtifactReview; variant: Variant };
function Fixture({ fixture }: { fixture: Recipe["setup"]["fixtures"][number] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!fixture.url || fixture.mediaType.startsWith("image/")) return;
    const controller = new AbortController();
    fetch(fixture.url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Input could not be loaded.");
      setText(await response.text());
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Input unavailable."); });
    return () => controller.abort();
  }, [fixture.url, fixture.mediaType]);
  return <details className="fixture"><summary>{fixture.id}<span>{fixture.mediaType}</span></summary><p><code>{fixture.mountAs}</code>{fixture.sha256 && <span> · {shortHash(fixture.sha256)}</span>}</p>{fixture.url ? <><a href={fixture.url} target="_blank" rel="noreferrer">Open exact input ↗</a>{fixture.mediaType.startsWith("image/") ? <img src={fixture.url} alt={`Supplied ${fixture.id} reference`} /> : <pre>{error || text || "Loading input…"}</pre>}</> : <p>This input is recorded, but its public preview is unavailable.</p>}</details>;
}
export function RecipeBrief({ recipe, reviews = [], onClose }: { recipe: Recipe; reviews?: ReviewEntry[]; onClose: () => void }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20" />
    <Dialog.Content className="recipe-sheet fixed inset-y-0 right-0 z-50 w-[min(32rem,100vw)] overflow-y-auto border-l border-slate-200 bg-white text-slate-800 shadow-2xl focus:outline-none" aria-describedby={undefined} onEscapeKeyDown={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-brief-control]')?.focus(); }}>
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3"><Dialog.Title className="m-0 text-base font-semibold">Recipe · {shortHash(recipe.recipeHash)}</Dialog.Title><Dialog.Close asChild><IconButton aria-label="Close recipe brief"><X size={18} /></IconButton></Dialog.Close></header>
    <section className="recipe-brief__intro"><Badge origin={recipe.origin} /><h2 id="recipe-brief-title">{recipe.title}</h2><p>{recipe.summary}</p></section>
    <section><h3>What the model receives</h3><p>{recipe.setup.instructions}</p>{recipe.setup.fixtures.map((fixture) => <Fixture key={`${recipe.recipeHash}-${fixture.id}`} fixture={fixture} />)}</section>
    <section><h3>The brief, in order</h3><ol className="turn-list">{recipe.turns.map((turn, index) => <li key={turn.id}><span>{String(index + 1).padStart(2, "0")} · {turn.role.replaceAll("-", " ")}</span><p>{turn.content}</p></li>)}</ol></section>
    <section><h3>Deliverable &amp; boundaries</h3><p><code>{recipe.output.entry}</code> · {recipe.kind}</p>{recipe.presentation && <p>Presentation: <code>{recipe.presentation.profile}</code>{recipe.presentation.semanticRuntime && <> · {recipe.presentation.semanticRuntime.id} {recipe.presentation.semanticRuntime.version}</>}</p>}<p>Tools: {recipe.harness.capabilities.join(", ")}. Workspace: {recipe.harness.workspace}. Web: {recipe.harness.web}.</p><p>The prompt, input bytes, tool boundary and required checks are held constant for this Recipe Revision.</p></section>
    <section><h3>Required checks</h3><ul>{recipe.validation.checks.filter((check) => check.required).map((check) => <li key={check.id}>{check.description}</li>)}</ul><p className="helper">Passing these checks does not declare an artifact tasteful or preferred.</p></section>
    <section><h3>Things you might notice</h3><ul>{recipe.validation.checks.filter((check) => !check.required).map((check) => <li key={check.id}>{check.description}</li>)}</ul></section>
    <section><h3>Where this recipe comes from</h3><p>{recipe.originNote || (recipe.origin === "textbook" ? "A recognizable task that gives models room for judgment." : "A public-safe task drawn from a particular working practice.")}</p></section>
    {reviews.length > 0 && <section><h3>Artifact review</h3>{reviews.flatMap(({ review, variant }) => review.probes.map((probe) => <article className="review-note" key={`${review.id}-${probe.id}`}><strong>{variant.label}</strong><span>{review.reviewerKind} review · {probe.verdict} · {probe.viewport.width}×{probe.viewport.height}</span><p>{probe.finding}</p></article>))}</section>}
    <footer><KitchenButton tone="primary" onClick={onClose}>Back to tasting</KitchenButton></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
