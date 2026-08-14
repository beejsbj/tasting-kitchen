# Model Tasting Kitchen

A reusable, Sitegeist-inspired kitchen for learning model fingerprints through artifacts Burooj actually cares about.

The project does not rank models. It gives exact model configurations the same stable task, preserves each output, and places the runnable results side by side so a human can develop intuition about what each model reaches for.

Live gallery: <https://artifacts.burooj.dev/model-tasting/>

## Language

- **Domain** — a kind of work, such as UI & Visual, UX & Interaction, Agentic Work, or Music & Creative Code.
- **Recipe** — a versioned task package: prompt turns, public fixtures, tool boundary, output contract, and deterministic checks.
- **Dish** — one immutable artifact from one exact recipe + model + harness + configuration.
- **Collection** — dishes produced by one exact model/harness/configuration.
- **Flight** — an optional CLI batch. Flights schedule recipes; they are not gallery navigation.

Recipes are labeled **Textbook**, **Mother's**, or **Hybrid**. Mother's recipes preserve a recurring question or interaction grammar from Burooj's history while replacing private names, copy, visual assets, and recognizable implementations.

## What is here

- `catalog/` — nine domains, controlled tags, recipes, fixtures, and schemas.
- `bin/taste.mjs` + `lib/taste/` — validation, dry planning, isolated execution, identity verification, sanitization, recovery, immutable publication, and registry building.
- `dishes/` — canonical accepted artifacts and public-safe receipts.
- `reviews/` — artifact reviews bound to an exact immutable dish hash, explicitly identified as human or agent observations.
- `src/` — the read-only React/Vite gallery.
- `analysis/` — the bounded historical synthesis that informed the personal recipes.
- `private/` — ignored provenance and raw execution evidence; never published.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm test
npm run dev
```

The gallery is built for `/model-tasting/` and shows honest **Not tasted yet**, **Unsupported**, and **Draft** states when no accepted dish exists.

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

No scores, leaderboards, LLM judges, accounts, database, or public model-running endpoint are part of the product.
