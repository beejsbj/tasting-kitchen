# Add cross-model and same-model repeat comparison

Status: Ready for agent

Labels: `executor:codex`, `site:bjslab`

## Goal

Reveal both model fingerprint and within-model variance for the same stable recipe.

## Context

The runner already creates unique immutable dishes, but the gallery currently selects only the first matching recipe/variant dish. Later repeats therefore disappear from view.

## Done when

- the dish model records a stable run group and repetition index;
- the registry exposes all dishes for a recipe/configuration rather than the first match;
- a tasting can compare several models on one recipe;
- a tasting can compare several exact repeats from one model/configuration;
- configuration or harness differences are prominent enough to prevent false held-constant claims;
- legacy seed dishes receive an honest migration/default representation;
- immutable publication, registry, gallery, and comparison tests pass.

## Constraints

- Depend on issue 01.
- A repeat is a new immutable run, never an overwrite.
- Cross-harness comparison must be labeled exploratory.
