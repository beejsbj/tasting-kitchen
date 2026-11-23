# Two colours, no grey

## Task

Make a 24-second film in which every rendered pixel is one of exactly two colours of your choice. No anti-aliasing, gradients, blending or transparency: each pixel is one colour or the other. Within that limit, give the film depth, light, texture and fast motion. The subject is yours.

Choose two colours you can tell apart at a glance: at least 48 apart as a straight-line distance in 8-bit RGB.

## Format

1080 × 1350, 24 fps, exactly 576 frames (24 seconds), with an original soundtrack. Keep the soundtrack's true peak at or below −0.1 dBTP; AAC encoding can push peaks up, so leave headroom.

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
- `evidence.json`: `colours`, the two colours as `["#rrggbb", "#rrggbb"]`; and `checks`: an array of objects with `name`, `result` (`passed`, `failed` or `not-run`) and `detail`, for the checks you actually ran. Playback you did not watch is not a pass.

Fit the whole delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces out of it.

## How the two colours are checked

H.264 smears colours, so the rule is checked on `player.html`. Kitchen opens `player.html?capture` in headless Chromium with a 1080 × 1350 viewport at device scale 1, waits for `window.ready`, then for about 48 frame times chosen from a hash of the finished film, player and evidence awaits `window.seek(t)` and takes a screenshot. With `?capture` in its address the player must show the picture alone, at 1:1, filling the viewport from its top-left corner: no controls, margins, scrollbars or other pixels. Each seek may take up to 60 seconds. Every pixel of every screenshot must be one of the two colours in `evidence.json`, and both must appear.

A few of the same frames are then compared with `film.mp4` block by block, so the film must be the player's film: frame n of the film is the player at `seek(n / 24)`. Its smeared edges are expected.

Run `node validation/film.mjs` and `node validation/two-colours.mjs` from the delivery root with the fixtures mounted. Then watch the encoded film at full size and listen to it. Record anything you could not check.

## Human tasting

- Does the film find depth, light and texture in two colours, or does it look like a filter over ordinary drawing?
- Is the motion fast, and does it stay legible?
- Is the graphic language its own?
