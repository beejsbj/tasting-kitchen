# Queue under pressure

## Task

Explain a tiny fictional queue using the supplied states.json as the complete source of truth. The queue has three waiting slots and one separate worker. Jobs A through F arrive in order. When waiting slots are full, E and F wait outside rather than being dropped. As the worker completes jobs, the producer resumes. End with every job completed exactly once. Distinguish waiting in the queue, running, blocked at the producer and completed. Explain the meaning of backpressure through the motion and short labels.

## Visual and motion direction

Use clear flat geometry, a limited palette, persistent job letters and a readable left-to-right layout. Show capacity as three actual slots and keep the worker outside those slots. The counter reads waiting jobs / 3; running work does not count toward it. Do not animate state transitions before their listed time. Interpolate positions between states while preserving job identity. Export source/state.mjs with a pure stateAt(t) function returning exactly the latest supplied state at or before t, without its t property. Use that same function in the live film. No network, narration service or external assets; synthesize the audio.

## Timing

Make exactly 24 seconds at 1920 × 1080, 30 fps (720 frames). Choose the detailed timing inside these windows; each required beat must visibly occur in its window. Do not turn the film into a sequence of still title cards.

- `queue-fills`: 6–8 seconds.
- `producer-blocked`: 8–11 seconds.
- `producer-resumes`: 12–15 seconds.
- `all-complete`: 22–23.5 seconds.

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

- Can a viewer distinguish queue capacity from a busy worker?
- Does the visible film match the supplied trace, including blocked jobs?
- Can you explain backpressure after watching without reading the source?

File validation cannot establish these visual qualities. For the queue task, state validation checks the exported function; human review must also check that the visible film uses it.
