# Define the Tasting Kitchen vocabulary and schema contract

Status: Ready for agent

Labels: `executor:codex`, `site:bjslab`

## Goal

Make Recipe, Flight, Run, Dish, Repeat, Domain, Collection, and lineage unambiguous in documentation, schemas, CLI output, and gallery copy.

## Context

The proof system works, but its language still lets flights sound like domains and dishes sound like briefs. The canonical model is in `docs/product-model.md`. Recipes are the primary authored unit; domains are filters; a dish is the artifact from one run.

## Done when

- schema fields and TypeScript types map cleanly to the canonical vocabulary;
- flights pin recipe versions;
- dishes record run group and repetition index without weakening immutable identity;
- comparison invariants distinguish cross-model, repeat, and cross-harness views;
- README, CLI help, gallery labels, and docs use the same terms;
- existing seed dishes migrate without losing hashes or provenance;
- validation, typecheck, build, and tests pass.

## Constraints

- Do not choose a server framework or database here.
- Preserve accepted dish immutability.
- Keep the public label `Mother's` with a plain explanation; an internal `personal` enum is acceptable.
- Repository: `/mnt/server-ssd/admin/home-data/Projects/tasting-kitchen`.
