# Invent a style and hold it

## Task

Invent a visual style that has no existing name: not a known art movement, medium, technique or software look. Give it a name, and write the five rules it obeys in `STYLE.md`. Then make a 30-second film in it, about whatever the style suggests to you.

Every frame obeys all five rules. Make the rules concrete enough that a viewer could hold any single frame against them. Choose the moment where the rules are under the most pressure, put it in the film on purpose, and hold the rules there too.

## Format

1080 × 1080, 30 fps, exactly 900 frames (30 seconds), with an original soundtrack.

## How to work

Work on your own in one autonomous turn, with up to three render, inspect and revise rounds. Make every creative decision yourself; do not ask for approval or delegate to another model. Use one render job and one browser at a time.

Draw every visible element in code and synthesize the sound yourself. No external images, generated stills, footage, sampled audio, other models' outputs or borrowed scene code. Type may use the fonts installed in the toolchain. No network calls at playback. Keep randomness seeded so the picture is a pure function of time.

## Deliverable

- `STYLE.md`: the style's name as the first line, written `# Name`; then its rules as a numbered list, `1.` to `5.`, exactly five. Anything else you add there is unnumbered.
- `film.mp4`: H.264 video with AAC audio, at exactly the size, rate and frame count above.
- `player.html`: a self-contained live version of the same film drawn in code, with its sound. Expose `window.seek(t)` and a readiness promise `window.ready`; include play and pause, and an explicit button to start sound.
- `index.html`: a copy of `fixtures/player.html`, unchanged.
- `contact.png`: a labelled contact sheet of frames from the film.
- `source/`: all source you wrote, any engine code it needs and dependency locks.
- `README.md`: exact rebuild commands, attribution, and the checks you ran with their limits, honestly.
- `evidence.json`: `beats`, an array holding one object `{ "id": "hardest-moment", "time": <seconds>, "note": "<which rules are under pressure there and how the frame keeps them>" }`; and `checks`: an array of objects with `name`, `result` (`passed`, `failed` or `not-run`) and `detail`, for the checks you actually ran. Playback you did not watch is not a pass.

Fit the whole delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces out of it.

Run `node validation/film.mjs` and `node validation/style.mjs` from the delivery root with the fixtures mounted. Then watch the encoded film at full size and listen to it. Record anything you could not check.

## Human tasting

- Is the style new, or a known look renamed?
- Can you see each rule in a frame you pick at random?
- Is the hardest moment really hard, and does it hold?
- Does the subject grow out of the style?
