# Create the recipe authoring standard and migrate one proof slice

Status: Ready for agent

Labels: `executor:codex`, `site:bjslab`

## Goal

Prove a self-explanatory recipe format with one Textbook, one Mother's, and one Hybrid recipe before rewriting the full catalog.

## Context

Current recipes often lead with opaque fixture paths or turn historical preference discovery into correction turns. Known preferences should normally be present in the original brief. Fixture contents must be inspectable from the gallery.

## Done when

- a public authoring guide defines title, subtitle, task, inputs, initial constraints, deliverable, held constants, tools, checks, lineage rationale, and fixture presentation;
- three representative recipes use familiar task titles and complete briefs;
- known corrections are compiled into initial constraints;
- staged turns remain only where adaptation is the capability under test;
- all three recipes are understandable and runnable without reading repository JSON;
- gallery rendering for the proof slice shows supporting fixtures inline;
- tests pass.

## Constraints

- Depend on issue 01's vocabulary/schema decisions.
- Preserve private source provenance without exposing private history.
- Do not rewrite the rest of the catalog in this issue.
