# Animation skill recipes

Status: **draft, awaiting Burooj's acceptance of the benchmark shape**.
These definitions were prepared on 2026-10-11 after a request to compare
animation skills across models. They are private and cannot be cooked while
their status is draft.

## Proposed task

Make **A Little Voyage**, a 24-second paper-boat film: fold on a desk, launch
into rainwater, use a leaf sail to escape a swirl, arrive at a lantern.
This is an original fictional fixture with no personal source material.
The lineage is Hybrid: a conventional small story with the requested
code-authored visual and music constraint and pinned skill workflow.

Return to this task when a model or skill changes, to inspect differences in
staging, expressive drawings, physical contacts, pacing, sound and artistic
character. These qualities remain human observations.

| Recipe | Held skill | Distinct direction |
|---|---|---|
| `hand-drawn-paper-boat` | hand-drawn-canvas-animation at `90e966201add3ff41dc4ebd1348165c0cb2d5eab` | Whole drawings, poses, graphite and ink |
| `procedural-paper-boat` | procedural-film at `f59413999ae24f6e1f9165b73a0eaa97a0b1c407` | Drawn mode, paper/blueprint, 120 BPM |

Each uses **one autonomous authoring turn**, including tool use and the
model's own render/inspect/revise work. Comparing models within one Recipe
holds the skill fixed. The `animation-skills` Menu groups the two tasks for
exploring differences between skills; they are distinct Recipe identities.

Each skill archive contains the pinned upstream files and license. The
immutable fixture hash freezes those exact bytes. Preserve archives and old
executed Recipe Revisions when updating skills. Dependencies and the
render environment also need a fixed revision before an accepted Cook.

## Delivery and presentation

Every result supplies H.264/AAC video at 1080 × 1920, 24 fps and 576 frames;
a live HTML drawing player; contact sheet; and rebuild source. Kitchen
supplies a common HTML video player using its existing `static-web-v1`
presentation profile. A future dedicated video profile can improve controls;
it is not necessary to invent a new artifact kind for this draft.

The required validator checks files, the unchanged supplied player, PNG
signature, codec, dimensions, frame count and duration. It does **not** prove
visual quality, originality, complete decoding, or audible quality.
Before Ready, smoke the delivery through artifact sanitization, complete
decode, browser playback with audio and the gallery sandbox. Fix any concrete
gap and freeze the resulting execution contract identically for both models.

Two new configuration IDs preserve the existing Sol identity:
`codex-gpt-6-astra-high` and `codex-gpt-6-1-sol-high`, both requesting high
effort and priority service. Their existence records requests; actual model,
tier and harness identity still require the normal Kitchen receipts.
Existing `codex-sol-high` continues to describe its historical GPT-5.6 model.

## Relationship to the films already made

The October 11 Sol and Astra films are exploratory lab samples, not accepted
Kitchen Dishes or retroactively executed Recipe Revisions. The workers had
different execution conditions and coordinator intervention. Astra used the
pinned hand-drawn skill without seeing Sol's authored source or film.
The lab records those differences beside the results.

Animation Lab owns the ongoing filmmaking workflow, source and experiments.
Tasting Kitchen owns accepted Recipes, immutable Dishes and comparison views.
Blender Agent Studio belongs to 3D Lab.

## Review and activation

Burooj's review is of the task, fictional fixture, one-turn protocol,
deliverables, deterministic boundary and Kitchen presentation described
above. After acceptance, finish the shared render-environment smoke,
mark the definitions Ready, inspect their exact hashes, and Cook the chosen
configurations through the existing Kitchen CLI. A new Cook requires explicit
fill-missing or repeat intent. Today's draft work requests neither.

Inspect without running models:

```sh
node bin/taste.mjs inspect --recipe hand-drawn-paper-boat --json
node bin/taste.mjs plan --config codex-gpt-6-astra-high --menu animation-skills --json
```

Planning must report both Recipes unavailable because they are drafts.

## Further styles

[Eight additional draft recipes](animation-style-recipes.md) cover character
weight, two-person acting, paper transformation, risograph parallax, pixel
action, a sorting mechanism, kinetic type and queue backpressure. They form
the separate `animation-styles` Menu. The original two paper-boat recipes
and their fixture bytes remain unchanged.
