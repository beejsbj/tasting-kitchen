import type { Recipe } from "../types";

const labels: Record<Recipe["origin"], string> = {
  textbook: "Textbook",
  mothers: "Mother’s recipe",
  hybrid: "Hybrid",
};

export function Badge({ origin }: { origin: Recipe["origin"] }) {
  return <span className={`badge badge--${origin}`}>{labels[origin]}</span>;
}
