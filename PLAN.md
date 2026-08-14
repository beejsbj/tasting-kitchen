# Model Tasting Kitchen — artifact-gallery reset

## Product

Model Tasting Kitchen is a reusable set of standardized model recipes, an automated CLI runner, and a read-only gallery of the dishes models produce.

The product is inspired by Sitegeist's repeated same-brief comparison, generalized across Burooj's real AI use. It does not rank models. Repeated exposure to comparable artifacts is meant to build human intuition about a model's tendencies, strengths, and recurring fingerprints.

The previous manual copy/paste notebook was the wrong product. Its historical analysis, sanitized scenarios, fixtures, corrections, and checks remain source material; its browser-local notes workflow and ChatGPT Sites surface are legacy until migration is complete.

## Language

- **Domain:** a plain-language kind of work shown in gallery navigation.
- **Recipe:** one stable task package: prompt turns, fixtures, tool boundary, output contract, and checks.
- **Dish:** one immutable artifact produced by one exact model/harness/configuration running one recipe.
- **Collection:** dishes sharing the same observed model, harness, and normalized configuration. Collections are derived from dishes.
- **Flight:** an optional CLI batch of recipes. It is run bookkeeping, not gallery taxonomy.

Recipes have one lineage:

- **Textbook:** a recognizable domain task with a meaningful tension.
- **Mother's recipe:** a public-safe task distilled from Burooj's recurring work, corrections, or creative practice.
- **Hybrid:** a recognizable task carrying a history-derived constraint or interaction grammar.

A Mother's recipe preserves the original question or tension, never the original project's names, copy, palette, layout, brand, or recognizable implementation.

## Domains

1. UI & Visual Design
2. UX & Interaction
3. Conversation, Journaling & Companionship
4. Thinking, Brainstorming, Planning & Decisions
5. Writing & Creative Language
6. Editing, Transformation & Presentation
7. Agentic Work, Research & Personal Assistant
8. Coding & Engineering
9. Music & Creative Code

Each recipe has one primary domain. Cross-domain behavior uses controlled tags. Research with tools lives under Agentic; judgment over a supplied packet lives under Thinking; transforming supplied research into a memo or deck lives under Editing. Delegation and orchestration are sibling Agentic tags, not domains.

## Artifact kinds

Artifact kind selects validation and gallery rendering. It is never a second navigation hierarchy.

- `web` — runnable UI and interaction prototypes
- `image` — generated images, SVG, canvas, or drawing exports
- `code` — patches, source trees, and build/test receipts
- `session` — conversations and sanitized tool/assistant traces
- `document` — prose, edits, scripts, memos, and presentations
- `audio` — musical results with safe source attachments

The seed gallery polishes `web`, `image`, and `session`; the other three receive honest minimal renderers until real collections need more.

## Endpoint

The project is complete when it has:

- a validated public recipe menu across all nine domains, containing Textbook and Mother's recipes in every domain;
- a private provenance map tying Mother's recipes back to the one-time historical analysis;
- a `taste` CLI that validates recipes, runs an exact model configuration in a fresh isolated workspace/session, captures raw private evidence, sanitizes it, validates the artifact, and imports an immutable dish;
- exact collection identity including provider, requested and observed model, harness/version, reasoning effort, service tier, and recipe/config hashes;
- a static Sitegeist-like gallery that browses one collection, filters by domain, opens the real artifact, and compares up to three collections on the same recipe;
- honest `Not tasted yet` cells rather than placeholders;
- no scores, leaderboards, LLM judges, automated taste claims, accounts, database, or browser authoring workflow;
- a static build at `/model-tasting/` deployed through a separate read-only bjslab service at `https://artifacts.burooj.dev/model-tasting/`;
- the old Sites/Vinext/localStorage application removed only after its recipe content and fixtures have migrated and the bjslab replacement passes verification.

## Seed collections

All seed results use the Codex CLI harness and are labeled accordingly:

