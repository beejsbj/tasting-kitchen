import type { Dish, NoDish, Plate, Registry, Verdict } from "../types";

/**
 * What a cell holds and what stands on it. A No Dish is a chef fault Kitchen
 * published; a Dish may carry Burooj's verdict, which outranks the automated
 * checks in what the gallery shows. Both stay visible.
 */
export type Outcome = "cooked" | "no-dish" | "failed-by-burooj";
export const OUTCOMES: Array<{ id: Outcome; label: string; title: string }> = [
  { id: "cooked", label: "Cooked", title: "A Dish that passed the Recipe's required checks and that Burooj has not failed" },
  { id: "no-dish", label: "No Dish", title: "The configuration could not make it: failed the required checks or output contract, declined, or ran out of turns" },
  { id: "failed-by-burooj", label: "Failed by Burooj", title: "A Dish that passed the automated checks and that Burooj failed after tasting it" },
];

/** Lower ranks first. Only the owner judges today; another judge joins below him. */
const JUDGE_RANK: Record<Verdict["judge"]["kind"], number> = { owner: 0 };

export const CHEF_FAULT_LABELS: Record<NoDish["fault"]["code"], string> = {
  "checks-failed": "Failed the required checks",
  "output-contract": "Broke the output contract",
  refused: "Declined the Recipe",
  "out-of-turns": "Ran out of turns",
};

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

/** The verdict that stands on a Dish: the highest-ranked judge's newest, pinned to the Dish's exact hash. */
export function standingVerdict(verdicts: Verdict[] | undefined, dish: Plate | undefined): Verdict | undefined {
  if (!isDish(dish)) return undefined;
  return (verdicts ?? []).filter((verdict) => verdict.dishId === dish.id && verdict.dishHash === dish.dishHash)
    .sort((a, b) => JUDGE_RANK[a.judge.kind] - JUDGE_RANK[b.judge.kind] || b.decidedAt.localeCompare(a.decidedAt) || b.id.localeCompare(a.id))[0];
}

export function outcomeOf(registry: Pick<Registry, "verdicts">, plate: Plate): Outcome {
  if (isNoDish(plate)) return "no-dish";
  return standingVerdict(registry.verdicts, plate)?.verdict === "failed" ? "failed-by-burooj" : "cooked";
}

/** "No Dish · Failed the required checks (render, contrast)". */
export function noDishLabel(plate: NoDish) {
  return `No Dish · ${CHEF_FAULT_LABELS[plate.fault.code] ?? plate.fault.code}${plate.fault.checks?.length ? ` (${plate.fault.checks.join(", ")})` : ""}`;
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
