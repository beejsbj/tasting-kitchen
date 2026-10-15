# Animation and lyric-video recipes

Status: **ten drafts awaiting Burooj's authoring acceptance; none cookable.**
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
supplied excerpt (correlation against the source PCM) is a Kitchen-side check
still to be written.

## Before Ready

1. One pinned execution image (Node 22+, Python, Chromium, FFmpeg, fonts) used
   by every model and layer; smoke render, validator, sanitization and gallery
   playback together.
2. For the lyric recipe, the patched lyric engine supplied by Kitchen at
   `engine/` and pinned; the skill's `engine.patch` must match it.
3. A Claude Code harness configuration if Opus is in the comparison. Opus in
   Claude Code and Sol in Codex are different configurations: same Recipe
   Revision, browsed together, not a like-for-like pair.
4. Burooj's acceptance of each benchmark shape at the authoring checkpoint.

Deferred: the `riso-film` skill (its 45 MB upstream repository needs a custody
decision before it becomes a catalog layer), Manim, Three.js, a sound-design
sibling, and a dedicated video presentation profile.

```sh
node bin/taste.mjs plan --config codex-sol-high --menu animation-styles --json
node bin/taste.mjs plan --config codex-sol-high --recipe heavy-little-suitcase --skill hand-drawn --json
node bin/taste.mjs plan --config codex-sol-high --recipe lyric-video-section --skill lyric-music-video --json
```

Each plan reports draft recipes as unsupported, with no Cook started.
