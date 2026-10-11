# Words with weight

## Task

Make a typographic mini-film using only these on-screen words, once each and in this order: STRETCH, FALL, HOLD, RELEASE. STRETCH visibly extends then recovers; FALL accelerates to a floor and settles; HOLD becomes completely still under visible tension; RELEASE resolves that tension into a clean, spacious final composition. Do not add a title, slogan, logo, UI or extra copy.

## Visual and motion direction

One type family, two ink colors plus background, crisp vector-like edges. Shapes may establish floor and tension, but the words carry the action. STRETCH is active during seconds 0–6, FALL during 6–12, HOLD during 12–18, RELEASE during 18–24. Each word needs at least 1.5 continuous seconds fully readable. HOLD must contain at least two continuous seconds of true stillness. Retain the final RELEASE pose from second 22 to the end. Choose different motion curves for elastic stretch, gravity, restraint and release. Use original synthesized audio with sound cues tied to the same timeline.

## Timing

Make exactly 24 seconds at 1080 × 1920, 60 fps (1440 frames). Choose the detailed timing inside these windows; each required beat must visibly occur in its window. Do not turn the film into a sequence of still title cards.

- `stretch-readable`: 2–5 seconds.
- `fall-contact`: 8–10 seconds.
- `hold-still`: 14–16 seconds.
- `release`: 18–21 seconds.
- `final-hold`: 22–23.5 seconds.

## Working protocol

Use the pinned motion-reel skill in the supplied archive. Read `skill/SKILL.md` after extraction and use its planning, implementation and review process. All required facts and creative constraints are provided now. Work independently in one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a concept selection or delegate to another model. Use one render job and one browser at a time. Kitchen must supply an identical pinned toolchain and compute profile to every compared model. Local dependency installation is setup, not access to new film inputs.

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

- Is the exact copy readable at phone size for long enough?
- Do the four verbs have meaningfully different motion?
- Do stillness and the final hold create an intentional rhythm?

File validation cannot establish these visual qualities. For the queue task, state validation checks the exported function; human review must also check that the visible film uses it.
