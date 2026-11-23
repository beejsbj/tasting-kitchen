# Three styleframes, then a film

This is in two parts. First you offer three looks. I look at them and reply. Then you make the film.

## The look

> A weather map drawn by someone who has never seen weather.

That phrase is the whole brief for the look. What it means, what the film shows, the palette and the way it is drawn are yours.

## Part one: three styleframes

- Three radically different readings of the phrase, not one idea in three palettes. Differ in what you think the phrase means and in how it is drawn.
- For each, a still styleframe and a 3-second motion test of the same look:
  - `styleframes/a.png`, `styleframes/b.png`, `styleframes/c.png`: 1080 × 1350 PNG.
  - `styleframes/a.mp4`, `styleframes/b.mp4`, `styleframes/c.mp4`: H.264, 1080 × 1350, 24 fps, exactly 72 frames. Sound is optional.
- `styleframes/styleframes.md`: a short rationale for each of A, B and C, no more than 150 words in all.
- Then stop. Do not make the film yet.

## Part two: the film

My reply will tell you how to choose a styleframe and add a note. Make the film from the one you take:

- 1080 × 1350, 24 fps, exactly 576 frames (24 seconds), with an original soundtrack. Keep the soundtrack's true peak at or below −0.1 dBTP; AAC encoding can push peaks up, so leave headroom.
- Keep everything under `styleframes/` exactly as it was.

## How to work

Work on your own within each part, with up to three render, inspect and revise rounds in each. Make every creative decision yourself; do not ask for approval or delegate to another model. Use one render job and one browser at a time.

Draw every visible element in code and synthesize the sound yourself. No external images, generated stills, footage, sampled audio, other models' outputs or borrowed scene code. Type may use the fonts installed in the toolchain. No network calls at playback. Keep randomness seeded so the picture is a pure function of time.

If a skill is mounted at `skill/`, read `skill/SKILL.md` first and follow its process; its examples teach technique and must not be submitted. If none is mounted, work from this brief.

## Deliverable after part two

- `film.mp4`: H.264 video with AAC audio, at exactly the size, rate and frame count above.
- `player.html`: a self-contained live version of the same film drawn in code, with its sound. Expose `window.seek(t)` and a readiness promise `window.ready`; include play and pause, and an explicit button to start sound.
- `index.html`: a copy of `fixtures/player.html`, unchanged.
- `contact.png`: a labelled contact sheet of frames from the film.
- `source/`: all source you wrote, any engine code it needs and dependency locks.
- `README.md`: exact rebuild commands, attribution, and the checks you ran with their limits, honestly.
- `README.md` begins by naming the styleframe you took and what set it apart.
- `evidence.json`: `chosen`, the styleframe you took (`"a"`, `"b"` or `"c"`); and `checks`: an array of objects with `name`, `result` (`passed`, `failed` or `not-run`) and `detail`, for the checks you actually ran. Playback you did not watch is not a pass.
- `styleframes/`: unchanged from part one.

Fit the whole delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces out of it.

Run `node validation/styleframes.mjs` after part one, and both `node validation/film.mjs` and `node validation/styleframes.mjs` after part two, from the delivery root with the fixtures mounted. Watch what you made at full size and listen to it. Record anything you could not check.

## Human tasting

- Are the three styleframes three real directions, or one idea three times?
- Did the model take the one that truly stands apart?
- Does the film keep that look and take the note: nothing literal, like a memory?
