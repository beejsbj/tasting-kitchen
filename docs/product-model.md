# Tasting Kitchen product model

Status: canonical product-language and schema contract, confirmed 2026-09-06.

This document defines the target model for Tasting Kitchen. It is the source of truth for product vocabulary, comparison claims, versioning, and public visibility. The current repository still contains legacy `domain`, `flight`, and `collection` concepts; those are implementation migration targets, not competing product language.

## Product claim

Tasting Kitchen gives requested model configurations the same Recipe—one prompt or prompt chain—and preserves their results for human inspection.

It helps a person develop an impression of recurring tendencies or “fingerprints.” It does not rank models or claim that observed differences were caused solely by the model.

## Model at a glance

```text
Cuisine classifies Recipes
Menu is a plain list of Recipes
Skill is an optional layer a Recipe can be cooked through
Cook(Menu, model configurations, skill layer)
  -> one Run per selected Recipe (at its current recipe hash) × requested configuration × skill layer
  -> each successful accepted Run produces one immutable Dish
Tasting presents matching Dishes through Recipe, Menu, Cuisine, and model views
```

## Canonical vocabulary

### Kitchen

The complete product: catalog, CLI orchestration, validation, immutable storage, gallery, and presentation runtimes.

Kitchen also supplies the modality-specific equipment needed to experience a Dish. The model composing Strudel supplies the composition material; Kitchen supplies the player. The model producing a web application supplies the artifact; Kitchen supplies the sandbox.

Kitchen is not a persisted entity.

### Cuisine

A controlled, multi-valued classification on a Recipe. It describes the capability or kind of work being explored and is used for filtering. A Recipe has one or more Cuisines and no primary Cuisine.

Cuisine replaces **Domain** as the canonical term. Cuisine is independent of output medium: a Music Composition Recipe might yield Strudel source, audio, prose, or a web instrument.

### Recipe and recipe hash

A **Recipe** is the editable authored unit: a prompt, brief, or prompt chain. It may also include supporting inputs, tool boundaries, validation requirements, and an output contract. It is the stable “kind” that gathers its Dishes across models, configurations, and Repeats.

The **recipe hash** identifies what a Recipe asked at one moment. It is computed from every execution-affecting contract and the bytes of its fixtures:

- the exact prompt or prompt chain;
- execution-affecting supporting inputs and constraints (fixtures enter by their content hash);
- tool boundaries;
- output and validation requirements;
- the Kitchen presentation profile; and
- semantic runtime requirements that can change the observable result.

Display metadata (title, summary, tags, lineage) does not move the hash. Any model-visible or execution-affecting edit does. There is no stored snapshot of a Recipe: a Dish records the hash it was cooked from as `recipe.hash`, and the current Recipe is simply whatever the catalog says now.

**A Dish shows what the model saw.** That claim is kept by the Dish, not by a store: at publication Kitchen copies the Recipe's public fixtures into the Dish directory (see Dish below). The prompts are already in the Dish's public trace.

**Brief changed since this Dish.** When `dish.recipe.hash` differs from the Recipe's current hash, the Dish stays under its Recipe but the gallery marks the card and the receipts with a plain “brief changed since this Dish”. The Dish is not hidden, rebound, or recomputed. Fill-missing coverage and Repeats count only Dishes whose hash matches the current one, so editing a brief makes its cells uncovered again.

If adaptation itself is being tasted, the same correction instruction is deliberately included in the Recipe's prompt chain, and so is part of the recipe hash.

### Menu

A **Menu** is an editable, deliberately selected list of Recipe identities used to explore one or more Cuisines. Most Menus focus on one Cuisine; cross-Cuisine and generalist Menus are allowed.

A Menu is a plain list, not a snapshot. It is a reusable comparison lens, not a result container or execution batch:

> For the current version of each of these Recipes, show all matching Dishes.

Coverage is measured against the current Menu list and each member's current recipe hash. It does not own Dishes. One Dish can appear through several Menus, and different models can fill a Menu at different times. Editing a member's brief or the Menu list changes what is covered; Dishes themselves never change.

### Cook

The action that requests execution. Cook is a verb, not a persisted entity and not a name for the model.

A Cook can target a Recipe or Menu and one or more requested model configurations. It fans out into one Run for every selected Recipe × requested configuration cell, at each Recipe's current recipe hash.

When covered cells are selected, intent must be explicit:

