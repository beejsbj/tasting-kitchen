# Shoot coverage, then cut

This Recipe has three parts, each its own turn. Do only the part the current turn asks for.

## Part one: the rushes

Invent a small event and film it as raw clips from at least four camera positions. Do not edit. Shoot as a director who knows the edit is not settled: later turns cut from these rushes, and there is no going back to film more.

- Put every clip in `rushes/` as `rushes/<name>.mp4`: H.264, 1920 × 1080, 24 fps. Sound is optional.
- A clip is one continuous take from one camera position. The camera may move during a take; a clip has no cut inside it.
- The rushes together run 60 to 120 seconds.
- Log them in `rushes/rushes.json`: `{ "clips": [{ "file": "rushes/<name>.mp4", "camera": "<position>", "sha256": "<hex>" }] }`, one entry per clip, `camera` naming its position. Kitchen counts positions by distinct `camera` names.
- Keep the code that renders the rushes in `source/`.

Reply with the sha256 of `rushes/rushes.json`. After this turn, `rushes/` does not change.

## Part two: the first cut

Cut a 30-second film using only the rushes.

- `cut-1.mp4`: exactly 30 seconds at 1920 × 1080, 24 fps (720 frames), H.264 with AAC sound.
- Every frame of the cut is a frame of the rushes. Choosing, ordering, trimming, holding, repeating, skipping and reversing frames is editing. Titles, grading, reframing or punching in, frames blended or drawn for the cut, and new footage are not.
- Sound may come from the rushes or be made for the cut, synthesized; it is not filming.
- `cut-1.edl.json`: every shot of the cut, `{ "fps": 24, "frames": 720, "shots": [{ "id", "start", "end", "clip", "clipStart" }] }`, in frames, `end` exclusive, tiling the cut in order; `clip` names its rushes file and `clipStart` the clip frame it starts on. Each shot after the first comes in on a hard cut unless it says `"in": { "transition": "<kind>", "frames": <n> }`; a transition's blended frames are not rushes frames, so use none.

Reply with the sha256 of `cut-1.mp4`. After this turn, `cut-1.mp4` and `cut-1.edl.json` do not change.

## Part three

The third turn brings a note on the cut. It asks for a new 30-second cut, `film.mp4` with `edl.json`, made under the same rules from the same rushes, and the delivery below.

## Working protocol

If a skill directory is mounted at `skill/`, read `skill/SKILL.md` first and follow its process; its examples teach technique and must not be submitted. If no skill is mounted, work from this brief and your own method. Each turn is one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a direction or delegate to another model. Use one render job and one browser at a time. Kitchen supplies the same pinned toolchain and compute profile to every compared model.

Draw every visible element in code, and synthesize original sound. Do not use external images, generated stills, stock footage, sampled sound, other model outputs or donor scene implementations. Keep randomness seeded.

## Deliverable after part three

- `rushes/`: the clips and `rushes.json`, unchanged since part one.
- `cut-1.mp4` and `cut-1.edl.json`: unchanged since part two.
- `film.mp4` and `edl.json`: the new cut.
- `index.html`: copy `fixtures/player.html` unchanged; it shows both cuts.
- `contact.png`: a contact sheet with one frame from every clip, labeled with its camera, and one frame from every shot of each cut, labeled with its start time.
- `source/`: all authored source, needed engine code and dependency locks.
- `README.md`: exact rebuild commands for the rushes and both cuts, the event in one sentence, a short account of what the second cut changed and why, and honest checks and limitations.
- `evidence.json`: `beats` array of `{ "id", "time" }` (seconds into a cut; say which cut in the id) pointing a taster to the moments that matter most, at least one, ids unique; `checks` array of `{ "name", "result", "detail" }` with `result` `passed`, `failed` or `not-run`. Report checks you actually ran; listening you could not do is `not-run`.

Fit the delivery, rushes included, within 100 MiB and 500 files: code-drawn pictures encode small, but grain or noise over a whole frame can make a single take larger than that. Leave dependency trees, frame caches and provider traces outside it. From the delivery root with fixtures mounted, run `node validation/film.mjs` (both cuts), `node validation/cuts.mjs` (each cut against its EDL) and `node validation/rushes.mjs` (the log, each take, and every cut frame against the rushes). Record anything you could not check.

## Human tasting

- Did the rushes cover the event well enough to be cut more than one way?
- Does the first cut tell the event clearly, and does the recut honour the note using only what was shot?
- Which coverage did the recut lean on that the first cut ignored?

File validation cannot establish these qualities.
