# Promotion roadmap

The project is promoted in layers. Recipe and comparison semantics come before the private runner UI; otherwise the new control would merely automate the wrong menu.

## Phase 1 — correct the product model

1. Freeze the vocabulary, recipe schema, comparison invariants, and versioning rules.
2. Create the recipe authoring standard and migrate a three-lineage proof slice.
3. Audit and rewrite the catalog in parallel domain groups so one investigator cannot skim it.

Exit: a stranger can identify what a recipe asks for, why its lineage is assigned, what artifact it produces, and what is held constant without opening JSON or fixture paths.

## Phase 2 — make tasting work

4. Make the gallery recipe-first; domains become secondary filters.
5. Add lineage filters with plain explanations.
6. Add cross-model and same-model repeat comparison.
7. Redesign the interface as a working test kitchen using a dedicated Design Lab pass after the information architecture stabilizes.

Exit: the gallery reveals both between-model fingerprint and within-model variance while keeping the artifact dominant.

## Phase 3 — make cooking convenient

8. Extract a harness-adapter seam from the Codex-only runner.
9. Design the authenticated job lifecycle, cost/concurrency guards, durable storage, and failure recovery.
10. Connect the CLI library to an owner-only floating Cook control for recipe, flight, harness, model, effort, and repeat count.

Exit: Burooj can start a bounded background run and follow it to an immutable published dish without exposing credentials or model spend publicly.

## Phase 4 — canonical deployment

11. Make base URL and data roots configurable.
12. Containerize the gallery, control plane, and worker with persistent job/dish storage.
13. Deploy through Coolify at `tasting-kitchen.burooj.dev`, verify health and rollback, then deliberately decide the fate of the old `artifacts.burooj.dev/model-tasting/` route.

Exit: the canonical domain is healthy through Coolify, completed dishes survive redeploys, and the old route has an explicit redirect/archive/retirement decision.

## Explicitly deferred

- scores, leaderboards, or an overall model winner;
- public model-running access;
- automatic taste judgments;
- a full framework rewrite merely to add a backend;
- continuous personal-calibration machinery beyond the one-time source analysis.
