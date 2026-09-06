import { useEffect, useState } from "react";
import { artifactUrl, recipeSupported } from "../lib/registry";
import { variantTasteLabel } from "../lib/variant-label";
import type { ArtifactReview, Dish, Recipe, ReviewVerdict, Variant } from "../types";
import { SessionArtifact } from "./SessionArtifact";

function TextArtifact({ dish }: { dish: Dish }) {
  const [content, setContent] = useState("Loading artifact…");
  useEffect(() => {
    const controller = new AbortController();
    fetch(artifactUrl(dish), { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("Artifact unavailable");
      return response.text();
    }).then(setContent).catch(() => { if (!controller.signal.aborted) setContent("Artifact could not be loaded."); });
    return () => controller.abort();
  }, [dish]);
  return <pre className="text-artifact">{content}</pre>;
}

function combinedVerdict(reviews: ArtifactReview[]): ReviewVerdict | undefined {
  const verdicts = reviews.flatMap((review) => review.probes.map((probe) => probe.verdict));
  if (verdicts.includes("issue")) return "issue";
  if (verdicts.includes("inconclusive")) return "inconclusive";
  if (verdicts.includes("pass")) return "pass";
}

function ArtifactReviewMark({ reviews }: { reviews: ArtifactReview[] }) {
  const verdict = combinedVerdict(reviews);
  if (!verdict) return null;
  const issueCount = reviews.flatMap((review) => review.probes).filter((probe) => probe.verdict === "issue").length;
  const reviewerKinds = new Set(reviews.map((review) => review.reviewerKind));
  const reviewLabel = reviewerKinds.size > 1 ? "Human + agent review" : reviewerKinds.has("human") ? "Human review" : "Agent review";
  return (
    <aside className="artifact-review-mark" data-verdict={verdict} aria-label={`Accepted structurally; ${reviewLabel.toLowerCase()} ${verdict}`}>
      <span>Accepted structurally</span>
      <b>{reviewLabel} · {verdict}{issueCount > 1 ? ` (${issueCount})` : ""}</b>
    </aside>
  );
}

export function ArtifactPane({ recipe, variant, dish, reviews = [] }: { recipe: Recipe; variant: Variant; dish?: Dish; reviews?: ArtifactReview[] }) {
  const supported = recipeSupported(recipe, variant);
  if (!supported) return <section className="artifact-pane artifact-pane--empty"><div><span>Unsupported by this harness</span><h2>{variantTasteLabel(variant)}</h2><p>This recipe needs {recipe.harness.capabilities.filter((item) => !variant.capabilities.includes(item)).join(", ")}.</p></div></section>;
  if (!dish) return <section className="artifact-pane artifact-pane--empty"><div><span>{recipe.status === "draft" ? "Recipe draft" : "Not tasted yet"}</span><h2>{variantTasteLabel(variant)}</h2><p>Run this recipe with the CLI to add its dish to the kitchen.</p></div></section>;
  if (dish.artifact.kind === "web") return <section className="artifact-pane"><ArtifactReviewMark reviews={reviews} /><iframe src={artifactUrl(dish)} title={`${recipe.title} by ${variant.label}`} sandbox="allow-scripts allow-forms" /></section>;
  if (dish.artifact.kind === "image") return <section className="artifact-pane artifact-pane--image"><ArtifactReviewMark reviews={reviews} /><img src={artifactUrl(dish)} alt={`${recipe.title} by ${variant.label}`} /></section>;
  if (dish.artifact.kind === "audio") return <section className="artifact-pane artifact-pane--audio">
    <ArtifactReviewMark reviews={reviews} />
    {/* Musical artifacts contain no speech requiring captions. */}
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio controls src={artifactUrl(dish)} aria-label={`${recipe.title} audio artifact`} />
    <TextArtifact dish={dish} />
  </section>;
  if (dish.artifact.kind === "session") return <section className="artifact-pane artifact-pane--session"><ArtifactReviewMark reviews={reviews} /><SessionArtifact key={dish.id} dish={dish} /></section>;
  return <section className="artifact-pane artifact-pane--text"><ArtifactReviewMark reviews={reviews} /><TextArtifact dish={dish} /></section>;
}
