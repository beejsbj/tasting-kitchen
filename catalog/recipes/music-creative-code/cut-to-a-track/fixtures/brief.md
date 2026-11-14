# Cut to a track

## Task

Here are 30 seconds of sound. Make a picture for it. Do not change the sound. Decide where to cut with the music and where to cut against it.

What the film shows, and how it looks, is yours to decide.

## Supplied inputs

- `inputs/track.wav`: 30 seconds, 48 kHz stereo PCM. It is the film's whole soundtrack, unchanged: same start, same length, same level, encoded as AAC. Add nothing to it, and do not trim, move, fade, re-order or limit it. It peaks at −2 dBFS, so it needs no trim.
- `inputs/cues.json`: Kitchen's timing for the track, written with it from the composition: the tempo grid (`grid`, 100 BPM), the start of every sound (`onsets`: time, kind, relative strength) and a per-frame loudness envelope (`envelope`). Use it as given; beat detection is not part of this task.

Kitchen compares your soundtrack with the track using `validation/audio-identity.mjs`: aligned within 20 ms, matching in every audible half-second, nothing added in its silences, the same length and the same level within 0.5 dB.

## Format

Exactly 30 seconds at 1920 × 1080, 24 fps (720 frames), H.264 with the track as AAC.

## The edit

List every shot in `edl.json`: `{ "fps": 24, "frames": 720, "shots": [{ "id", "start", "end" }] }`, in frames, `end` exclusive, the shots tiling the film in order. Each shot after the first comes in on a hard cut unless it says `"in": { "transition": "<kind>", "frames": <n> }`.

Kitchen finds the hard cuts in the picture with FFmpeg (`validation/cuts.mjs`) and compares them with `edl.json`, within one frame. Declare every hard cut, including a one-frame flash or a light that changes the whole frame at once, and nothing that is not one. Grain or motion as large as the cut itself can hide a cut from the check. Kitchen also reports how far each cut falls from the nearest cue; that is for the taster, not a target.

## Working protocol

If a skill directory is mounted at `skill/`, read `skill/SKILL.md` first and follow its process; its examples teach technique and must not be submitted. If no skill is mounted, work from this brief and your own method. All required facts and constraints are provided now. Work independently in one autonomous authoring turn, including tool use and up to three render/inspect/revise rounds. Do not ask for a direction or delegate to another model. Use one render job and one browser at a time. Kitchen supplies the same pinned toolchain and compute profile to every compared model.

Draw every visible element in code. Do not use external images, generated stills, stock footage, other model outputs or donor scene implementations. No network calls at playback. Keep randomness seeded and make the live picture a pure function of time; expose `window.seek(t)` and a readiness promise `window.ready`. Include working play/pause and an explicit user gesture to start sound.

## Deliverable

- `film.mp4`: H.264 with the track as AAC, exact dimensions and frame count above.
- `edl.json`: the shot list above.
- `player.html`: the live code picture with the track, matching the export. Copy the track into `source/` if the player needs it.
- `index.html`: copy `fixtures/player.html` unchanged; Kitchen supplies the comparison presentation.
- `contact.png`: a contact sheet with one frame from every shot, each labeled with its start time.
- `source/`: all authored source, needed engine code and dependency locks.
- `README.md`: exact rebuild commands, a short account of where you cut with the music and where against it and why, and honest checks and limitations.
- `evidence.json`: `beats` array of `{ "id", "time" }` (seconds) pointing a taster to the moments that matter most, at least one, ids unique; `checks` array of `{ "name", "result", "detail" }` with `result` `passed`, `failed` or `not-run`. Report checks you actually ran; listening you could not do is `not-run`.

Fit the delivery within 100 MiB and 500 files. Leave dependency trees, frame caches and provider traces outside it. Run `node validation/film.mjs`, `node validation/audio-identity.mjs` and `node validation/cuts.mjs` from the delivery root with fixtures and inputs mounted. Inspect the complete motion and the final encoded movie, and record anything you could not check.

## Human tasting

- Where does the picture agree with the music and where does it argue, and do both feel chosen?
- With the sound off, does the cutting keep a rhythm of its own?
- Does the README's account of the cutting match what you see?

File validation cannot establish these qualities.
