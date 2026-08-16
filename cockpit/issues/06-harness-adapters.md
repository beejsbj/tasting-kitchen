# Extract harness adapters from the CLI runner

Status: Ready for agent

Labels: `executor:codex`, `site:bjslab`

## Goal

Let the CLI and future web worker execute allowlisted model configurations through multiple harnesses without duplicating runner logic.

## Context

The current runner is robust but Codex-specific. Model, provider, harness, effort, service tier, capabilities, and observed identity already belong in dish provenance.

## Done when

- a documented adapter contract covers plan, execute/resume, verify identity, authentication preflight, and declared capabilities;
- the current Codex path is migrated behind the adapter without behavioral regression;
- variant configuration selects an allowlisted adapter and normalized configuration;
- unsupported capability combinations remain visible and do not run;
- CLI and library tests cover adapter selection, identity mismatch, recovery, and publication;
- no shell-string interpolation is introduced.

## Constraints

- Preserve fresh-session/workspace isolation and fail-closed identity verification.
- Adding every desired harness is not required; prove the seam with Codex plus one bounded second adapter or a faithful fake.
