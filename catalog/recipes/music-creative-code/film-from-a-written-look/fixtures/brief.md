# A film from a written look

## The look

> A weather map drawn by someone who has never seen weather.

That phrase is the whole brief for the look. What it means, what the film shows, the palette and the way it is drawn are yours. Nothing in it should be literal; it should feel like a memory.

## Task

Make a 24-second film in that look: 1080 × 1350, 24 fps, exactly 576 frames, with an original soundtrack.

## How to work

Work on your own in one autonomous turn, with up to three render, inspect and revise rounds. Make every creative decision yourself; do not ask for approval or delegate to another model. Use one render job and one browser at a time.

Draw every visible element in code and synthesize the sound yourself. No external images, generated stills, footage, sampled audio, other models' outputs or borrowed scene code. Type may use the fonts installed in the toolchain. No network calls at playback. Keep randomness seeded so the picture is a pure function of time.

## Deliverable

- `film.mp4`: H.264 video with AAC audio, at exactly the size, rate and frame count above.
- `player.html`: a self-contained live version of the same film drawn in code, with its sound. Expose `window.seek(t)` and a readiness promise `window.ready`; include play and pause, and an explicit button to start sound.
- `index.html`: a copy of `fixtures/player.html`, unchanged.
- `contact.png`: a labelled contact sheet of frames from the film.
- `source/`: all source you wrote, any engine code it needs and dependency locks.
- `README.md`: exact rebuild commands, attribution, and the checks you ran with their limits, honestly.
- `evidence.json`: `checks`: an array of objects with `name`, `result` (`passed`, `failed` or `not-run`) and `detail`, for the checks you actually ran. Playback you did not watch is not a pass.

Fit the whole delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces out of it.

Run `node validation/film.mjs` from the delivery root with the fixtures mounted. Then watch the encoded film at full size and listen to it. Record anything you could not check.

## Human tasting

- What did the model think the phrase means, and is the reading its own?
- Is anything literal left? Does it feel like a memory?
- Is the look held from the first frame to the last?
