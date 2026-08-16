# Tasting Kitchen

A reusable, Sitegeist-inspired system for learning model fingerprints through artifacts Burooj actually cares about.

The project does not rank models. It gives exact model configurations the same stable task, preserves each output, and places the runnable results side by side so a human can develop intuition about what each model reaches for.

Current proof gallery: <https://artifacts.burooj.dev/model-tasting/>

Canonical home: `/mnt/server-ssd/admin/home-data/Projects/tasting-kitchen`

Planned canonical deployment: <https://tasting-kitchen.burooj.dev/>

## Language

- **Domain** — a browsing and filtering category such as UI, UX, Agentic Work, or Journaling.
- **Recipe** — a versioned, self-contained task given to a model: brief, inputs, constraints, expected artifact, and held constants. It is the primary authored unit.
- **Flight** — a curated, ordered set of pinned recipe versions chosen to reveal a model's tendencies.
- **Run** — one execution of one recipe version under an exact model configuration.
- **Dish** — the immutable visible artifact and receipt produced by a run.
- **Repeat** — another run of the exact same recipe version and model configuration, used to expose within-model variance.
- **Collection** — dishes produced by one exact model/harness/configuration.

Recipes are labeled **Textbook**, **Mother's**, or **Hybrid**:

- **Textbook** — a conventional, recognizable baseline task for the domain.
- **Mother's** — a personal or unconventional recipe distilled from Burooj's real work, preferences, admired references, and recurring corrections.
- **Hybrid** — a recognizable baseline task whose initial brief already incorporates history-derived constraints.

Known preferences belong in the initial recipe. Staged correction turns remain only when adaptation to feedback is itself what the recipe is tasting. Mother's recipes preserve the recurring question or interaction grammar while replacing private names, copy, assets, and recognizable implementations.

See [Product model](docs/product-model.md) and [Roadmap](docs/roadmap.md) for the promoted project shape.

## What is here

- `catalog/` — nine domains, controlled tags, recipes, fixtures, and schemas.
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

The proof gallery is currently built for `/model-tasting/` and shows honest **Not tasted yet**, **Unsupported**, and **Draft** states when no accepted dish exists. The canonical deployment will move the base path to `/` on `tasting-kitchen.burooj.dev`.

## Use the CLI

```bash
# Inspect the menu and exact collection identities
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
