import { useEffect, useRef } from "react";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import type { ArtifactReview, Domain, Recipe, Variant } from "../types";

type ReviewEntry = { review: ArtifactReview; variant: Variant };

export function RecipeBrief({ recipe, domain, reviews = [], onClose }: { recipe: Recipe; domain?: Domain; reviews?: ReviewEntry[]; onClose: () => void }) {
  const cues = recipe.validation.checks.filter((check) => !check.required);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const dialog = node;
    dialog.focus();
    function containFocus(event: globalThis.KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button, a[href], select, [tabindex]:not([tabindex='-1'])")].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    dialog.addEventListener("keydown", containFocus);
    return () => dialog.removeEventListener("keydown", containFocus);
  }, []);
  return (
    <div ref={panel} className="recipe-brief" role="dialog" aria-modal="true" aria-labelledby="recipe-brief-title" tabIndex={-1}>
      <header><div><span>Recipe</span><i /><span>{domain?.label ?? recipe.domain}</span></div><IconButton label="Close recipe" onClick={onClose}><Icon name="close" /></IconButton></header>
      <section className="recipe-brief__intro"><Badge origin={recipe.origin} /><h2 id="recipe-brief-title">{recipe.title}</h2><p>{recipe.summary}</p></section>
      <section><h3>Setup</h3><p>{recipe.setup.instructions}</p></section>
      <section><h3>Prompt turns</h3><ol className="turn-list">{recipe.turns.map((turn, index) => <li key={turn.id}><span>{String(index + 1).padStart(2, "0")} · {turn.role.replace("-", " ")}</span><p>{turn.content}</p></li>)}</ol></section>
      {cues.length > 0 && <section><h3>Look for</h3><ul>{cues.map((cue) => <li key={cue.id}>{cue.description}</li>)}</ul></section>}
      {reviews.length > 0 && <section className="recipe-brief__reviews"><h3>Artifact review</h3><p>These observations sit beside structural acceptance; they do not change the accepted dish.</p><ul>{reviews.flatMap(({ review, variant }) => review.probes.map((probe) => <li key={`${review.id}-${probe.id}`} data-verdict={probe.verdict}><div><b>{variant.label}</b><span>{review.reviewerKind} review · {probe.verdict} · {probe.viewport.width}×{probe.viewport.height}</span></div><p>{probe.finding}</p><small>{review.reviewer} · {new Date(review.reviewedAt).toLocaleDateString()}</small></li>))}</ul></section>}
      <footer><span>{recipe.kind} artifact</span><span>{recipe.harness.capabilities.join(" + ")}</span><span>v{recipe.version}</span></footer>
    </div>
  );
}
