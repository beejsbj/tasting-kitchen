# Night market delivery

## Task

A bicycle courier carries a small wrapped parcel through a night market and delivers it to a waiting tea seller. Track sideways past three stalls, briefly pass behind a hanging banner, then ease the camera to a stop as the courier brakes and hands over the parcel. End with a warm lamp pool and a readable exchange. Create an original market, not a variation of a supplied film.

## Visual and motion direction

Use exactly three chosen ink colors plus paper; overprints may create derived colors. Print grain and registration offsets are attached to the artwork, not fresh random noise every frame. Build near hanging decorations, middle-distance action and far stalls with distinct parallax. The bicycle wheels must agree with travel; stopping must affect rider pose and camera speed. Create entirely synthesized original sound.

## Timing

Make exactly 24 seconds at 1080 × 1080, 30 fps (720 frames). Choose the detailed timing inside these windows; each required beat must visibly occur in its window. Do not turn the film into a sequence of still title cards.

- `depart`: 2–4 seconds.
- `three-depths`: 6–9 seconds.
- `banner-occlusion`: 10–13 seconds.
- `brake`: 15–18 seconds.
- `handover`: 20–23.5 seconds.

## Working protocol

If a skill directory is mounted at `skill/`, read `skill/SKILL.md` first and follow its planning, implementation and review process; its examples teach technique and must not be submitted. If no skill is mounted, work from this brief and your own method. All required facts and creative constraints are provided now. Work independently in one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a concept selection or delegate to another model. Use one render job and one browser at a time. Kitchen must supply an identical pinned toolchain and compute profile to every compared model. Local dependency installation is setup, not access to new film inputs.

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

- Does it feel printed without grain flicker or distracting misregistration?
- Are the depth layers and courier readable during camera travel?
- Do wheel speed, braking and the parcel exchange hold together?

File validation cannot establish these visual qualities. For the queue task, state validation checks the exported function; human review must also check that the visible film uses it.
