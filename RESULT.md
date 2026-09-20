# Jev observations and rubric refinement result

State: complete and reviewable on `jev-observations-20260920`.

T3 thread: `01a0b8fb-4568-7ef1-8b87-a7aa4e911cb4` (a separate session identity was not exposed to the worker).

## Implemented

- Added catalog-owned, canonical-hash-pinned axis sets with explicit SemVer, active/candidate state, Recipe/Menu applicability, bounded evidence adapters, ordered levels, and no implicit default selection.
- Added append-only observations beside immutable Dishes. Every record pins the Dish hash, Recipe or Menu Revision context, exact rubric hash/version, source kind, evaluator/provider/model/tool identity, evidence references, per-axis selected level, full distribution, confidence, and token use where available.
- Added `taste axes`, `taste observations`, `taste observe`, and `taste compare-rubrics`. Observation execution is dry-run by default, requires an explicit rubric version, and requires `TASTE_ALLOW_JEV_RUNS=1` for a live call.
- Added public evidence adapters for conversation, journal, and agentic artifact shapes. Oversized state fails closed instead of being split invisibly.
- Published axis sets and visible-Dish observations through the registry without changing Dish identity, Repeat derivation, Menu coverage, or accepted artifacts.
- Added a gallery panel that lets a taster inspect/select exact rubric versions, distinguishes Human observation from Jev observation, shows distributions and evidence paths, and preserves human/Jev disagreements rather than resolving them.
- Added deterministic old/new rubric comparison with development/held-out separation, per-axis disagreement, consequential-error, review-burden, improvement, and regression reporting. Held-out label IDs are forbidden as revision evidence and promotion is always a separate human decision.

## Live smoke

One bounded request evaluated the existing public-safe accepted Dish `dish_respond-to-short-journal_codex-luna-xhigh_20260911040530539_3b35bd7b` against `short-journal-response@1.0.0`.

- Dish hash: `sha256:5c22dd468085268048c66c447e5accb44be20a7b3feaf913e8620524b299efd5`
- Recipe Revision: `sha256:955d233407ece303b97fc0e71b8ce9318079a1e382e06c0f8d74891a418fcb0b`
- Rubric hash: `sha256:2fdfcf2efe4f00763fb7a4c659fded692fbc24820f53bd310b0564f3d84a0e3f`
- Evaluator: OpenRouter, `typesafe/jev-1.13-20260917`, jevon `0.8.0`
- Request: three independent axes in one call; 1002 input tokens and 51 output tokens
- Receipt: `observations/observation_respond-to-short-journal_codex-luna-xhigh_20260911040530539_3b35bd7b_short-journal-response_20260920123203610_340ccfff79.json`

This is a Jev observation, not human taste and not evidence that the rubric matches Burooj.

## Rubric refinement receipt

`experiments/short-journal-groundedness-fixture/experiment.json` and `report.json` reproduce one old/new comparison. The four labels are prominently marked `synthetic-human-fixture`: two development and two held-out.

On the fixture held-out set, both versions have 0.8333 agreement. The candidate removes one consequential error and lowers review burden from 0.1667 to 0, but introduces one groundedness regression. Report hash: `sha256:02e1c42204a3b9b41be80a688a6e574b90b2bf664c7af651b9439e179080452a`.

The report status is `fixture-only-human-evidence-required`, records zero genuine human tastings, and sets automatic promotion to false.

## Verification

- `npm test` — passed: catalog validation, 91 Kitchen tests, 66 Recipe tests, typecheck, production build, and 24 gallery tests.
- `npm run lint` — passed.
- `npm run test:browser` against a local Vite preview — passed, including observation-panel checks at 1280 px and 390 px.
- Live `taste observe ... --execute` — passed and wrote the receipt above.
- Recipe-context and Menu-context dry runs — passed.
- T3 collaborative preview was unavailable in this environment; the repository's Playwright browser verifier supplied browser evidence instead.

The ignored `private/provenance` prerequisite was copied locally from the canonical checkout solely for full validation and was not staged or published.

## Commits

- `c290db5` — Add immutable Jev taste observations
- `3257e5c` — Add honest rubric refinement replay
- `75a5b84` — Show human and Jev observations separately
- `be71e37` — Record bounded public Dish Jev smoke

## Required human handoff

The system capability and fixture replay are complete, but empirical rubric refinement is not. Collect a small genuine human-labeled set with provenance, keep development and held-out partitions fixed, rerun both rubric versions on the same immutable Dishes, and review the held-out regression and consequential-error table before choosing whether to promote `1.1.0`. No code path promotes it automatically.
