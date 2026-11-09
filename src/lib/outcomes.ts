import type { Dish, NoDish, Plate, RecipeBudget, Registry, Verdict } from "../types";

/**
 * What a cell holds and what stands on it. A No Dish is a chef fault Kitchen
 * published; a Dish may carry Burooj's verdict, which outranks the automated
 * checks in what the gallery shows. Both stay visible.
 */
export type Outcome = "cooked" | "no-dish" | "failed-by-burooj";
export const OUTCOMES: Array<{ id: Outcome; label: string; title: string }> = [
  { id: "cooked", label: "Cooked", title: "A Dish that passed the Recipe's required checks and that Burooj has not failed" },
  { id: "no-dish", label: "No Dish", title: "The configuration could not make it: failed the required checks or output contract, declined, or ran past the Recipe's time or turn budget" },
  { id: "failed-by-burooj", label: "Failed by Burooj", title: "A Dish that passed the automated checks and that Burooj failed after tasting it" },
];

/** Lower ranks first. Only the owner judges today; another judge joins below him. */
const JUDGE_RANK: Record<Verdict["judge"]["kind"], number> = { owner: 0 };

export const CHEF_FAULT_LABELS: Record<NoDish["fault"]["code"], string> = {
  "checks-failed": "Failed the required checks",
  "output-contract": "Broke the output contract",
  refused: "Declined the Recipe",
  "out-of-turns": "Ran out of turns",
  "out-of-time": "Ran out of time",
};

/** "10 min", "1 h 30 min", "45 s". */
export function durationLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours ? `${hours} h` : "", minutes ? `${minutes} min` : "", rest ? `${rest} s` : ""].filter(Boolean).join(" ") || "0 s";
}

/** "10 min · 40 model turns per prompt". */
export function budgetLabel(budget: RecipeBudget) {
  return [
    budget.seconds !== undefined ? durationLabel(budget.seconds) : "",
    budget.modelTurns !== undefined ? `${budget.modelTurns} model ${budget.modelTurns === 1 ? "turn" : "turns"} per prompt` : "",
  ].filter(Boolean).join(" · ");
}

export function isNoDish(plate: Plate | undefined): plate is NoDish {
  return Boolean(plate) && (plate as Partial<NoDish>).outcome === "no-dish";
}

export function isDish(plate: Plate | undefined): plate is Dish {
  return Boolean(plate) && !isNoDish(plate);
}

/** Every plate on the counter: Dishes and No Dishes. */
export function platesOf(registry: Pick<Registry, "dishes" | "noDishes">): Plate[] {
  return [...registry.dishes, ...(registry.noDishes ?? [])];
}

/** The hash a verdict pins: a Dish's `dishHash` or a No Dish's `noDishHash`. */
export function plateHashOf(plate: Plate): string {
  return isNoDish(plate) ? plate.noDishHash : plate.dishHash;
}

/** The verdict that stands on a plate: the highest-ranked judge's newest, pinned to the plate's exact hash. */
export function standingVerdict(verdicts: Verdict[] | undefined, plate: Plate | undefined): Verdict | undefined {
  if (!plate) return undefined;
  return (verdicts ?? []).filter((verdict) => verdict.plateId === plate.id && verdict.plateHash === plateHashOf(plate))
    .sort((a, b) => JUDGE_RANK[a.judge.kind] - JUDGE_RANK[b.judge.kind] || b.decidedAt.localeCompare(a.decidedAt) || b.id.localeCompare(a.id))[0];
}

export function outcomeOf(registry: Pick<Registry, "verdicts">, plate: Plate): Outcome {
  // A No Dish stays a No Dish on the counter even when Burooj passes it; his verdict shows beside the fault.
  if (isNoDish(plate)) return "no-dish";
  return standingVerdict(registry.verdicts, plate)?.verdict === "failed" ? "failed-by-burooj" : "cooked";
}

/** "No Dish · Failed the required checks (render, contrast)", "No Dish · Ran out of time (budget 10 min)". */
export function noDishLabel(plate: NoDish) {
  const detail = plate.fault.checks?.length ? ` (${plate.fault.checks.join(", ")})` : plate.fault.budget ? ` (budget ${budgetLabel(plate.fault.budget)})` : "";
  return `No Dish · ${CHEF_FAULT_LABELS[plate.fault.code] ?? plate.fault.code}${detail}`;
}

/** What Burooj's pass reads as beside the fault: "checks failed" only where checks failed, else the fault's own label. */
export function passedNoDishLabel(plate: NoDish) {
  return plate.fault.code === "checks-failed" ? `Passed by Burooj · checks failed · ${noDishLabel(plate)}` : `Passed by Burooj · ${noDishLabel(plate)}`;
}

/** "1 dish", "2 dishes · 1 no dish", "1 no dish". */
export function plateCountLabel(plates: Plate[]) {
  const dishes = plates.filter(isDish).length;
  const noDishes = plates.length - dishes;
  return [dishes ? `${dishes} ${dishes === 1 ? "dish" : "dishes"}` : "", noDishes ? `${noDishes} no ${noDishes === 1 ? "dish" : "dishes"}` : ""].filter(Boolean).join(" · ") || "not cooked";
}

/** A plate's public file, relative to its directory under dishes/. */
export function plateUrl(plate: Pick<Plate, "artifactBase">, relative: string) {
  return `${plate.artifactBase.replace(/\/$/, "")}/${relative.split("/").map(encodeURIComponent).join("/")}`;
}
