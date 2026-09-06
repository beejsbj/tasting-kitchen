# Tasting Kitchen product model

Status: canonical product-language and schema contract, confirmed 2026-09-06.

This document defines the target model for Tasting Kitchen. It is the source of truth for product vocabulary, comparison claims, versioning, and public visibility. The current repository still contains legacy `domain`, `flight`, and `collection` concepts; those are implementation migration targets, not competing product language.

## Product claim

Tasting Kitchen gives requested model configurations the same Recipe—one prompt or prompt chain—and preserves their results for human inspection.

It helps a person develop an impression of recurring tendencies or “fingerprints.” It does not rank models or claim that observed differences were caused solely by the model.

## Model at a glance

```text
Cuisine classifies Recipes
Menu selects Recipe identities
Cook(Menu, model configurations)
  -> Menu Revision pins exact Recipe Revisions
  -> one Run per selected Recipe Revision × requested configuration
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

### Recipe and Recipe Revision

A **Recipe** is the editable authored unit: a prompt, brief, or prompt chain. It may also include supporting inputs, tool boundaries, validation requirements, and an output contract. It is the stable “kind” that gathers its Dishes across models, configurations, and Repeats.

A **Recipe Revision** is an immutable executed state of a Recipe. It freezes everything the model saw and every execution-affecting contract, including:

- the exact prompt or prompt chain;
- execution-affecting supporting inputs and constraints;
- tool boundaries;
- output and validation requirements;
- the Kitchen presentation profile; and
- semantic runtime requirements that can change the observable result.

Only executed states require preservation. Ordinary draft edits have no revision history. A model-visible or execution-affecting change produces a new Recipe Revision on the next Cook. Display metadata may evolve without creating a new executed revision.

If adaptation itself is being tasted, the same correction instruction is deliberately included in the Recipe's prompt chain. That correction is part of an executed Recipe Revision. Untasted draft corrections carry no history.

### Menu and Menu Revision

A **Menu** is an editable, deliberately selected set of Recipe identities used to explore one or more Cuisines. Most Menus focus on one Cuisine; cross-Cuisine and generalist Menus are allowed.

A **Menu Revision** is an immutable executed Menu snapshot. It pins:

- the selected Recipe identities; and
- the exact Recipe Revision for every member.

Only executed Menu Revisions are preserved. Draft Menu edits have no revision history.

A Menu Revision is a reusable comparison contract, not a result container or execution batch:

> For these exact Recipe Revisions, show all matching Dishes.

It does not own Dishes. An existing matching Dish can satisfy a later Menu Revision, one Dish can appear through several Menus, and different models can fill a Menu at different times.

### Cook

The action that requests execution. Cook is a verb, not a persisted entity and not a name for the model.

A Cook can target a Recipe or Menu and one or more requested model configurations. It fans out into one Run for every selected Recipe Revision × requested configuration cell.

When covered cells are selected, intent must be explicit:

- **Fill missing** creates Runs only for uncovered cells.
- **Repeat** deliberately creates new Runs for covered cells.

The system must not silently choose between reuse and new execution.

### Run

One private operational attempt to execute one Recipe Revision with one exact requested model configuration.

A Run may fail or be rejected without producing a public Dish. A successful, accepted Run produces exactly one Dish. Raw/private execution evidence remains outside the public artifact boundary.

Run is operational language, not a public gallery entity.

### Dish

One immutable accepted artifact and public-safe receipt produced by a successful Run. A Dish binds the exact:

- Recipe Revision;
- requested and observed configuration identity;
- artifact and its content hash;
- execution time; and
- validation receipt.

Accepted Dishes are never overwritten or rebound to later Recipe Revisions. Reviews and observations attach beside a Dish; they do not mutate it.

### Repeat

A derived relationship, not a separate entity. Dishes are Repeats when they share:

- the same Recipe Revision; and
- the same exact requested model configuration.

Repeat groups are ordered deterministically by execution time and then Dish ID. They require no stored `repeatIndex`, group identifier, or mutable counter.

### Tasting

The human activity and public surface for inspecting and comparing Dishes. Recipe, Menu, Cuisine, model, configuration, and Repeat views are all ways to taste.

Tasting is not a stored entity. A URL may preserve active filters without creating a Tasting record.

### Model and configuration

The thing being tasted is canonically a **model** or **model configuration**. “Chef” may appear in playful prose but is not a schema entity or substitute for Model.

The public model view is faceted rather than hierarchical. A visitor may start with all Luna Dishes, then filter by effort, harness, service tier, Cuisine, Recipe, Menu, or other dimensions.

The exact requested configuration remains part of Dish identity and Repeat grouping. It includes every requested dimension capable of changing the result, such as provider, model, harness, reasoning effort, service tier, and execution profile. Requested and observed identity are recorded separately, and drift is disclosed.

Multi-harness execution is post-v1. When it arrives, the same model used through two harnesses represents two configurations and does not form a Repeat.

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

Semantic runtimes that can alter the observable result are pinned by the Recipe Revision and recorded with the accepted Dish. Kitchen must retain compatible playback for old Dishes. A Strudel engine change that could alter playback creates a new Recipe Revision; changing player layout, controls, or styling does not.

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

The public Book contains active Recipes, including uncooked Recipes. The current inventory is recorded in [visual-recipes.md](visual-recipes.md): four fresh visual candidates, three supplied design-system extensions, and three conventional website baselines. All ten active Recipes are uncooked. Hidden Recipes, their historical revisions, and their accepted Dishes remain recoverable in the catalog archive and outside the public Book. The historical `visual-ui` menu is deferred; `fresh-visual-ui` and `standard-web` contain the new candidates.

The Dishes counter shows each Dish separately, grouped under its frozen executed Recipe Revision; a Repeat is a separate visible Dish, never a model or effort tab hidden inside a card. The Recipe Book shows the current authored definition and permits editing its title, summary, setup instructions, prompt turns, and public text fixtures. A Recipe Book edit never changes an existing Dish; execution-affecting edits bump the Recipe patch version for a future Cook.

Local development exposes `GET /api/recipes` and optimistic `PATCH /api/recipes/:id` with an `expectedHash`; saves replace the recipe source and edited public fixtures coherently. Production serves the active public source text from `public/data/recipe-book.json`; its static sidecar is read-only, while the separate hosted GitHub flow can save current definitions.

A Menu Revision appears publicly only when every pinned Recipe Revision has at least one accepted Dish somewhere. It need not have complete coverage from any single model or configuration.

The owner-only Cook button remains outside the public site. Recipe editing is available through the Book; hosted repository saves require an owner-supplied GitHub fine-grained token with repository Contents read/write access. The token is held in browser memory and sent only to `api.github.com`; saves make one atomic commit to the configured branch with conflict protection. No model cook is started by a save.

## Coverage and comparison claims

Coverage is always measured against the complete pinned Menu Revision for the active model/configuration filters. The gallery never silently shrinks a Menu to the intersection of available results.

Examples for a 12-Recipe Menu:

- `Luna · all efforts · all harnesses — 12/12 represented`
- `Sol · high · Codex — 9/12 represented`

Missing cells remain visible, and populated cells may contain several Repeats.

Family-level `12/12` means complete family coverage. It does not mean configuration was held constant.

A like-for-like comparison requires:

- the same Recipe Revision, or the same Menu Revision;
- full coverage for every compared selection;
- the same intended non-model configuration dimensions, such as harness, effort, and tier; and
- disclosure of requested-versus-observed drift.

Only the model differs deliberately. Observed drift weakens the corresponding held-constant claim.

Cross-revision results may be browsed, but they are never presented as the same-Recipe or same-Menu comparison.

## Scenario checks

### The same Recipe across several models

Each requested configuration receives the same Recipe Revision. Each successful Run yields a Dish. The Recipe detail page presents the Dishes together.

### The same configuration repeats a Recipe

An explicit Repeat-intent Cook creates another Run. Its Dish joins the Repeat group derived from Recipe Revision plus exact requested configuration.

### One model through different harnesses

The Dishes share a model family but not an exact configuration. They can be browsed together or filtered by harness, but they are not Repeats. Multi-harness execution remains post-v1.

### A Recipe in several Menus

Each Menu Revision pins the exact Recipe Revision it needs. One matching Dish can satisfy every such Menu lens; it is not duplicated or owned by any Menu.

### A Recipe revised after Dishes exist

Old Dishes remain bound to the old Recipe Revision. A new Cook uses the new Revision. The two may be viewed together only as an explicitly cross-revision comparison.

### A cross-Cuisine task

The Recipe carries multiple Cuisine values. Cuisine remains filtering metadata; it does not dictate output format or Kitchen presentation.

### A known preference in the initial brief

The preference is part of the Recipe Revision sent identically to every requested configuration. Its lineage is Mother's or Hybrid depending on whether the Recipe is personal in origin or a personalized baseline.

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
