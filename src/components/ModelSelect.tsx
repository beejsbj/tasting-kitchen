import type { Variant } from "../types";
import { variantBoundaryLabel, variantTasteLabel } from "../lib/variant-label";

export function ModelSelect({ label, variant, variants, compact = false, onChange }: { label: string; variant: Variant; variants: Variant[]; compact?: boolean; onChange: (id: string) => void }) {
  return <label className={`model-select ${compact ? "model-select--compact" : ""}`} title={variant.label}>
    <span className="sr-only">{label}</span>
    <select aria-label={label} value={variant.id} onChange={(event) => onChange(event.target.value)}>
      {variants.map((candidate) => <option value={candidate.id} key={candidate.id}>{variantTasteLabel(candidate)}</option>)}
    </select>
    <i>{variantBoundaryLabel(variant)}</i>
  </label>;
}
