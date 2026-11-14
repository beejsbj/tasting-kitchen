# The thing we never see

## Task

Something decisive happens in this 25-second film and it is never on screen. We learn it from before, after, sound and reactions.

What happens, to whom, and how the film looks are yours to decide. No captions, title cards, dialogue text or narration that states it.

End `README.md` with one line, `Unseen: <one line>`, naming what happened. Tasters watch the film before they read it.

## Format

Exactly 25 seconds at 1920 × 1080, 24 fps (600 frames), H.264 with AAC sound.

## The edit

List every shot in `edl.json`: `{ "fps": 24, "frames": 600, "shots": [{ "id", "start", "end" }] }`, in frames, `end` exclusive, the shots tiling the film in order. Each shot after the first comes in on a hard cut unless it says `"in": { "transition": "<kind>", "frames": <n> }`. One continuous shot is one entry.

Kitchen finds the hard cuts in the picture with FFmpeg (`validation/cuts.mjs`) and compares them with `edl.json`, within one frame. Declare every hard cut, including a one-frame flash or a light that changes the whole frame at once, and nothing that is not one. Grain or motion as large as the cut itself can hide a cut from the check.

## Working protocol

If a skill directory is mounted at `skill/`, read `skill/SKILL.md` first and follow its process; its examples teach technique and must not be submitted. If no skill is mounted, work from this brief and your own method. All required facts and constraints are provided now. Work independently in one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a direction or delegate to another model. Use one render job and one browser at a time. Kitchen supplies the same pinned toolchain and compute profile to every compared model.

Draw every visible element in code, and synthesize original sound. Do not use external images, generated stills, stock footage, sampled sound, other model outputs or donor scene implementations. No network calls at playback. Keep randomness seeded and make the live picture a pure function of time; expose `window.seek(t)` and a readiness promise `window.ready`. Include working play/pause and an explicit user gesture to start sound.

## Deliverable

- `film.mp4`: H.264 with AAC sound, exact dimensions and frame count above.
- `edl.json`: the shot list above.
- `player.html`: self-contained live code animation and synthesized sound, matching the export.
- `index.html`: copy `fixtures/player.html` unchanged; Kitchen supplies the comparison presentation.
- `contact.png`: a contact sheet with one frame from every shot, each labeled with its start time.
- `source/`: all authored source, needed engine code and dependency locks.
- `README.md`: exact rebuild commands, honest checks and limitations, and last of all the `Unseen:` line.
- `evidence.json`: `beats` array of `{ "id", "time" }` (seconds) pointing a taster to the moments that carry the unseen event, at least one, ids unique; `checks` array of `{ "name", "result", "detail" }` with `result` `passed`, `failed` or `not-run`. Report checks you actually ran; listening you could not do is `not-run`.

Fit the delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces outside it. Run `node validation/film.mjs` and `node validation/cuts.mjs` from the delivery root with fixtures mounted. Inspect the complete motion and the final encoded movie, listen if you can, and record anything you could not check.

## Human tasting

- Before reading the README: what do you think happened, and how sure are you?
- Which shots, sounds and reactions told you, and was any of it said too plainly?
- After reading it: was the film fair to you?

File validation cannot establish these qualities.
