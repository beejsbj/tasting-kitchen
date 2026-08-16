# Connect the runner to an owner-only Cook control

Status: Ready for agent

Labels: `executor:codex`, `site:bjslab`

## Goal

Let Burooj launch a recipe or flight from the gallery and follow the background run to an immutable dish.

## Context

The desired interaction is a floating Cook button with explicit harness, model, effort/service tier, and repeat count. The browser submits an allowlisted job; it never receives provider credentials or executes the harness itself.

## Done when

- an authenticated floating Cook control launches one recipe or flight;
- the selector shows harness, provider/model, effort, tier, tools/capabilities, and repeat count;
- the UI shows queued, running, awaiting-input, failed, cancelled, accepted, and published states as applicable;
- logs expose useful progress without private traces or secrets;
- completed accepted dishes automatically join the registry/gallery;
- duplicate submissions and unsafe values fail closed;
- end-to-end tests cover launch, progress, failure, cancellation, and publication.

## Constraints

- Depend on issues 05, 06, and the accepted issue 07 architecture.
- Public visitors cannot see or invoke the control.
