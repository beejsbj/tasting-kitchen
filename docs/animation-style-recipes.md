# Animation styles: proposed recipes

Status: **eight drafts for Burooj's authoring checkpoint, not ready to Cook**.
Prepared 2026-10-11 in response to the request for more animation styles and
meaningful comparisons between agents. Together with the two
[paper-boat drafts](animation-skill-recipes.md), the Kitchen now has ten
animation proposals.

## Tasks and reasons to return

These are deliberately different motion problems. Each linked brief includes
the full fictional task, visual direction, event windows and human tasting
questions. A pretty contact sheet alone cannot satisfy the intended task.

| Recipe | Style | Fixed skill | Reason to return |
|---|---|---|---|
| [Heavy little suitcase](../catalog/recipes/music-creative-code/heavy-little-suitcase/fixtures/brief.md) | Graphite character acting | hand-drawn | See whether a model can make mass, effort and a change of plan legible through motion. |
| [The last seat](../catalog/recipes/music-creative-code/the-last-seat/fixtures/brief.md) | Minimal ink pantomime | hand-drawn | Compare two-character staging, attention, social timing and readable gesture without narration. |
| [Paper garden](../catalog/recipes/music-creative-code/paper-garden/fixtures/brief.md) | Paper-cut transformation | hand-drawn | Expose whether transformations preserve connected parts, material behavior and readable silhouettes. |
| [Night market delivery](../catalog/recipes/music-creative-code/riso-night-market/fixtures/brief.md) | Three-ink risograph | riso-film | Compare tactile print craft, layered camera motion and staging through foreground occlusion. |
| [Rooftop rescue](../catalog/recipes/music-creative-code/pixel-rooftop-rescue/fixtures/brief.md) | NES pixel animation | procedural | Test whether small sprites can convey intent, contact and continuity without hiding behind high-resolution illustration. |
| [The marble sorter](../catalog/recipes/music-creative-code/blueprint-marble-sorter/fixtures/brief.md) | Ink drawing and blueprint explanation | procedural | See whether the agent can explain a mechanism while maintaining object identities and physical causes. |
| [Words with weight](../catalog/recipes/music-creative-code/words-with-weight/fixtures/brief.md) | Kinetic typography | motion-reel | Compare typographic judgment, material-specific movement, reading time and sound synchronization. |
| [Queue under pressure](../catalog/recipes/music-creative-code/queue-under-pressure/fixtures/brief.md) | Clean technical motion diagram | code-animations | Test technical truth, stable visual identities and whether animation explains backpressure. |

Each task has **Hybrid lineage**: an original fictional scene combined with a
specific public skill workflow and a deliberately chosen craft constraint.
No private source material, existing model movie or generated reference image
is supplied. The queue's event trace and the sorter's dimensions and object
order are synthetic facts provided in full.

## Shared comparison protocol

One autonomous authoring turn includes planning, tools and up to three
render/inspect/revise rounds. All known requirements arrive in the first
prompt. No delegated model or human concept-selection turn is part of these
recipes. A future recipe testing collaboration should be a sibling with real
choices or new information, not a surprise correction added mid-comparison.

Compare models **within the same Recipe Revision**. Skill, brief, fixtures,
font availability, toolchain, compute profile, output contract and revision
must match. Preserve actual provider/model/effort receipts, intervention and
runtime drift. Compare the two existing paper-boat siblings when the question
is about different skills handling a shared subject. Comparing different
style recipes also changes the subject and cannot isolate a skill's effect.

The styles menu is a library of eight tasks, not an instruction to cook all
of them. A useful first selection is Heavy little suitcase, Words with weight
and Queue under pressure: embodied action, typography and technical truth.
Choose repeated runs deliberately when examining variability; one film does
not establish a model's general capability.

## Fixtures and deliverables

Each recipe carries an immutable skill archive, a SHA-256 source lock, brief,
machine-readable film contract, shared player and validator. The queue adds
`states.json`. The archives preserve upstream licenses and notices. The
risograph fixture retains the entire upstream repository, including examples
and third-party notices, and is about 45 MB compressed. This is a larger input
than the other fixtures; it provides the complete referenced workflow.
The new film may use none of the donor scenes, sampled music or measured
animal geometry: all new artwork and sound are original code.

Every movie is 24 seconds. The three hand-drawn recipes and marble sorter are
1080 × 1920 at 24 fps; risograph is 1080 × 1080 at 30 fps; typography is
1080 × 1920 at 60 fps; pixel art is 1920 × 1080 at 60 fps from a native
320 × 180 canvas; the queue is 1920 × 1080 at 30 fps. These formats follow the
task and workflow. Render cost differs across recipes and must not be treated
as a model difference.

Deliver H.264/AAC `film.mp4`, a self-contained live `player.html`, authored
`source/` with rebuild instructions, a contact sheet and honest `evidence.json`.
Kitchen supplies `index.html` unchanged, using **static-web-v1**, with no
semantic runtime. The video, live version and download link are the tasting
surface. Limits are 100 MiB and 500 files per Dish.

## Deterministic acceptance boundary

Required checks inspect file presence, the unchanged player, PNG signature,
codec, dimensions, duration, frame count, and evidence structure. Each required
beat needs a reported time inside its window. These timestamps and reported
checks are **self-reports**, useful for navigating a review; they do not prove
that the film contains the action or that the action is good.

Queue under pressure additionally requires `source/state.mjs` to export pure
`stateAt(t)`. The validator compares the supplied trace at every boundary,
immediately before and after transitions, at the end, and in reverse time
order. It catches incorrect queue contents and stateful seeking. It does not
prove that the visible drawing uses the function; that needs visual review.

Human tasting watches complete motion with and without sound, looks at native
pixel or phone size, and checks the specific questions in each brief. Weight,
acting, print quality, continuity, mechanism clarity, readability and rhythmic
judgment remain human observations. Full decode, browser behavior, audible
quality and original authorship also need independent evidence.

## Before Ready

The concrete task, lineage, protocol, fixtures, output and presentation above
are the proposed shapes required by the Kitchen authoring checkpoint. Burooj's
acceptance is still outstanding. After acceptance, pin each execution
container and its Node 22+, Python, browser, FFmpeg, fonts and engine packages;
smoke the renderer, validator, sanitization and Kitchen playback together.
Remotion and Manim are selected Lab tools but have no new recipe in this
batch: their runtime and packaging contracts need a separate proposal.

No model run or public release was requested by this draft expansion.

```sh
node bin/taste.mjs plan --config codex-gpt-6-astra-high --menu animation-styles --json
node bin/taste.mjs plan --config codex-gpt-6-1-sol-high --menu animation-styles --json
```

Both plans must report eight unsupported draft recipes, with no Cook started.
