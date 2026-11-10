# Animation and lyric-video recipes

Status: **ten drafts awaiting Burooj's authoring acceptance; none cookable.** `heavy-little-suitcase` and `lyric-video-section` have their Kitchen equipment proven.
Reshaped on 2026-10-15 so that skills are layers of a Recipe rather than
separate Recipes. The earlier two paper-boat drafts are merged into one.

## What these recipes taste

Model fingerprints: the governing idea, shot grammar and staging, density
judgment, drawing and lettering finesse, and the honesty of the model's own
evidence. Held constant: duration, format, frame count, the toolchain image,
compute, review-round cap, effort, and every factual input. A skill is
guidance mounted at `skill/`; the engine, browser, encoder and fonts are
Kitchen's and identical across layers.

## Recipes and layers

| Recipe | Task | Format | Layers besides *without skill* |
|---|---|---|---|
| `paper-boat-voyage` | A Little Voyage: fold, launch, swirl, leaf sail, lantern | 1080×1920 · 24 fps | hand-drawn, procedural |
| `heavy-little-suitcase` | Mass, effort and a change of plan in one locked shot | 1080×1920 · 24 fps | hand-drawn, procedural |
| `the-last-seat` | Two-character pantomime without narration | 1080×1920 · 24 fps | hand-drawn, procedural |
| `paper-garden` | Paper-cut transformations that keep parts connected | 1080×1920 · 24 fps | hand-drawn, procedural |
| `riso-night-market` | Three-ink print craft with layered parallax | 1080×1080 · 30 fps | procedural (riso-film deferred, see below) |
| `pixel-rooftop-rescue` | Small sprites conveying intent and contact | 1920×1080 · 60 fps from 320×180 | procedural, code-animations |
| `blueprint-marble-sorter` | Explain a mechanism while keeping object identities | 1080×1920 · 24 fps | procedural, code-animations |
| `words-with-weight` | Four verbs, four motion curves, one type family | 1080×1920 · 60 fps | motion-reel, procedural |
| `queue-under-pressure` | Backpressure explained from a supplied state trace | 1920×1080 · 30 fps | code-animations, motion-reel |
| `lyric-video-section` | One 35-second section of a supplied song, world invented | 1280×720 · 30 fps | lyric-music-video |

Every film recipe is Hybrid lineage with a fictional fixture. The lyric recipe
is Mother's lineage and **private**: its excerpt and measured word alignment
live under `private/fixtures/lyric-video-section/` and its Dishes publish to
`private/dishes/` only. The brief names the song for credit and carries no
lyric text.

The recommended first Cook is `heavy-little-suitcase` and
`lyric-video-section`, each without skill and with one layer, for two models,
plus one Repeat of whichever Burooj prefers. The `animation-styles` Menu holds
the nine public film recipes as a library, not a quota.

## Shared protocol

One autonomous authoring turn with up to three render/inspect/revise rounds.
All constraints arrive in the first prompt; no concept-selection turn. A later
collaboration sibling of the lyric recipe (three styleframes, a real selection,
then the section) should be its own Recipe with the human turn standardized
and the styleframes preserved.

Each brief ends the same way: if `skill/` is mounted, read `skill/SKILL.md`
first and follow its process without submitting its examples; if not, work
from the brief. Comparing layers therefore changes only the mounted guidance.

## Deliverable and checks

`film.mp4` (H.264/AAC), `player.html` (self-contained live version),
`index.html` (the supplied player, unchanged), `contact.png`, `source/`,
`README.md`, and `evidence.json`. Kitchen presents through `static-web-v1`.

`validation/film.mjs` checks files, the unchanged player, PNG signature,
codec, dimensions, frame rate, frame count, durations, a complete FFmpeg
decode with zero errors, a true peak at or below -0.1 dBTP (clipping is a
renderer defect), and the evidence shape. The film recipes require one
reported time inside each beat window; the queue recipe additionally checks a
pure `stateAt(t)` against the supplied trace; the lyric recipe requires one
evidence entry per supplied word and a recorded reason for any onset moved by
more than 50 ms. Integrated loudness is reported, not gated.

