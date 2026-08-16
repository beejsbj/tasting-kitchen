# Make the gallery recipe-first

Status: Ready for agent

Labels: `executor:codex`, `site:bjslab`

## Goal

Make recipes and their dishes the main navigation objects while keeping domains as useful secondary filters.

## Context

The current gallery filters by domain and makes several briefs hard to understand without opening fixtures. Lineage exists in data but is not a first-class filter with explanations.

## Done when

- visitors can browse/search recipes first and filter by domain and Textbook/Mother's/Hybrid lineage;
- lineage filters include plain explanations;
- the recipe view presents the complete brief, visible inputs/fixtures, deliverable, held constants, tools, and expected artifact;
- all available dishes and honest not-yet-tasted states are reachable from the recipe;
- URL state supports linking to a recipe and active filters;
- artifact comparison remains visually dominant;
- accessibility, responsive behavior, typecheck, build, and tests pass.

## Constraints

- Depend on the proof-slice authoring contract; coordinate with the full catalog migration.
- Keep React/Vite; this issue does not add a backend.
