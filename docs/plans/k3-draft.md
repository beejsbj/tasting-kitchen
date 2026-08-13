# K3 independent draft

## Endpoint

Analyze Burooj's real history once, turn the findings into reusable model-tasting flights, and build a small static kitchen that can run those flights manually whenever curiosity or need arises. This project does not perform the tastings.

## Deliverables

- `analysis/`: source map, findings, and a private audit trail kept out of Git.
- `library/`: a stable flight schema, menu index, and sanitized flight files.
- The root Sites app: browse a menu, run staged prompts by copy/paste, retain free-form notes locally, and export them.
- Short usage and future-calibration notes.

## Work lanes

1. An investigator samples high-signal history, especially corrections, misunderstandings, accepted work, dev/UI work, assistant turns, writing, journaling, and ideation. It separates repeated evidence, plausible hypotheses, and one-offs.
2. A menu worker converts those findings into a lean set of real or structurally equivalent encounters. Each flight contains 3-7 dishes/turns as appropriate, mixes ordinary asks with ambiguity and recovery where useful, and tells Burooj what to notice without assigning scores.
3. A website worker builds a static, provider-independent kitchen around the frozen schema and fixtures. Records live in local storage and can be exported; no API keys, backend, accounts, or database.
4. An integrator validates schema, asset references, privacy, the full empty-kitchen workflow, tests, and production build.

## Suggested initial size

Six to ten strong flights, roughly 25-45 dishes total, with a hard cap. Prefer distinct, high-signal encounters over category quotas.

## Minimal flight fields

- id, title, use-case family, and effort
- why the flight exists and sanitized provenance
- setup/assets
- one or more prompt turns, including optional corrections
- observation lenses (`watch_for`), never numerical scoring criteria
- repeat/variation guidance and status/version

## Privacy boundary

Raw chats, journals, repository content, precise private paths, secrets, and identifying third-party material do not enter Git or the web bundle. Committed analysis is paraphrased; derived flights are scrubbed and marked as derived.

## Kitchen boundary

The smallest useful loop is: choose flight, copy prompt, paste response, write a free-form napkin note, save locally, and export. Side-by-side comparison and import are optional only if cheap.

## Done

- One-time source map and findings with explicit coverage and uncertainty.
- Six to ten validated, independently runnable flights.
- The site loads any schema-valid flight without bespoke UI work.
- Copy/paste, local notes, and export work end to end.
- Privacy check, tests, production build, and concise docs pass.

## Explicit exclusions

No actual tastings, model calls, ranking, leaderboards, preference skill, ongoing ingestion, automatic calibration, provider orchestration, database, auth, or social platform.
