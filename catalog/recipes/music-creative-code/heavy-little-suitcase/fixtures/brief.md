# Heavy little suitcase

## Task

A small traveler tries to lift an oversized suitcase onto a low platform. The first pull fails; the traveler resets their stance, tilts the case and levers it up using its lower corner. They climb after it, sit, and let out a relieved breath. Keep one locked camera and one continuous shot. No captions, dialogue, magical strength or sudden size changes.

## Visual and motion direction

Soft graphite on warm paper, one restrained accent on the suitcase tag. Preserve the character and prop silhouettes. Show anticipation before force, planted feet during effort, a pivot at the suitcase corner, and a short settle after the landing. Pencil texture may breathe gently; anatomy and contact points must stay coherent.

## Timing

Make exactly 24 seconds at 1080 × 1920, 24 fps (576 frames). Choose the detailed timing inside these windows; each required beat must visibly occur in its window. Do not turn the film into a sequence of still title cards.

- `failed-lift`: 4–7 seconds.
- `reset`: 8–11 seconds.
- `corner-pivot`: 12–17 seconds.
- `landing`: 18–20 seconds.
- `relief`: 21–23.5 seconds.

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

- Can you tell the case is heavy with sound muted?
- Do feet and the pivot stay attached to the ground during force?
- Does the second attempt visibly use a different strategy?

File validation cannot establish these visual qualities. For the queue task, state validation checks the exported function; human review must also check that the visible film uses it.
