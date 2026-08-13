# Model Tasting Kitchen — execution plan

## The project

Analyze Burooj's history once, turn the strongest findings into reusable model-tasting flights, and build a small kitchen where those flights can be run later as curiosity and need arise.

This project assembles the flights and the kitchen. It performs no tastings.

## Shared language

- **Flight:** a themed tasting session, such as UI/UX ideation, journaling, or agentic development.
- **Dish:** one representative encounter inside a flight.
- **Turn:** a staged prompt, correction, or follow-up inside a dish.
- **Observation lens:** something worth noticing in a response, never a score or preferred answer.

## Exact endpoint

The project is finished when it has:

- one bounded historical analysis, with a fixed source cutoff and no continuing ingestion;
- a private, gitignored evidence ledger plus sanitized committed findings;
- exactly nine flights containing 27 dishes total;
- a stable, validated, sanitized flight schema and static library;
- a working root Sites app that loads the library generically;
- manual prompt copying and response pasting, free-form notes, browser-local records, two-run comparison, and JSON export/import with legacy v1 tasting records still readable;
- concise usage, provenance/privacy, and future-calibration documentation;
- passing privacy checks, tests, and production build;
- no actual model responses, tastings, rankings, or inferred preference profile.

The investigator determines the nine flight families from evidence. Workers must not pad weak categories to satisfy symmetry.

## Lane 1 — one-time historical investigation

Owner: investigator, GPT-5.6 Sol with high reasoning.

### Method

Inventory available sources read-only, then sample by signal rather than attempting exhaustive consumption. Prioritize:

1. actual AI chats and agentic sessions;
2. correction, rejection, redirection, clarification, and takeover turns;
3. development projects and UI/UX work;
4. outputs Burooj accepted or continued using;
5. personal-assistant, ideation, writing, and journaling exchanges;
6. visual references only where they explain a repeated preference.

For each useful episode, capture the intent, the model's move, Burooj's reaction, the revised direction, eventual disposition, and the future tasting encounter it might support. Grade findings as recurring evidence, plausible hypothesis, or one-off.

### Privacy

- Analyze source material in place and read-only.
- Never copy raw journals, chats, repositories, credentials, full transcripts, or third-party private material into Git or the site.
- Keep precise source locations and any sensitive excerpts only in `private/`, which is gitignored.
- Commit only paraphrased, sanitized findings and structurally equivalent scenarios.
- Fix an analysis cutoff date. Create no watchers, scheduled jobs, or ongoing index.

### Deliverables

- `analysis/method.md`
- `analysis/source-summary.md`
- `analysis/palate-findings.md`
- `analysis/recurring-disconnects.md`
- `analysis/flight-candidates.md`
- `private/source-inventory.json`
- `private/evidence-ledger.jsonl`

### Stop condition

Stop after every major evidenced use area has been sampled and two additional varied sample batches yield no important new category. Coverage percentage alone is not a reason to continue.

## Lane 2 — menu and flight construction

Owner: menu worker.

Begin after the investigator's findings, disconnects, and candidates stabilize.

A good flight is genuinely related to Burooj's use, historically grounded, context-equivalent across models, open enough to reveal a model's natural tendencies, compound rather than atomized, non-leading, sanitized, and independently runnable. It says what to notice without supplying a numerical score. Taste alone must not stand in for correctness; any safety- or competence-sensitive dish needs an external check.

Scheduler, worker, permission, memory, and delivery scenarios are controlled manual role-play. They compare reasoning over the same supplied state; they do not prove that a raw model can operate tools. Visual and development fixtures may be opened or handed to an external harness, while the kitchen itself remains a notebook rather than an execution engine.

### Deliverables

- `library/flight.schema.json`
- `library/menu.json`
- `library/flights/<flight-id>.json`
- safe supporting assets only where a dish truly needs them
- exactly nine flights and 27 dishes total
- ordinary representative encounters as well as historically discriminating ones

First freeze the schema and produce two representative fixture flights. Hand those to the website worker, then complete the remaining library in parallel with website construction.

## Lane 3 — tasting-kitchen website

Owner: website worker using the root Sites app.

Begin only after the real schema and two representative fixtures exist. The website worker must not invent analysis conclusions or final flight content.

The lean workflow is:

> Choose flight → choose dish → label model/configuration → step through and copy prompts → paste responses → leave free-form notes/corrections → save locally → open a second run beside it → export/import records.

Keep family filtering, staged prompts, model labels, one free-form note per turn, one overall reflection, browser-local persistence, two-run comparison, and JSON export/import. Omit model APIs, accounts, backend, database, rankings, dashboards, reaction taxonomies, and automatic preference extraction.

The site must be responsive, keyboard-usable, and comfortable with long prompts and responses. New schema-valid flights must appear without bespoke interface work.

## Lane 4 — integration

Owner: primary agent after both workers finish.

- Load the complete real library in place of fixtures.
- Validate all flights and referenced assets.
- Scan Git and the production bundle for secrets, private paths, raw transcripts, and sensitive excerpts.
- Exercise the empty-kitchen workflow without calling a model.
- Verify persistence, two-run comparison, JSON export/import round trips, long content, tests, and production build.
- Document how to add a flight and conduct a future tasting.
- Record future calibration as a possibility only; implement none of it.
- Finish with a clean Git history, then stop.

## Explicitly outside this project

- actual tastings or model outputs;
- model rankings, scores, leaderboards, or claims about a model's true nature;
- a mature Burooj-preferences skill or automatic palate inference;
- continuous session ingestion, background monitoring, or scheduled analysis;
- model-provider integrations or a prompt execution engine;
- database, authentication, multi-user features, public gallery, or social system;
- an elaborate capability ontology;
- day-trading simulation unless it emerges as one evidence-supported, clearly experimental dish with external correctness checks.

## Source plans

This is the reconciled plan produced by cross-reviewing [Sol's independent draft](docs/plans/sol-draft.md) and [K3's independent draft](docs/plans/k3-draft.md).
