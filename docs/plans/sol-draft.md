# Sol independent draft

> Superseded planning record. The current CLI-and-gallery architecture replaces this manual copy/paste proposal; the document remains only as design history.

## Endpoint

Analyze Burooj's history once, turn the strongest findings into a reusable menu of model flights, and build a kitchen where those flights can be run later as curiosity and need arise. No chefs cook during this project.

## Investigator lane

Inventory sources read-only, then sample by signal rather than exhaustively: AI conversations and agentic sessions; correction, rejection, redirection, and takeover turns; dev and UI/UX work; accepted outputs; assistant, ideation, writing, and journaling exchanges; and visual references only when they explain a recurring preference.

For each useful episode, capture the intent, model move, Burooj's reaction, revised direction, eventual disposition, and the kind of tasting encounter it could inspire. Distinguish recurring evidence from hypotheses and one-offs. Stop after each major evidenced use area has been sampled and two varied additional batches produce no important new category.

Keep precise locations and sensitive excerpts in a gitignored private evidence ledger. Commit only sanitized summaries and findings. Establish a fixed cutoff date; create no watcher or ongoing index.

Deliverables: method, source summary, concise palate findings, recurring disconnects, flight candidates, gaps/uncertainties, and a private auditable ledger.

## Menu lane

A good flight is real to Burooj, historically grounded, context-equivalent across models, open enough to reveal natural tendencies, compound rather than atomized, non-leading, independently runnable, and descriptive rather than scored. It may include staged correction/recovery turns and external competence checks where taste alone is unsafe.

Each record should include identity/version, use-case family, rationale and evidence basis, sanitization note, setup/assets, initial prompt, optional staged turns, observation lenses, effort, repeat guidance, and external checks if applicable.

Target 10-14 strong flights, hard cap 16, following evidence rather than category quotas. Include ordinary representative use, historically discriminating encounters, and at least two recovery flights. Aspirational trading belongs only as a clearly experimental externally checkable flight.

## Kitchen lane

Build the existing root Sites app after the schema and two fixtures stabilize. It should browse/search/filter flights, explain provenance, step through prompts, copy them, accept manually pasted responses, capture immediate reactions/corrections/later reflections, persist records locally, compare saved runs, and export/import JSON.

The full empty-kitchen verification loop is: choose flight, copy prompt, paste response, add correction/reaction, add another model run, compare, leave, return, export, and re-import. No live model must participate.

No model APIs, backend, auth, accounts, ingestion service, or database. Replace the starter surface and metadata completely; keep it responsive, keyboard-usable, and legible for long text.

## Integration and done

- Investigator owns `analysis/` and the private ledger, not app code or flights.
- Menu worker owns `library/`, not raw sources or app behavior.
- Website worker owns app/UI tests, not analysis conclusions or final flight content.
- Integrator handles only cross-boundary fixes, validation, docs, and verification.

Validate every flight and asset; scan Git and the bundle for private paths, secrets, transcripts, or excerpts; test long content, persistence, and JSON round trips; run tests and production build; document adding/running a flight; finish with clean Git history.

The project is done with a bounded one-time analysis, private audit trail, reusable initial menu and schema, working kitchen using the real menu, local/exportable tasting records, usage docs, a future-calibration note that implements nothing, and clean tests/build/privacy checks.

## Explicit exclusions

No actual tastings, rankings, leaderboard, mature preferences skill, automatic palate inference, continuous ingestion, background monitoring, model APIs, prompt execution engine, multi-user/social features, elaborate capability ontology, or ungrounded claim to a model's true nature.
