# Hem estimate extension

## Additions

- Added `logic.mjs` with the immutable, rate-backed `quote(lines, rates)` calculation. It preserves line order and duplicates, applies the labour/material quantity limits, and returns integer-cent totals before tax.
- Added a composed estimate view using Hem's existing `el`, `button`, `ticket`, `facts`, and `field` primitives. Each queued job receives its own in-memory draft, with add, quantity adjustment, removal, validation feedback, total calculation, and visible unit/extended costs.
- Added local approval snapshots. An approval records the displayed lines and total in page memory; changing or removing a line clears the old approval, and a deliberate “Revise estimate” action returns the estimate to draft.
- Kept the supplied queue, job facts, material catalogue, primitive specimen, and job statuses unchanged. The estimate explicitly records that it makes no message, signature, charge, or job-status change.
- Added responsive estimate layout and draft/approved status surfaces for narrow and wide displays. Reload/session-reset behavior is stated in the footer and estimate copy.

## Verification

- `node validation/validate-output.mjs` passed: 16 vectors, including duplicate lines, boundary quantities, invalid quantities, unknown kinds/IDs, and input non-mutation.
- Inspected the running local page in system Chrome at 360px and 1440px widths. Exercised queue/detail navigation, adding labour and material lines, totals, local approval, revision, invalid quantity feedback, per-job session retention, and unchanged job status. No application console errors were observed; the temporary inspection server emitted only its missing-favicon 404.
- “Ready” remains the supplied job status vocabulary; it does not indicate a cooked or accepted estimate.
