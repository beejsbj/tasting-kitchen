# Harbor repair network — source brief

## Actors

- **Residents** submit repair observations with a location and photo.
- **Triage desk** checks duplicates and routes valid observations.
- **Field crews** accept work, post progress, and close repairs.
- **Neighborhood stewards** add local context but cannot assign crews.
- **Public record** shows accepted observations, current status, and closure evidence.

## Flows

1. A resident sends an observation to the triage desk.
2. The triage desk either links it to an existing observation or accepts it into the public record.
3. Accepted work is offered to a field crew.
4. A field crew posts progress and closure evidence to the public record.
5. Residents can add follow-up evidence after closure; this returns to triage rather than directly reopening the crew's work.
6. Neighborhood stewards can add context to an observation at any time, but their context is visibly distinct from status.

## Communication problem

The city currently explains this as a long numbered process. Readers miss two things: the public record persists across the whole lifecycle, and post-closure feedback loops back through triage rather than directly to crews.
