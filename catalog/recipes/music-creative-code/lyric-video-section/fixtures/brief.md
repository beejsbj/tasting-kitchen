# Lyric video section

## Task

Make one complete 35-second section of a lyric music video for the supplied excerpt of *The Horse and the Infant* (Jorge Rivera-Herrans with Luke Holt and the EPIC cast, from the supplied recording). The excerpt is master time 58.000–93.000 s. Every sung word lands on screen at its measured onset inside an animated scene. Invent the visual world, the characters and the staging yourself; there is no approved direction. Imagery must be original stylisation with no performer likeness, album art, watermark, end card or invented credit.

## Supplied inputs

- `inputs/excerpt.wav`: the exact 35-second audio, 48 kHz stereo PCM. Use it unaltered; do not time-stretch, re-mix or replace it.
- `inputs/lyrics.json`: lines and words with measured onsets (`start`, `end`, seconds in excerpt time), confidence and provenance. It is the source of truth for word timing. You may revise a word's onset only with evidence you record in `evidence.json`.

## Visual and motion direction

Draw every visible element in code; no image generation, stock, photographs or video models. The picture is a pure function of song time, so the live preview and the export agree. Words are code-rendered elements driven by the supplied timing, never baked into still art. Let density follow the performance: martial scale where the song calls, intimacy where it turns. Words must be readable at phone size at their onset. End the section with at least as much force as it opens.

## Format

Exactly 35.000 seconds at 1280 × 720, 30 fps (1050 frames), H.264 with the supplied audio as AAC.

## Working protocol

If a skill directory is mounted at `skill/`, read `skill/SKILL.md` first and follow its planning, implementation and review process; its examples teach technique and must not be submitted. If no skill is mounted, work from this brief and your own method. The pinned lyric engine is supplied by Kitchen at `engine/` and is the same for every model and layer; do not replace it. All known constraints are provided now. Work independently in one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a style selection or delegate to another model. Use one render job and one browser at a time.

## Deliverable

- `film.mp4`: the section with the supplied audio.
- `player.html`: self-contained live preview that plays the same section.
- `index.html`: copy `fixtures/player.html` unchanged.
- `contact.png`: a labeled contact sheet with at least thirty frames across the section.
- `source/`: all authored scene source, timeline, and dependency locks; not the engine itself.
- `README.md`: exact rebuild commands, the governing visual idea in two sentences, and honest checks and limitations.
- `evidence.json`: `words` array with one entry per supplied word in order, each `{ "w", "shownAt", "revision"? }` where `shownAt` is the onset you used and `revision` records the reason for any change over 50 ms; `checks` array of `{ "name", "result", "detail" }` for checks you actually ran, including what you could not do (listening is usually not available to you and must be reported `not-run`).

Fit the delivery within 100 MiB and 500 files. Run `node validation/film.mjs` from the delivery root with fixtures mounted.

## Human tasting

- Is there one governing idea, and does it survive the climax?
- Are words readable at onset on a phone, and do they land on the voice when you listen?
- Does density follow the performance rather than a constant rate?
- Which weaknesses did the model name itself, and which did it miss?
