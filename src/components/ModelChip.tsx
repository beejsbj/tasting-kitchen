import type { Variant } from "../types";
import { variantBoundaryLabel, variantTasteLabel } from "../lib/variant-label";

export function ModelChip({ variant, active = false, onClick }: { variant: Variant; active?: boolean; onClick?: () => void }) {
  const content = <><span>{variantTasteLabel(variant)}</span><i>{variantBoundaryLabel(variant)}</i></>;
  if (onClick) return <button className="model-chip" title={variant.label} aria-pressed={active} onClick={onClick}>{content}</button>;
  return <span className="model-chip" title={variant.label} data-active={active || undefined}>{content}</span>;
}
