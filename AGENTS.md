# Tasting Kitchen agent guidance

## Recipe intent

Recipes are Burooj's personal benchmarks: tasks he genuinely wants to give several models so he can inspect differences in judgment, style, behavior, and produced artifacts. Category coverage helps navigation; it is not a quota.

Shape each public Recipe manually with Burooj. Historical analysis and `catalog/archive.json` are inspiration and provenance, not an approved menu or reusable prompt library. An archived Recipe earns a new public definition only when its underlying task still matters to him. Use a plain, recognizable task name and write the brief from the current understanding rather than polishing or lightly renaming the archived text.

For canonical Kitchen vocabulary and comparison invariants, read `docs/product-model.md` before changing catalog or execution behavior.

## One-shot and multi-turn benchmarks

Multi-turn collaboration is a first-class benchmark, not merely a correction mechanism. A staged Recipe may gather context, propose directions, let the user select, revise an artifact, or respond to genuinely new information.

To compare one-shot and multi-turn work, author sibling Recipes that hold the subject, supplied facts, deliverable, output limits, presentation, and acceptance checks constant while varying the collaboration protocol. Treat them as a paired Menu comparison, not as Repeats or the same Recipe Revision: their prompt contracts differ.

Every staged turn must have a real job. Put known requirements in the opening context. Use later corrections only for new information, a real selection or authority change, or adaptation that is deliberately being tasted. Preserve the intermediate responses or artifacts when the evolution itself matters.

## Conversation and journal benchmarks

Taste how the model receives, interprets, writes, and responds to the material: its prose, specificity, warmth, honesty, pressure, metaphor, restraint, and conversational movement. Asking a journal question may appear inside a benchmark, but question generation alone is not the benchmark.

A journal fixture may be synthetic or derived from authentic private material. Prefer a synthetic fixture when it preserves the relevant pressure. When authentic material is needed, keep the raw source private, derive the smallest sufficient fixture, and obtain Burooj's approval for the exact sanitized text before it or any resulting Dish becomes public.

## Authoring checkpoint

Before implementing or cooking a new Recipe, present its proposed task, why Burooj would return to it, lineage, one-shot or staged structure, fixture source, deliverable, deterministic acceptance boundary, and Kitchen presentation. Completion means Burooj has accepted that benchmark shape; historical provenance, an existing archived definition, or a mechanically valid schema is not acceptance.
