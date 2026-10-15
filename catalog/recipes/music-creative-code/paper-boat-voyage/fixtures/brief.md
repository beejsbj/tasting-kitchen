# A Little Voyage

## Task

Make an original 24-second vertical film. A paper boat is folded on a desk, launched into a rainy puddle, survives a small swirl using a fallen leaf as a sail, and rests safely beside a warm lantern on the bank. Let the actions explain the story; stage them clearly enough to read on a phone. Choose the artistic details yourself. No captions or dialogue.

## Visual and motion direction

Every visible element is drawn in code and the soundtrack is synthesized. Show the fold as a sequence of real creases, the launch as a contact with water, the swirl as a force the boat resists, and the leaf as something found and used. Keep the boat's silhouette recognizable throughout.

## Timing

Make exactly 24 seconds at 1080 × 1920, 24 fps (576 frames). Choose the detailed timing inside these windows; each required beat must visibly occur in its window. Do not turn the film into a sequence of still title cards.

- `fold`: 1–5 seconds.
- `launch`: 6–9 seconds.
- `swirl`: 11–15 seconds.
- `leaf-sail`: 13–18 seconds.
- `lantern`: 20–23.5 seconds.

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

- Does the fold read as paper being creased rather than a shape appearing?
- Does the swirl feel like a force and the leaf like a found solution?
- Is the arrival at the lantern a rest, with a change of pace you can feel?

File validation cannot establish these visual qualities.
