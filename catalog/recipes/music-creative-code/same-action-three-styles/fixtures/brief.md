# Same action, three styles

## Task

Choose one physical action that takes about eight seconds. Show it three times, each time in a radically different visual language. Hard cuts at exactly 8 and 16 seconds separate the three versions.

Each version may re-time, re-frame and re-edit the action, but a viewer must recognise it as the same action every time. A change of palette or filter over the same drawing is not a different visual language. The action, the three languages and the sound are yours to choose.

## Format

Exactly 24 seconds at 1920 × 1080, 24 fps (576 frames), H.264 with AAC sound. The versions run frames 0–191, 192–383 and 384–575.

## The edit

List every shot in `edl.json`: `{ "fps": 24, "frames": 576, "shots": [{ "id", "start", "end" }] }`, in frames, `end` exclusive, the shots tiling the film in order. Each shot after the first comes in on a hard cut unless it says `"in": { "transition": "<kind>", "frames": <n> }`. Shots must come in on hard cuts at frames 192 and 384; inside a version, cut as you like.

Kitchen finds the hard cuts in the picture with FFmpeg (`validation/cuts.mjs`) and compares them with `edl.json`, within one frame. Declare every hard cut, including a one-frame flash or a light that changes the whole frame at once, and nothing that is not one. A cut too small to see, or barely larger than the grain or motion around it, can go unconfirmed.

## Working protocol

If a skill directory is mounted at `skill/`, read `skill/SKILL.md` first and follow its process; its examples teach technique and must not be submitted. If no skill is mounted, work from this brief and your own method. All required facts and constraints are provided now. Work independently in one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a direction or delegate to another model. Use one render job and one browser at a time. Kitchen supplies the same pinned toolchain and compute profile to every compared model.

Draw every visible element in code, and synthesize original sound. Do not use external images, generated stills, stock footage, sampled sound, other model outputs or donor scene implementations. No network calls at playback. Keep randomness seeded and make the live picture a pure function of time; expose `window.seek(t)` and a readiness promise `window.ready`. Include working play/pause and an explicit user gesture to start sound.

## Deliverable

- `film.mp4`: H.264 with AAC sound, exact dimensions and frame count above.
- `edl.json`: the shot list above.
- `player.html`: self-contained live code animation and synthesized sound, matching the export.
- `index.html`: copy `fixtures/player.html` unchanged; Kitchen supplies the comparison presentation.
- `contact.png`: a contact sheet with the same moment of the action in each version side by side, plus one frame from every shot, each labeled with its time.
- `source/`: all authored source, needed engine code and dependency locks.
- `README.md`: exact rebuild commands, the action and the three visual languages in a sentence each, and honest checks and limitations.
- `evidence.json`: `beats` array of `{ "id", "time" }` (seconds) pointing a taster to the moments that matter most, at least one, ids unique; `checks` array of `{ "name", "result", "detail" }` with `result` `passed`, `failed` or `not-run`. Report checks you actually ran; listening you could not do is `not-run`.

Fit the delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces outside it. Run `node validation/film.mjs` and `node validation/cuts.mjs` from the delivery root with fixtures mounted. Inspect the complete motion and the final encoded movie, listen if you can, and record anything you could not check.

## Human tasting

- Are the three visual languages truly different ways of seeing, or one drawing restyled?
- Is the action recognisably the same each time, and what did each version choose to stress?
- Does each version's timing and framing belong to its language?

File validation cannot establish these qualities.