- **Fill missing** creates Runs only for uncovered cells.
- **Repeat** deliberately creates new Runs for covered cells.

The system must not silently choose between reuse and new execution.

### Run

One private operational attempt to execute one Recipe at its current recipe hash with one exact requested model configuration.

A Run may fail or be rejected without producing a public Dish. A successful, accepted Run produces exactly one Dish. Raw/private execution evidence remains outside the public artifact boundary.

Run is operational language, not a public gallery entity.

### Dish

One immutable accepted artifact and public-safe receipt produced by a successful Run. A Dish binds the exact:

- recipe hash (`recipe.hash`);
- requested and observed configuration identity, with the configuration hash (`identity.configHash`);
- skill layer, if any (`skill: { id, hash }`);
- artifact and its content hash;
- execution time; and
- validation receipt.

Accepted Dishes are never overwritten or rebound to a later brief. Reviews and observations attach beside a Dish; they do not mutate it.

Two sidecars sit beside `dish.json` and are **not** part of `dish.json` or `dishHash`, so a manifest stays byte-identical whether or not it has them:

- `inputs.json` and `inputs/` — what the model received. `inputs.json` lists each fixture's `path`, `sha256`, `bytes` and `mountAs`; `inputs/<mountAs>` holds the bytes of every public fixture. A private fixture appears in `inputs.json` by hash and size only, never as bytes.
- `receipt.json` — the full configuration object the Dish ran as and, for a skill layer, its source pin (repository, commit, path), entry, delivery mode, effective workspace mount path when applicable, and tree hash.

Both are written at publication. Dishes published earlier were backfilled once from the frozen records that preceded this model (`scripts/backfill-dish-sidecars.mjs`). The validator re-hashes every public input and checks that the receipt reproduces `identity.configHash`. A Dish with no sidecar still validates; the gallery then falls back to the Recipe's current fixtures and says so.

**Catalog changed.** When a Dish's configuration hash or skill hash is no longer in the catalog (a configuration was edited, a skill pin moved), the receipts say “catalog changed”. The Dish is neither hidden nor failed; its own `receipt.json` still says exactly what it ran as, and the gallery rebuilds the old configuration from it so the Dish stays selectable.

### Repeat

A derived relationship, not a separate entity. Dishes are Repeats when they share:

- the same recipe hash;
- the same exact requested model configuration; and
- the same skill layer, including the absence of one.

Repeat groups are ordered deterministically by execution time and then Dish ID. They require no stored `repeatIndex`, group identifier, or mutable counter.

### Tasting

The human activity and public surface for inspecting and comparing Dishes. Recipe, Menu, Cuisine, model, configuration, and Repeat views are all ways to taste.

Tasting is not a stored entity. A URL may preserve active filters without creating a Tasting record.

### Model and configuration

The thing being tasted is canonically a **model** or **model configuration**. “Chef” may appear in playful prose but is not a schema entity or substitute for Model.

The public model view is faceted rather than hierarchical. A visitor may start with all Luna Dishes, then filter by effort, harness, service tier, Cuisine, Recipe, Menu, or other dimensions.

The exact requested configuration remains part of Dish identity and Repeat grouping. It includes every requested dimension capable of changing the result, such as provider, model, harness, reasoning effort, service tier, and execution profile. Requested and observed identity are recorded separately, and drift is disclosed.

Multi-harness execution is post-v1. When it arrives, the same model used through two harnesses represents two configurations and does not form a Repeat.

### Skill and skill hash

A **Skill** is a pinned, public workflow source (a `SKILL.md` with its references, assets and scripts) that Kitchen can mount into a Run's workspace. It is guidance for the model, not the toolchain: engines, browsers, encoders and fonts are Kitchen-supplied and identical across layers. The catalog lists Skills in `catalog/skills.json` with their mounted files under `catalog/skills/<id>/files/`.

A Skill is delivered one of two ways. A **workspace** skill is mounted as files at the Recipe's mount path (default `skill/`), for tasks with a workspace. A **prompt** skill travels inside the first turn, preceded by one fixed sentence, so conversation and journal Recipes can wear it too; a soul is a prompt skill. Either way the Dish records the same `skill: { id, hash }`.

