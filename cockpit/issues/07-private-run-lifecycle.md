# Design the authenticated background run lifecycle

Status: Grilling

Labels: `executor:codex`, `site:bjslab`

## Goal

Define the secure and durable job model for UI-triggered model runs before implementing a Cook endpoint.

## Context

The current CLI can use powerful local credentials and tool permissions. Exposing it as a public endpoint would expose model spend and potentially the host. The public gallery must remain read-only.

## Done when

- an architecture decision names owner authentication, CSRF protection, job states, cancellation, logs, retries, concurrency, rate/cost guards, and failure recovery;
- recipes, variants, tools, and repeat counts are server-side allowlisted;
- provider credentials exist only in the worker environment;
- accepted dishes and job manifests use persistent storage and survive redeploys;
- publication/rebuild behavior is atomic;
- the public/private network boundary and threat model are documented;
- Burooj resolves any security/cost choices that materially change operation.

## Constraints

- No implementation until the decision is accepted.
- Never expose a browser shell or arbitrary prompt execution surface.
- Default to one concurrent worker until evidence supports more.
