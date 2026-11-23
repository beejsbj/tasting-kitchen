# Titles for a film that doesn't exist

## Task

`fixtures/credits.json` holds a title and eight credits for a film that doesn't exist. Make its 40-second opening title sequence, with your own music. A viewer should be able to guess the film's genre and tone from the titles alone.

Show the title and all eight credits, with every name and role exactly as given, each readable on screen for at least 1.5 seconds. The order and everything else are yours. Show no other words: no tagline, no genre label, no extra credits.

## Format

1920 × 1080, 24 fps, exactly 960 frames (40 seconds), with an original soundtrack you synthesize. Keep the soundtrack's true peak at or below −0.1 dBTP and its integrated loudness at or above −40 LUFS; AAC encoding can push peaks up, so leave headroom.

## How to work

Work on your own in one autonomous turn, with up to three render, inspect and revise rounds. Make every creative decision yourself; do not ask for approval or delegate to another model. Use one render job and one browser at a time.

Draw every visible element in code and synthesize the sound yourself. No external images, generated stills, footage, sampled audio, other models' outputs or borrowed scene code. Type may use the fonts installed in the toolchain. No network calls at playback. Keep randomness seeded so the picture is a pure function of time.

If a skill is mounted at `skill/`, read `skill/SKILL.md` first and follow its process; its examples teach technique and must not be submitted. If none is mounted, work from this brief.

## Deliverable

- `film.mp4`: H.264 video with AAC audio, at exactly the size, rate and frame count above.
- `player.html`: a self-contained live version of the same film drawn in code, with its sound. Expose `window.seek(t)` and a readiness promise `window.ready`; include play and pause, and an explicit button to start sound.
- `index.html`: a copy of `fixtures/player.html`, unchanged.
- `contact.png`: a labelled contact sheet of frames from the film.
- `source/`: all source you wrote, any engine code it needs and dependency locks.
- `README.md`: exact rebuild commands, attribution, and the checks you ran with their limits, honestly.
- `evidence.json`: `credits`, an array with one object per credit and one for the title, `{ "id": "title" | "c1" … "c8", "on": <seconds>, "off": <seconds> }`, giving when each is first fully readable and when it stops being readable; `intent`, one sentence naming the genre and tone you meant; and `checks`: an array of objects with `name`, `result` (`passed`, `failed` or `not-run`) and `detail`, for the checks you actually ran. Playback you did not watch is not a pass.

The contact sheet shows at least one frame per credit.

Fit the whole delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces out of it.

Run `node validation/film.mjs` and `node validation/credits.mjs` from the delivery root with the fixtures mounted. Then watch the encoded film at full size and listen to it. Record anything you could not check.

## Human tasting

- Before reading `intent`, guess the genre and tone. Were you right?
- Do the type, motion and music agree on one film?
- Is every credit readable for its time on screen?