A Recipe declares which Skills it can be cooked through and where workspace skills mount (`skills: { mountAs?, optional, layers }`). The offered layers and optional flag are catalog metadata. Declaring layers at the default `skill/` mount on a cooked Recipe preserves its recipe hash. A non-default workspace mount path enters the recipe hash because changing that path changes the execution contract; this also marks unlayered Dishes of that Recipe as using an earlier brief. The brief is written skill-neutral: it says what to do if a skill is mounted and what to do if not.

The **skill hash** identifies one layer: its source pin, normalized delivery mode, entry file and the hash of the exact source bytes. It is recorded on the Dish as `skill: { id, hash }`, with the source pin in `receipt.json`; the run fails if the model changes the mounted files. A Dish without `skill` was cooked **without skill**, which is a real layer and usually the most informative one. If the catalog's Skill later moves (a new pin or edited files) it gets a new hash; earlier Dishes keep theirs and show “catalog changed”.

Skill is a third comparison axis beside the recipe hash and configuration. Within one recipe hash, holding the model constant and changing the layer shows what the skill adds; holding the layer constant and changing the model shows the model. Kitchen never attributes a difference to the skill alone.

### Visibility

A Recipe is public by default. A Recipe with `visibility: "private"` may carry fixtures marked `public: false`, whose bytes live under the ignored `private/fixtures/<recipeId>/` tree and never enter the catalog or a Dish's `inputs/`; the recipe hash and `inputs.json` record only their hashes. Its Dishes are accepted, immutable and validated like public Dishes but are written to `private/dishes/` and never staged for the gallery. Private Recipes exist for material Burooj cares about that cannot be published, such as a copyrighted recording. A private Recipe can be cooked and compared locally; it cannot appear on the public counter.

## Recipe lineage

Every Recipe has one lineage:

- **Textbook** — a generic, recognizable baseline.
- **Mother's** — distilled from Burooj's real work, preferences, or unconventional practices.
- **Hybrid** — a recognizable baseline whose initial brief already contains known personal constraints.

A known personal preference compiled into the initial brief contributes to Mother's or Hybrid lineage. A later correction does not determine lineage.

Mother's Recipes preserve the recurring question or interaction grammar while replacing private names, copy, assets, and recognizable implementations.

## Output and presentation contract

Cuisine and output medium are independent axes:

- **Cuisine** says what capability the Recipe explores.
- **Output contract** says what the model must produce and how it is validated.
- **Presentation profile** says what Kitchen runtime is needed to experience it.

The model being tasted never has to build the player, viewer, or sandbox unless building that interface is itself the Recipe.

A Recipe cannot become Ready until Kitchen has both a validator and a safe presentation runtime for its output contract. A Recipe awaiting Kitchen infrastructure remains private and not cookable.

Semantic runtimes that can alter the observable result are pinned by the recipe hash and recorded with the accepted Dish. Kitchen must retain compatible playback for old Dishes. A Strudel engine change that could alter playback changes the recipe hash; changing player layout, controls, or styling does not.

“Oven” and “Appliance” are useful metaphors for this Kitchen infrastructure, not canonical entities. The implementation units are presentation runtimes or renderers.

## Public information architecture and visibility

The site is the Tasting surface; the CLI is the v1 cooking surface.

The public site supports:

- a Dishes counter that groups every visible Dish and Repeat beneath its Recipe, with model/thinking filters;
- a separate Recipe Book at `?view=recipes` for current authored definitions;
- Recipe detail pages containing all matching models, configurations, and Repeats;
- model and configuration facets on the Dishes counter;
- Cuisine filtering; and
- Menu views with explicit coverage.

The public Book contains active Recipes, including uncooked Recipes when they exist. The current inventory is recorded in [visual-recipes.md](visual-recipes.md): four fresh visual candidates, three supplied design-system extensions, and three conventional website baselines. Each of the ten active Recipes now has one accepted `codex-luna-xhigh` Dish requested at the default service tier. Hidden Recipes and their accepted Dishes remain recoverable in the catalog archive and outside the public Book. The historical `visual-ui` menu is deferred; `fresh-visual-ui`, `design-system-extensions`, and `standard-web` contain the active cooked candidates.

The Dishes counter shows each Dish separately, grouped under its Recipe, with a plain “brief changed since this Dish” mark when the Recipe was edited after it was cooked; a Repeat is a separate visible Dish, never a model or effort tab hidden inside a card. The Recipe Book shows the current authored definition and permits editing its title, summary, setup instructions, prompt turns, and public text fixtures. A Recipe Book edit never changes an existing Dish; execution-affecting edits bump the Recipe patch version for a future Cook.

