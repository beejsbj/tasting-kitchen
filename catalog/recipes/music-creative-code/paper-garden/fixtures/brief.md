# Paper garden

## Task

A folded paper seed sits in a shallow paper pot. It unfolds into a stem, two leaves and a single flower. A small paper moth enters, lands, and its weight makes the flower dip before recovering. End in a calm held composition. Use one continuous three-quarter view; no cuts to hide transformations.

## Visual and motion direction

Layered colored paper with visible edges and restrained cast shadows. Draw every layer and shadow in code. Hinges stay attached as they open; new parts must emerge from the fold rather than fade into existence. Distinguish a stiff paper hinge from the softer stem bend. Preserve the moth silhouette through landing.

## Timing

Make exactly 24 seconds at 1080 × 1920, 24 fps (576 frames). Choose the detailed timing inside these windows; each required beat must visibly occur in its window. Do not turn the film into a sequence of still title cards.

- `seed-opens`: 3–6 seconds.
- `leaves-unfold`: 7–11 seconds.
- `flower-opens`: 12–16 seconds.
- `moth-lands`: 18–20 seconds.
- `stem-settles`: 21–23.5 seconds.

## Working protocol

Use the pinned hand-drawn skill in the supplied archive. Read `skill/SKILL.md` after extraction and use its planning, implementation and review process. All required facts and creative constraints are provided now. Work independently in one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a concept selection or delegate to another model. Use one render job and one browser at a time. Kitchen must supply an identical pinned toolchain and compute profile to every compared model. Local dependency installation is setup, not access to new film inputs.

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

- Can you track the same paper pieces through the unfolding?
- Does depth come from consistent overlap and shadow?
- Does the moth landing cause a believable response?

File validation cannot establish these visual qualities. For the queue task, state validation checks the exported function; human review must also check that the visible film uses it.
