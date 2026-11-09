import { useEffect, useState } from "react";
import { CHEF_FAULT_LABELS, isNoDish, plateUrl } from "../lib/outcomes";
import { artifactUrl, recipeSupported } from "../lib/registry";
import { variantTasteLabel } from "../lib/variant-label";
import type { ArtifactReview, Dish, NoDish, Plate, Recipe, ReviewVerdict, Variant, Verdict } from "../types";
import { SessionArtifact } from "./SessionArtifact";
import { VerdictMark } from "./Verdict";

type ValidationReport = { checks: Array<{ id: string; required: boolean; description: string; passed: boolean; errored?: boolean; detail?: string }> };

/**
 * Where the configuration could not make the Recipe. An empty plate, not an
 * error page: it says what happened in plain words, whose doing it was, and
 * links what is public (the trace up to the failure, the checks, any partial
 * artifact). Nothing here renders the partial artifact as if it were a Dish.
 */
export function NoDishPane({ plate, variant, verdict }: { plate: NoDish; variant: Variant; verdict?: Verdict }) {
  const [report, setReport] = useState<ValidationReport>();
  useEffect(() => {
    if (!plate.validation) return;
    const controller = new AbortController();
    fetch(plateUrl(plate, plate.validation.report), { signal: controller.signal }).then((response) => response.ok ? response.json() : undefined).then(setReport).catch(() => {});
    return () => controller.abort();
  }, [plate]);
  const failing = report?.checks.filter((check) => check.required && !check.passed) ?? [];
  return <section className="artifact-pane artifact-pane--no-dish" data-outcome="no-dish" data-fault={plate.fault.code} aria-label={`No Dish: ${CHEF_FAULT_LABELS[plate.fault.code]}`}>
    <VerdictMark verdict={verdict} checksFailed />
    <div className="no-dish">
      <span className="no-dish__plate" aria-hidden="true" />
      <span className="no-dish__eyebrow">No Dish</span>
      <h2>{variantTasteLabel(variant)}</h2>
      <p className="no-dish__reason">{plate.fault.reason}</p>
      <p className="no-dish__class">The model&rsquo;s own outcome, at the {plate.fault.stage} stage{plate.fault.turn ? <> of turn &ldquo;{plate.fault.turn}&rdquo;</> : null}. Kitchen faults never appear here.</p>
      {failing.length > 0 && <ul className="no-dish__checks" aria-label="Required checks that failed">{failing.map((check) => <li key={check.id}><code>{check.id}</code> {check.description}{check.detail ? <small> · {check.detail}</small> : null}</li>)}</ul>}
      {!report && plate.fault.checks?.length ? <p className="no-dish__class">Failed checks: {plate.fault.checks.join(", ")}</p> : null}
      <p className="no-dish__links">
        {plate.publicTrace ? <a href={plateUrl(plate, plate.publicTrace)} target="_blank" rel="noreferrer">Trace up to the failure ↗</a> : <span>No public trace</span>}
        {plate.validation && <a href={plateUrl(plate, plate.validation.report)} target="_blank" rel="noreferrer">Validation receipt ↗</a>}
        {plate.artifact && <a href={plateUrl(plate, plate.artifact.entry ?? plate.artifact.files[0]?.path ?? "")} target="_blank" rel="noreferrer">Partial artifact ↗</a>}
      </p>
    </div>
  </section>;
}

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

export function ArtifactPane({ recipe, variant, dish, reviews = [], verdict }: { recipe: Recipe; variant: Variant; dish?: Plate; reviews?: ArtifactReview[]; verdict?: Verdict }) {
  const supported = recipeSupported(recipe, variant);
  if (isNoDish(dish)) return <NoDishPane plate={dish} variant={variant} verdict={verdict} />;
  return <CookedPane recipe={recipe} variant={variant} dish={dish} reviews={reviews} supported={supported} verdict={verdict} />;
}

/** Burooj's verdict sits above any automated review mark: his judgment outranks it, and both stay visible. */
function Marks({ reviews, verdict }: { reviews: ArtifactReview[]; verdict?: Verdict }) {
  return <><VerdictMark verdict={verdict} /><ArtifactReviewMark reviews={reviews} /></>;
}

function CookedPane({ recipe, variant, dish, reviews, supported, verdict }: { recipe: Recipe; variant: Variant; dish?: Dish; reviews: ArtifactReview[]; supported: boolean; verdict?: Verdict }) {
  if (!dish && !supported) return <section className="artifact-pane artifact-pane--empty"><div><span>Unsupported by this harness</span><h2>{variantTasteLabel(variant)}</h2><p>This recipe needs {recipe.harness.capabilities.filter((item) => !variant.capabilities.includes(item)).join(", ")}.</p></div></section>;
  if (!dish) return <section className="artifact-pane artifact-pane--empty"><div><span>{recipe.status === "draft" ? "Recipe draft" : "Not tasted yet"}</span><h2>{variantTasteLabel(variant)}</h2><p>Run this recipe with the CLI to add its dish to the kitchen.</p></div></section>;
  if (dish.artifact.kind === "web") return <section className="artifact-pane"><Marks reviews={reviews} verdict={verdict} /><iframe src={artifactUrl(dish)} title={`${recipe.title} by ${variant.label}`} sandbox="allow-scripts allow-forms" /></section>;
  if (dish.artifact.kind === "image") return <section className="artifact-pane artifact-pane--image"><Marks reviews={reviews} verdict={verdict} /><img src={artifactUrl(dish)} alt={`${recipe.title} by ${variant.label}`} /></section>;
  if (dish.artifact.kind === "audio") return <section className="artifact-pane artifact-pane--audio">
    <Marks reviews={reviews} verdict={verdict} />
    {/* Musical artifacts contain no speech requiring captions. */}
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio controls src={artifactUrl(dish)} aria-label={`${recipe.title} audio artifact`} />
    <TextArtifact dish={dish} />
  </section>;
  if (dish.artifact.kind === "session") return <section className="artifact-pane artifact-pane--session"><Marks reviews={reviews} verdict={verdict} /><SessionArtifact key={dish.id} dish={dish} /></section>;
  return <section className="artifact-pane artifact-pane--text"><Marks reviews={reviews} verdict={verdict} /><TextArtifact dish={dish} /></section>;
}
