# Tasting Kitchen

A reusable system for learning model fingerprints through artifacts Burooj actually cares about. It is inspired by [Sitegeist](https://github.com/cowboycodr/sitegeist), especially its use of repeated same-brief comparisons to make model tendencies perceptible.

The project does not rank models. It gives exact model configurations the same stable task, preserves each output, and places the runnable results side by side so a human can develop intuition about what each model reaches for.

Current proof gallery: <https://artifacts.burooj.dev/model-tasting/>

Canonical home: `/mnt/server-ssd/BJsWorkspace/Projects/tasting-kitchen`

Planned canonical deployment: <https://tasting-kitchen.burooj.dev/>

## Language

- **Kitchen** — the catalog, CLI orchestration, validation, immutable storage, gallery, and presentation runtimes.
- **Cuisine** — one of one-or-more controlled Recipe classifications used for filtering; there is no primary Cuisine.
- **Recipe** — an editable prompt, brief, or prompt chain with its supporting execution and output contract.
- **Recipe Revision** — one immutable executed state of a Recipe.
- **Menu** — an editable, deliberately selected set of Recipe identities used to explore one or more Cuisines.
- **Menu Revision** — an immutable executed Menu snapshot that pins exact Recipe Revisions and acts as a reusable comparison lens.
- **Cook** — the action that requests execution.
- **Run** — one private operational attempt to execute one Recipe Revision under an exact requested model configuration.
- **Dish** — one immutable accepted artifact and public-safe receipt produced by a successful Run.
- **Repeat** — the derived relationship between Dishes sharing the same Recipe Revision and exact requested configuration.
- **Tasting** — the human activity and public surface for inspecting and comparing Dishes.

**Domain**, **Flight**, and **Collection** are retired product terms. The current implementation still contains those legacy shapes and must migrate to this contract. See the canonical [product model](docs/product-model.md) for the complete language, invariants, scenario checks, and v1 boundary.

Recipes are labeled **Textbook**, **Mother's**, or **Hybrid**:

- **Textbook** — a conventional, recognizable baseline task.
- **Mother's** — a personal or unconventional recipe distilled from Burooj's real work, preferences, admired references, and recurring corrections.
- **Hybrid** — a recognizable baseline task whose initial brief already incorporates history-derived constraints.

Known preferences belong in the initial recipe. Staged correction turns remain only when adaptation to feedback is itself what the recipe is tasting. Mother's recipes preserve the recurring question or interaction grammar while replacing private names, copy, assets, and recognizable implementations.

Planning and workflow live in Linear: [Tasting Kitchen project](https://linear.app/bjs-projects/project/tasting-kitchen-09d8ad1ade80), [product-model pointer](https://linear.app/bjs-projects/document/product-model-and-recipe-language-ba14eea0d78d), [roadmap and architecture](https://linear.app/bjs-projects/document/promotion-roadmap-and-architecture-9b67d5d3982d), and [deployment gates](https://linear.app/bjs-projects/document/deployment-status-and-gates-445b6f9b7ceb). The repository document remains canonical.

## What is here

- `catalog/` — the current legacy domain catalog, controlled tags, Recipes, fixtures, and schemas; Cuisine/Menu schema migration is still pending.
- `bin/taste.mjs` + `lib/taste/` — validation, dry planning, isolated execution, identity verification, sanitization, recovery, immutable publication, and registry building.
- `dishes/` — canonical accepted artifacts and public-safe receipts.
- `reviews/` — artifact reviews bound to an exact immutable dish hash, explicitly identified as human or agent observations.
- `src/` — the React/Vite gallery. It is currently read-only; the planned owner-only Cook control will use a separate authenticated job service.
- `analysis/` — the bounded historical synthesis that informed the personal recipes.
- `private/` — ignored provenance and raw execution evidence; never published.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm test
npm run dev
```

The proof gallery is currently built for `/model-tasting/` and still shows legacy **Not tasted yet**, **Unsupported**, and **Draft** states. Under the canonical product contract, Draft and Ready-but-uncooked Recipes remain private; only Recipes with accepted Dishes appear on the Tasting surface. The canonical deployment will move the base path to `/` on `tasting-kitchen.burooj.dev`.

## Use the CLI

```bash
# Inspect the authored Recipe catalog and exact configurations
node bin/taste.mjs list
node bin/taste.mjs plan --variant codex-sol-high --recipe responsive-product-launch

# Dry-run by default
node bin/taste.mjs run --variant codex-sol-high --recipe responsive-product-launch

# A real model run requires both an explicit flag and environment opt-in
TASTE_ALLOW_MODEL_RUNS=1 node bin/taste.mjs run \
  --variant codex-sol-high \
  --recipe responsive-product-launch \
  --execute

# Rebuild gallery inputs
node bin/taste.mjs build-registry
```

Each recipe starts in a fresh workspace and fresh model session. A multi-turn recipe resumes only its own returned session ID. Accepted dishes are never overwritten; failed attempts remain private. See [How to taste](docs/how-to-taste.md) for the human workflow.

## Design systems and motion

Design-system continuation lives inside **UI & Visual**, where recipes can test whether a model preserves visual language, promotes the right shared primitive, prunes premature abstraction, and keeps behavior-heavy components local.

Motion is cross-cutting:

- **UI & Visual** — expressive, SVG, scroll, and compositional motion;
- **UX & Interaction** — gesture, causality, state feedback, recovery, and reduced-motion meaning;
- **Music & Creative Code** — BPM-synchronized, audio-reactive, and voice-specific motion.

## Safety and interpretation

Structural acceptance is not a taste verdict. Required deterministic checks gate publication; manual observations are separate artifact reviews. A model's own final message or trace is evidence of what it claimed, not independent verification.

Exact identity includes provider, requested and observed model, harness/version, reasoning effort, requested and observed service tier, execution profile, and recipe/config/catalog hashes. Public artifacts are scanned for private paths, credentials, remote runtime dependencies, and private provenance.

No scores, leaderboards, or LLM taste judges are part of the product. Model-running controls must remain authenticated and owner-only; the public gallery remains read-only.