Beat times and check claims are self-reports. Motion, listening, originality
and whether the picture matches the words remain human tasting; every brief
lists its own questions. For the lyric recipe, audio identity with the
supplied excerpt (correlation against the source PCM) is the Kitchen-side
check `validation/audio-identity.mjs`: lag within 20 ms, every audible
half-second correlated, nothing added in the excerpt's silences, duration
matched; a uniform trim is reported, not failed.

## Before Ready

1. **Done for `heavy-little-suitcase` and `lyric-video-section`:** the pinned
   film toolchain (`catalog/toolchains/film/`, see below), smoke render, validator,
   sanitization and gallery playback, proven with Kitchen-made references.
2. **Done:** the patched lyric engine at `engine/`, assembled in the image
   from the skill's own `engine.patch` (sha-checked) at the pinned upstream
   commit, and the audio identity check.
3. **Open:** the model's own shell still runs on the host. Kitchen judges and
   plays every film in the image, and supplies the engine from it, but a model
   renders with whatever the host has until a harness can run its tools inside
   the image. Until then the toolchain is held constant for Kitchen's checks,
   not for the model's working tools.
4. A Claude Code harness configuration if Opus is in the comparison. Opus in
   Claude Code and Sol in Codex are different configurations: same
   brief, browsed together, not a like-for-like pair.
5. Burooj's acceptance of each benchmark shape at the authoring checkpoint.
   Readiness does not flip `status`.

## Film toolchain

`catalog/toolchains/film/toolchain.json` pins the image: a digest-pinned Node 22 base,
one dated Debian snapshot for Chromium, FFmpeg, Python 3 (NumPy, SciPy) and
fonts, Bun, and the lyric engine (upstream commit, `engine.patch` and brand
hashes, Google Fonts commit and per-file hashes). The skill's `brand.ts` is
supplied with empty handles so the engine draws no watermark; the skill's
world kit and example scenes are technique and reach a model only through
the skill layer.

A Recipe names the toolchain in `toolchain` and carries the generated pin as
its `toolchain` fixture, so editing the image moves the recipe hash. Command
checks of such a Recipe run in the image, offline and read-only, and only
after the image's `kitchen.toolchain-hash` label matches the current pin; a
stale local build is refused with a rebuild instruction.

```sh
node scripts/build-toolchain.mjs film-v1   # labels the image with its toolchain hash
node scripts/pin-toolchain.mjs            # after any toolchain edit; --check to verify
node scripts/smoke-recipe.mjs heavy-little-suitcase
node scripts/smoke-recipe.mjs lyric-video-section   # local only; ~30 min engine render
node scripts/smoke-recipe.mjs lyric-video-section --resume private/runtime/smoke/lyric-video-section/<stamp>
```

A smoke runs no model. It renders `smoke/<recipe>/` in the image, runs the
Recipe's required checks there, publishes through the real publication path
into a scratch Kitchen under ignored `private/runtime/smoke/`, builds the
registry there as if the Recipe were accepted, and plays the Dish in the
gallery's sandboxed iframe inside the offline image. A private Recipe's Dish
must stay out of the registry and is played from the private tree.

Deferred: the `riso-film` skill (its 45 MB upstream repository needs a custody
decision before it becomes a catalog layer), Manim, Three.js, a sound-design
sibling, and a dedicated video presentation profile.

```sh
node bin/taste.mjs plan --config codex-sol-high --menu animation-styles --json
node bin/taste.mjs plan --config codex-sol-high --recipe heavy-little-suitcase --skill hand-drawn --json
node bin/taste.mjs plan --config codex-sol-high --recipe lyric-video-section --skill lyric-music-video --json
```

Each plan reports draft recipes as unsupported, with no Cook started.