Local development exposes `GET /api/recipes` and optimistic `PATCH /api/recipes/:id` with an `expectedHash`; saves replace the recipe source and edited public fixtures coherently. Production serves the active public source text from `public/data/recipe-book.json`; its static sidecar is read-only, while the separate hosted GitHub flow can save current definitions.

A Menu appears publicly only when every Recipe on it is on the public counter (has at least one accepted Dish somewhere). It need not have complete coverage from any single model or configuration.

The owner-only Cook button remains outside the public site. Recipe editing is available through the Book; hosted repository saves require an owner-supplied GitHub fine-grained token with repository Contents read/write access. The token is held in browser memory and sent only to `api.github.com`; saves make one atomic commit to the configured branch with conflict protection. No model cook is started by a save.

## Coverage and comparison claims

Coverage is always measured against the complete current Menu list, at each member's current recipe hash, for the active model/configuration filters. The gallery never silently shrinks a Menu to the intersection of available results.

Examples for a 12-Recipe Menu:

- `Luna · all efforts · all harnesses — 12/12 represented`
- `Sol · high · Codex — 9/12 represented`

Missing cells remain visible, and populated cells may contain several Repeats.

Family-level `12/12` means complete family coverage. It does not mean configuration was held constant.

A like-for-like comparison requires:

- the same recipe hash, or the same Menu list with every member at its current recipe hash;
- full coverage for every compared selection;
- the same intended non-model configuration dimensions, such as harness, effort, and tier; and
- disclosure of requested-versus-observed drift.

Only the model differs deliberately. Observed drift weakens the corresponding held-constant claim.

Dishes cooked from different recipe hashes may be browsed together, but they are never presented as the same-Recipe or same-Menu comparison.

## Scenario checks

### The same Recipe across several models

Each requested configuration receives the same brief (one recipe hash). Each successful Run yields a Dish. The Recipe detail page presents the Dishes together.

### The same configuration repeats a Recipe

An explicit Repeat-intent Cook creates another Run. Its Dish joins the Repeat group derived from recipe hash plus exact requested configuration and skill layer.

### One model through different harnesses

The Dishes share a model family but not an exact configuration. They can be browsed together or filtered by harness, but they are not Repeats. Multi-harness execution remains post-v1.

### A Recipe in several Menus

Each Menu lists the Recipes it needs. One matching Dish can satisfy every such Menu lens; it is not duplicated or owned by any Menu.

### A Recipe revised after Dishes exist

Old Dishes keep the old recipe hash and are marked “brief changed since this Dish”; their `inputs/` still show what they received. A new Cook uses the new hash and starts new Repeat groups. The two may be viewed together, but not as a like-for-like comparison.

### A cross-Cuisine task

The Recipe carries multiple Cuisine values. Cuisine remains filtering metadata; it does not dictate output format or Kitchen presentation.

### A known preference in the initial brief

The preference is part of the brief sent identically to every requested configuration. Its lineage is Mother's or Hybrid depending on whether the Recipe is personal in origin or a personalized baseline.

### The same Recipe through skill layers

The same recipe hash and configuration are cooked once without a skill and once per offered layer. Each cell is its own Repeat group. The Recipe page lets a viewer hold the model and switch layers, or hold the layer and switch models. A cell with no Dish stays visibly empty.

### A correction turn retained to taste adaptation

The correction instruction is part of the Recipe's prompt chain and is held constant across requested configurations. Each model's preceding response naturally differs; adaptation to the same correction is the behavior being tasted.

## Retired and non-canonical language

- **Domain** — replaced by Cuisine.
- **Flight** — retired; it ambiguously meant a Recipe set, execution batch, or displayed sample set.
- **Collection** — retired; model and configuration are ordinary filter facets over Dishes.
- **Chef** — informal prose only.
- **Oven / Appliance** — infrastructure metaphors only.

## V1 boundary

V1 is about:

- the product language and schema contract;
- Recipes and authoring;
- Menus and comparison scope;
- the public gallery and comparison experience;
- visual design; and
- deployment.

The owner-only Cook button and multi-harness execution are post-v1.

Sitegeist is inspiration for repeated same-brief comparison across a deliberately varied set. It is not a visual identity to copy.