- Sol — `gpt-5.6-sol`, high reasoning, standard tier
- Terra — `gpt-5.6-terra`, high reasoning, standard tier
- Luna — `gpt-5.6-luna`, low reasoning, Fast tier
- Luna — `gpt-5.6-luna`, high reasoning, Fast tier
- Luna — `gpt-5.6-luna`, extra-high (`xhigh`) reasoning, Fast tier

Fast is a service tier, not a separate Luna model. Luna does not expose `none`; `low` is the requested no-/low-thinking approximation.

The first proof flight is deliberately small: three recipes across all five seed variants, producing 15 dishes.

- `responsive-product-launch` — a Textbook visual baseline
- `shared-result-ritual` — a Mother's visual fingerprint recipe
- `permission-ladder-publish` — a Mother's multi-turn shell/tool recipe

A clean private `CODEX_HOME` and a fresh constrained workspace per recipe are hard requirements so personal rules, skills, history, and other dishes do not leak into a run. A recipe runs only when its required capabilities are a subset of the selected variant's declared capabilities; unsupported combinations remain visible and are never mislabeled as failures.

## Stages and gates

### 1. Menu contract

- Freeze the nine domains, controlled tags, lineage language, recipe schema, dish schema, and exact seed variants.
- Re-home every old recipe as migrate, rewrite/split, hidden control, or retire.
- Validate public/private boundaries.

**K3 Gate 2:** audit taxonomy, schema leanness, migration, and missing coverage before public authoring.

### 2. Full recipe menu

- Author visual/interaction/music recipes.
- Author conversation/thinking/writing/editing recipes.
- Author agentic/research/coding recipes.
- Include both Textbook controls and Mother's recipes derived from Lottery, Emotitone, Day Shaper, Experience Alcohol, Strudel work, correction patterns, and other supported evidence.
- Treat Koala as a newly supplied curated reference, not retroactive historical evidence.

**K3 Gate 3:** audit coverage, generic-sludge risk, stranger test, tag hygiene, and executable contracts.

**Gate result:** passed. The v1 menu freezes at 51 recipes: 47 ready, three hidden controls, and one intentionally deferred image-generation draft. Subjective and trace-reading cues are non-gating; public acceptance depends only on deterministic checks and runner-generic artifact completeness.

### 3. CLI and runner

- Implement validation, planning, isolated execution, multi-turn resume, capture, sanitization, checks, import, and registry build.
- Prove exact routing and isolation with one canary per seed configuration before any batch.
- Keep failed attempts private and visible; never silently overwrite a dish.

**K3 Gate 4:** inspect canary manifests, isolation evidence, traces, and output contracts before scaling.

### 4. Static gallery

- Replace Sites/Vinext with plain React/Vite at base `/model-tasting/`.
- Render collections, nine domains, lineage badges, recipe details, exact run identity, real artifacts, and same-recipe comparisons.
- Sandbox runnable outputs and block artifact network access by default.

**K3 Gate 5:** audit gallery fidelity to the product and verify that the evidence—not chrome or scores—dominates.

### 5. Seed generation and publication

- Run Sol, Terra, and three Luna Fast reasoning variants through the seed recipes.
- Validate every dish and publish only sanitized accepted artifacts.
- Build the static tree, deploy atomically to bjslab, verify existing artifact routes remain healthy, and retain a rollback release.
- Soft-retire the owner-only ChatGPT Sites project after the replacement is live; full deletion requires the Sites management UI/support because no deletion connector is available.

**K3 Gate 6:** final audit of menu, collections, comparison fidelity, privacy, and visible fingerprints before handoff.

## Explicit non-goals

- universal capability ontology;
- equal recipe counts per domain;
- numerical taste scores or overall winners;
- pretending Codex-harness results are raw API-model results;
- running models inside the public website;
- operating on real bjslab state, credentials, email, calendar, or destructive targets during a tasting;
- completing every model/domain combination before publishing the reusable system.
