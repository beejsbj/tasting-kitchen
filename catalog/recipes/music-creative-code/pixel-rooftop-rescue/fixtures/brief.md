# Rooftop rescue

## Task

A tiny maintenance robot spots a stranded wind-up bird across a rooftop gap. The robot tests the gap, extends a plank, crosses, winds the bird, and watches it fly to a safe antenna. Show the robot return to a stable pose. The plank remains visible after extension; no teleportation or unexplained platform changes.

## Visual and motion direction

Use procedural-film retro mode: native 320 by 180 pixels, enlarged exactly six times with nearest-neighbor sampling to 1920 by 1080. Use the engine NES palette and at most three nontransparent colors per sprite. Omit the optional CRT so pixel edges stay inspectable. Ten bars at chip speed 9 give exactly 24 seconds at 60 fps. Author original chip music and sound cues. Keep critical limbs and the winding key legible at native size; feet and wheels contact the rooftop.

## Timing

Make exactly 24 seconds at 1920 × 1080, 60 fps (1440 frames). Choose the detailed timing inside these windows; each required beat must visibly occur in its window. Do not turn the film into a sequence of still title cards.

- `spot-bird`: 2–4 seconds.
- `test-gap`: 5–8 seconds.
- `extend-plank`: 9–12 seconds.
- `wind-bird`: 16–19 seconds.
- `bird-departs`: 21–23.5 seconds.

## Working protocol

Use the pinned procedural skill in the supplied archive. Read `skill/SKILL.md` after extraction and use its planning, implementation and review process. All required facts and creative constraints are provided now. Work independently in one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a concept selection or delegate to another model. Use one render job and one browser at a time. Kitchen must supply an identical pinned toolchain and compute profile to every compared model. Local dependency installation is setup, not access to new film inputs.

Draw every visible element in code, and synthesize original sound. Do not use external images, generated stills, stock footage, sampled music, other model outputs or donor scene implementations. Pinned examples teach the technique; the submitted scene must be newly authored. No network calls at playback. Keep randomness seeded and make the live picture a pure function of time; expose `window.seek(t)` and a readiness promise `window.ready`. Include working play/pause and an explicit user gesture to start sound.

## Deliverable

- `film.mp4`: H.264 with AAC audio, exact dimensions and frame count above.
- `player.html`: self-contained live code animation and synthesized sound, matching the export.
- `index.html`: copy `fixtures/player.html` unchanged; Kitchen supplies the comparison presentation.
- `contact.png`: a labeled contact sheet with at least one frame per required beat.
- `source/`: all authored source, needed engine code and dependency locks.
- `README.md`: exact rebuild commands, source attribution and honest checks/limitations.
- `evidence.json`: `beats` array of objects containing `id` and `time` (seconds) for every contract beat; `checks` array containing `name`, `result` (`passed`, `failed` or `not-run`) and `detail`. Report actual checks; unseen playback is not a pass. These are review pointers, not proof that the action looks correct.

Fit the complete delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces outside it. Run `node validation/film.mjs` from the delivery root with fixtures mounted. Independently inspect complete motion, listen to sound, check the final encoded movie and inspect the native-size or phone-size picture. Record anything unavailable.

## Human tasting

- Can you read the action at native pixel size?
- Do crossings and contacts remain consistent frame to frame?
- Do chip sounds reinforce real events without overwhelming the scene?

File validation cannot establish these visual qualities. For the queue task, state validation checks the exported function; human review must also check that the visible film uses it.
