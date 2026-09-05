import { useEffect, useRef, useState } from "react";
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
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className="recipe-brief" onCancel={onClose} aria-labelledby="recipe-brief-title">
    <header><span className="eyebrow">The exact recipe · {shortHash(recipe.recipeHash)}</span><KitchenButton aria-label="Close recipe brief" onClick={onClose}>×</KitchenButton></header>
    <section className="recipe-brief__intro"><Badge origin={recipe.origin} /><h2 id="recipe-brief-title">{recipe.title}</h2><p>{recipe.summary}</p></section>
    <section><h3>What the model receives</h3><p>{recipe.setup.instructions}</p>{recipe.setup.fixtures.map((fixture) => <Fixture key={`${recipe.recipeHash}-${fixture.id}`} fixture={fixture} />)}</section>
    <section><h3>The brief, in order</h3><ol className="turn-list">{recipe.turns.map((turn, index) => <li key={turn.id}><span>{String(index + 1).padStart(2, "0")} · {turn.role.replaceAll("-", " ")}</span><p>{turn.content}</p></li>)}</ol></section>
    <section><h3>Deliverable &amp; boundaries</h3><p><code>{recipe.output.entry}</code> · {recipe.kind}</p><p>Tools: {recipe.harness.capabilities.join(", ")}. Workspace: {recipe.harness.workspace}. Web: {recipe.harness.web}.</p><p>The prompt, input bytes, tool boundary and required checks are held constant for this Recipe Revision.</p></section>
    <section><h3>Required checks</h3><ul>{recipe.validation.checks.filter((check) => check.required).map((check) => <li key={check.id}>{check.description}</li>)}</ul><p className="helper">Passing these checks does not declare an artifact tasteful or preferred.</p></section>
    <section><h3>Things you might notice</h3><ul>{recipe.validation.checks.filter((check) => !check.required).map((check) => <li key={check.id}>{check.description}</li>)}</ul></section>
    <section><h3>Where this recipe comes from</h3><p>{recipe.originNote || (recipe.origin === "textbook" ? "A recognizable task that gives models room for judgment." : "A public-safe task drawn from a particular working practice.")}</p></section>
    {reviews.length > 0 && <section><h3>Artifact review</h3>{reviews.flatMap(({ review, variant }) => review.probes.map((probe) => <article className="review-note" key={`${review.id}-${probe.id}`}><strong>{variant.label}</strong><span>{review.reviewerKind} review · {probe.verdict} · {probe.viewport.width}×{probe.viewport.height}</span><p>{probe.finding}</p></article>))}</section>}
    <footer><KitchenButton tone="primary" onClick={onClose}>Back to tasting</KitchenButton></footer>
  </dialog>;
}
