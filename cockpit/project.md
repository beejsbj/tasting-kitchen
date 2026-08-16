# Tasting Kitchen

## Target outcome

A reusable, shareable system that lets Burooj build intuition about model fingerprints by running stable recipes, inspecting immutable dishes, comparing models and exact repeats, and gradually adding results as curiosity or need arises.

## Why this exists

Generic benchmarks do not answer relational questions such as which model makes the UI Burooj likes, understands his interaction instincts, responds well as a conversation partner, or behaves reliably as an agentic worker. Historical analysis supplies personal and unconventional recipe constraints; repeated comparable artifacts make the model's tendencies perceptible.

## Product boundary

- Recipes and their dishes are primary.
- Domains are browsing filters.
- Flights are reusable ordered recipe sets, not domains or one-time campaigns.
- The public gallery is read-only.
- The owner-only Cook control may start allowlisted background runs after its security model is accepted.
- No scores, leaderboard, automatic taste judge, or requirement to run every model at once.

## Canonical locations

- Repository: `/mnt/server-ssd/admin/home-data/Projects/tasting-kitchen`
- Planned production URL: `https://tasting-kitchen.burooj.dev/`
- Current proof URL: `https://artifacts.burooj.dev/model-tasting/`

## Good endpoint

A stranger can understand each recipe from the interface, filter by lineage and domain, and compare a recipe across models or same-model repeats. Burooj can privately Cook a recipe or flight and see accepted dishes join the public kitchen. The old proof deployment remains available until a deliberate verified cutover.

## Current state

The proof runner, 54-recipe catalog, 15 seed dishes, and React/Vite gallery are preserved on `main`. Product correction work is staged in `cockpit/issues/`. Linear project/issue creation is pending restoration of Cockpit's required app-actor authentication.
