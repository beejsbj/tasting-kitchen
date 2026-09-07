# Hem estimate extension

## Additions

- Added `logic.mjs` with the rate-backed `quote(lines, rates)` calculation. It preserves line order and duplicates, applies labour (1–16) and material (1–10) quantity limits, and returns integer-cent totals before tax.
- Added `source/estimate-view.mjs` using Hem's existing `el`, `button`, `ticket`, `facts`, and `field` primitives. Each job receives its own in-memory draft with add, quantity adjustment, removal, validation feedback, unit/extended costs, and a running total.
- Added local approval snapshots. Approval records the displayed lines and total in page memory; changing or removing a line clears the old approval, and "Revise estimate" returns the estimate to draft.
- Kept the supplied queue, job facts, material catalogue, primitive specimen, and job statuses unchanged. The estimate explicitly records that it makes no message, signature, charge, or job-status change.
- Added responsive estimate layout and draft/approved status tag surfaces. Reload/session-reset behavior is stated in the footer and estimate copy.

## Verification

- `node validation/validate-output.mjs` passed: 16 vectors, including duplicate lines, boundary quantities, invalid quantities, unknown kinds/IDs, and input non-mutation.
- Inspected the running local page at 360px and 1440px widths. Exercised queue/detail navigation, adding labour and material lines, totals, local approval, revision, invalid quantity feedback, per-job session retention, and unchanged job status.
- "Ready" remains the supplied job status vocabulary; it does not indicate a cooked or accepted estimate.
