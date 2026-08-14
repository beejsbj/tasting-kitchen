import type { Variant } from "../types";

export function variantTasteLabel(variant: Variant) {
  return variant.label.split(" · via ")[0];
}

export function variantBoundaryLabel(variant: Variant) {
  return variant.executionProfile.label.replace(/^via /, "");
}
