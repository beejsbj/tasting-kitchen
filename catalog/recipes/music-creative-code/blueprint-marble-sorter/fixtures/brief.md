# The marble sorter

## Task

Explain a fictional tabletop sorter processing four marbles in this exact order: small amber A, large blue B, small amber C, large blue D. Each marble travels alone to a gap in a rail. Small marbles fall through into a left cup; large marbles bridge the gap and continue into a right cup. End with A and C on the left and B and D on the right. Establish the complete machine first, switch to a blueprint detail to explain the size threshold, then return to the full machine. Do not invent sensors, switches or moving gates.

## Visual and motion direction

Use procedural-film drawn mode, warm paper alternating with navy blueprint plates, at 120 BPM. Use the same machine geometry and marble identities in both treatments. Small diameter is 12 units, gap width 18, large diameter 24. The fictional mechanism may simplify gravity but must show the size-dependent paths clearly. Include letter labels on the marbles and final cup counts; labels must follow the objects. Only one marble passes the sorting point at a time.

## Timing

Make exactly 24 seconds at 1080 × 1920, 24 fps (576 frames). Choose the detailed timing inside these windows; each required beat must visibly occur in its window. Do not turn the film into a sequence of still title cards.

- `establish-machine`: 1–3 seconds.
- `sort-a`: 5–7 seconds.
- `sort-b`: 9–11 seconds.
- `sort-c`: 13–15 seconds.
- `sort-d`: 17–19 seconds.
- `final-counts`: 21–23.5 seconds.

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

- Does the animation actually show why different sizes take different paths?
- Can you track all four marbles with no duplication or disappearance?
- Do paper and blueprint shots describe the same machine?

File validation cannot establish these visual qualities. For the queue task, state validation checks the exported function; human review must also check that the visible film uses it.
