# Tasting Kitchen product model

## Purpose

Tasting Kitchen is a repeatable way to build human intuition about model fingerprints. It gives models the same versioned tasks, preserves their artifacts, and makes the results easy to inspect side by side.

It is not a leaderboard. The endpoint is Burooj having grounded taste about which model he reaches for in a particular kind of work.

## Canonical language

| Term | Meaning |
| --- | --- |
| Domain | A browsing and filtering category only. Nothing runs a domain. |
| Recipe | A versioned, self-contained task given to a model. It contains the brief, inputs, initial constraints, expected artifact, held constants, tool boundary, and checks. This is the primary authored unit. |
| Flight | A curated, ordered set of pinned recipe versions selected to reveal a model's tendencies. A recipe may appear in several flights. |
| Run | One execution of one recipe version under one exact model configuration. |
| Dish | The immutable visible artifact produced by a run, together with its public-safe receipt. |
| Repeat | Another run of the exact same recipe version and configuration. Repeats reveal within-model variance. |
| Collection | Dishes sharing the same observed model, harness, and normalized configuration. |
| Tasting | A comparison view over dishes. It may compare models or same-model repeats; it is not a separate stored object. |
| Menu | The interface over recipes and flights. It is not a separate catalog entity. |
| Kitchen | The whole product. **Cook** is the action that starts a run. |

The recipe is the center of the system. Domains help find recipes; flights select recipes; runs execute recipes; dishes are what people taste.

## Recipe lineage

- **Textbook** — a conventional, recognizable baseline task for the domain. Representative does not mean objectively best.
- **Mother's** — a personal or unconventional recipe distilled from Burooj's actual work, preferences, corrections, and admired references: the material a generic benchmark misses.
- **Hybrid** — a recognizable Textbook task whose original brief already carries Mother's constraints.

The public label remains **Mother's** because its meaning is useful. Public interfaces must explain it in one sentence. The internal enum may remain `personal` for portability.

## Recipe authoring rules

1. Use familiar task names as titles: `SaaS Marketing Page`, `Circular Music Sequencer`, `Supportive Journal Reflection`.
2. Put the interesting tension in a subtitle or brief, not in an essay-like title.
3. Make the brief understandable without opening fixture files. Fixtures are visible supporting inputs, not hidden homework.
4. Compile known preferences and historical corrections into the initial constraints. If analysis taught us "not cheesecake," the tested model gets "not cheesecake" from the start.
5. Keep staged turns only when responding to correction or changing state is the behavior under test.
6. State the expected artifact, tool permissions, held constants, and public checks plainly.
7. Preserve private provenance for why a Mother's or Hybrid constraint exists without publishing private source material.

## Comparisons

- **Cross-model:** the same recipe version and environment, different model configurations.
- **Repeat:** the same recipe version, model, harness, effort, tools, and environment, executed more than once.
- **Cross-harness:** useful exploration, but never presented as a clean raw-model comparison.

Every comparison must expose configuration differences. A repeat needs a stable run-group identity and repetition index so the gallery never silently hides later dishes.

## Product surfaces

The existing React/Vite application is a modern frontend. It feels like a website because it was intentionally built as a static read-only gallery.

The promoted system has two security zones:

1. **Public gallery** — recipe-first browsing, lineage/domain filters, self-contained briefs, exact provenance, cross-model comparisons, and repeats. It cannot spend model credits.
2. **Private control plane** — an authenticated owner-only Cook action, background job status, logs, cancellation, and publication. Provider credentials remain on the worker and never enter the browser.

The CLI and private web control must call the same runner library. The web control is not a shell textbox: recipes and variants are server-side allowlisted, arguments are structured, and runs are concurrency- and cost-bounded.

## Good endpoint

Anyone can understand a recipe without opening repository fixtures, browse by lineage and domain, compare the same recipe across models or repeated runs, and inspect exact provenance. Burooj can privately launch a recipe or flight; accepted immutable dishes join the gallery. Public visitors cannot run models or access provider credentials.
