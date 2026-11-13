# The music room: a pilot arena

Status: **pilot. One draft Recipe (`play-a-short-set`) awaiting Burooj's authoring acceptance; not cookable; no model has played in it.** Built 2026-11-13 for [#79](https://github.com/beejsbj/tasting-kitchen/issues/79).

## What an arena is

Every other Recipe asks a model to make something. An arena supplies a world, and what gets tasted is what the model does in it over time.

Settled before this pilot, and not reopened here:

- Each model performs alone in the same world. One Run, one Dish per model.
- The world waits while the model thinks.
- The model steps the world itself, from inside its harness, by running a Kitchen-supplied command. Kitchen does not call the model per tick. Any harness with a shell can do this.
- The recording of what happened is the Dish. Time taken is a receipt, never a ranking.

"Arena" is the working word from the issue. Nothing in the schema is named after it: the room is equipment mounted as fixtures, and `play-a-short-set` is an ordinary Recipe with an ordinary output contract and checks.

## The room

The music room is a live set performed in steps, with Strudel as the instrument and no audio.

| Mounted at | What it is |
| --- | --- |
| `room/room.mjs` | The room: `play`, `status`, `heard`, `check` |
| `room/README.md` | Commands, rules, sounds, the printout and a short syntax crib |
| `room/player.html` | The player page the room renders a set into |
| `room/strudel/strudel.mjs` | Strudel's pattern engine (core, mini, tonal, transpiler 1.2.6), for evaluating patterns in Node |
| `room/strudel/superdough.js`, `worklets.js` | superdough 1.3.0, Strudel's synth, for the player |
| `room/strudel/manifest.json`, `THIRD-PARTY-NOTICES.md`, `room/LICENSE`, `room/NOTICE.md` | Provenance and licence |

The rules are constants in `room.mjs` (`ROOM`) and are part of every recording:

- A set is **12 steps of 8 cycles**. At the starting tempo (0.5 cycles per second) that is 16 seconds a step and 3 minutes 12 seconds a set.
- A pattern may change the tempo with `setcps` or `setcpm`, between 0.25 and 1 cycles per second, so a set lasts between about 1½ and 6½ minutes.
- Sounds are synthesis only: `sine`, `triangle`, `square`, `sawtooth` (and their short names), `supersaw`, `pulse`, `white`, `pink`, `brown`, `crackle`, and the synthesized kick `sbd`. There are no samples.
- A pattern is at most 8192 bytes and a step at most 2048 events.

## The step loop

The model writes a Strudel pattern to a file and runs `node room/room.mjs play <file>`. The room then:

1. takes a lock, and loads `recording.json`, which must match the room's journal (below);
2. evaluates the code with Strudel's own `repl` and transpiler, headless, so `$:` layers, `setcpm`, mini-notation and scales behave as they do in the Strudel editor;
3. queries the pattern over this step's cycles. Cycle time is global: step 3 is cycles 16 to 24, so `<a b c>` and `.slow(16)` carry on where they were, and the tempo carries from the step before;
4. keeps every event that starts in the step, as `[begin, end, controls]`, where `end` is where the event stops sounding once Strudel has applied `clip`, `legato` and `duration`;
5. measures those events into the printout, seals the entry into the hash chain, appends its hash to the journal, and writes `recording.json`, `index.html` and `worklets.js`;
6. prints the printout.

There is no preview and no undo. A pattern the room cannot play (it does not evaluate, uses a sound the room lacks, leaves the tempo range, or is too large) is **refused**: the reason is printed, the refusal is recorded with its code, and no step is used. Without a preview, charging a step for a typo would make a set mostly a test of syntax recall.

`Math.random` is replaced by a generator seeded with the step number while a step is evaluated, so a pattern that uses it plays the same when the check evaluates it again. Strudel's own `rand` and `degradeBy` are already functions of cycle time.

### The printout

The printout is how the model hears. It is JSON and holds only numbers measured from the step's events:

- where the step sits: `cycles`, `cps`, `seconds`, and how many steps remain;
- density: `events`, `perCycle`, `perSecond`;
- register: `pitch` (lowest, highest and mean MIDI note, pitch classes) and `lengths`;
- `controls`: the lowest and highest value of each numeric control that was set;
- `bars`: for each cycle, each sound with its onsets (positions in the cycle) and the MIDI note at each onset. A cycle identical to an earlier one in the step is printed as `sameAs`.

It carries no advice and no judgement. A test fails if such words appear in it.

## The recording

`recording.json` is the record of everything that happened in the room. It is called a recording, not a trace, because every Dish already has a `trace.json`: the Run's public transcript.

```json
{
  "schemaVersion": 1,
  "room": { "id": "music-room", "version": 1, "steps": 12, "cyclesPerStep": 8, "cps": { "initial": 0.5, "min": 0.25, "max": 1 },
            "maxEventsPerStep": 2048, "maxCodeBytes": 8192, "sounds": ["sine", "..."],
            "program": { "room.mjs": "...", "player.html": "..." },
            "engine": { "strudel": "1.2.6", "superdough": "1.3.0", "license": "AGPL-3.0-or-later", "sha256": { "strudel.mjs": "...", "superdough.js": "...", "worklets.js": "..." } } },
  "genesis": "sha256 of the room header",
  "entries": [
    { "index": 0, "kind": "refused", "step": 1, "at": "2026-11-13T19:02:11.000Z", "prev": "<genesis>", "code": "...", "error": "sound \"bd\" is not in this room", "hash": "..." },
    { "index": 1, "kind": "step", "step": 1, "at": "...", "prev": "<hash of entry 0>", "code": "...", "cps": 0.5, "cycles": [0, 8], "seconds": [0, 16],
      "events": [[0, 0.5, { "note": "c3", "s": "sine" }]], "heard": { "...": "the printout" }, "hash": "..." }
  ],
  "head": "hash of the last entry",
  "complete": false
}
```

Each entry's `hash` is the SHA-256 of its own content, including `prev`, as JSON with sorted keys. `at` is when the play was committed; the gaps between entries are receipts of how long the model took between steps.

The room also appends each entry's hash to `.room/journal`. A `play` refuses to continue when `recording.json` is missing or does not match the journal, so deleting the recording to start over, or cutting a regretted step out of it, stops the room rather than passing quietly. That catches the honest mistake, not a determined one (see below). `.room/` is working state and is not part of the Dish.

A play is written in three moves: the next recording is set aside in `.room/`, its hash joins the journal, then the recording and the player are put in place. A play killed between the last two is finished the next time the room is used. The lock names the process that holds it, so a killed play does not close the room.

## What the checks prove

`node room/room.mjs check` is the Recipe's one required command check. It is deterministic and looks at nothing musical:

| Check | What it establishes |
| --- | --- |
| `well-formed` | `recording.json` is JSON with exactly the expected fields and types |
| `this-room` | it names this room: the same rules, and the same program, player and engine bytes that are mounted |
| `chain` | every entry's hash and `prev` hold from the genesis to the head |
| `journal` | the entries are exactly the plays the room's journal remembers |
| `steps` | there are exactly 12 steps, in order, and the set is marked complete |
| `evaluates` | each step's code, evaluated again from the recording alone with the tempo the set had reached, plays exactly the recorded events, tempo, timing and printout |
| `player` | `index.html` is the room's own rendering of this recording, and `worklets.js` is the room's copy |

The check runs the model's code a second time, so each step is evaluated in a child process under Node's permission model: it may read `room/` and nothing else, and cannot write or start programs. A pattern that only plays when it can reach other files is therefore not a pattern, and a step that tries to rewrite the player while it is being checked fails `evaluates`. The `player` comparison runs last and against the room the recording names.

Kitchen's existing gates sit around it. Every file under `room/` is a non-editable fixture, so editing the room or its checker is an `output-contract` chef fault before the check runs. The Dish then goes through the usual publication scans.

Tests cover the edits these catch: an edited step with stale hashes (`chain`), the same edit with every hash and the journal recomputed (`evaluates`), edited events, a recording claiming other rules, a journal with an unseen play, and an altered player page.

### What they do not prove

- Anything musical. That is tasting.
- That the model read the printouts, or played one step at a time. A model can play twelve prepared patterns in one shell loop; the `at` receipts show it, and the brief only asks it not to.
- That the recording could not have been forged, or that there was no preview and no undo. The model has a shell and the room's source, and none of the following shows in the Dish:
  - **restart**: delete both the recording and the journal and play again;
  - **undo**: keep a copy of `recording.json`, play, put the copy back and cut the last line from the journal;
  - **preview**: copy the folder and play in the copy, or call the room's functions directly.

  This is integrity against accident and casual editing, not security. "No preview, no undo" is a rule the brief states and the room makes awkward, not one it enforces. Closing it needs Kitchen to hold the journal outside the workspace, which no harness adapter offers today.
- That a refused pattern would still be refused. Refused entries are covered by the chain and the journal only, because error text can differ between Node versions.

## The Dish and its player

The Dish is three files the room writes itself: `index.html`, `recording.json` and `worklets.js`. The model delivers nothing by hand.

`index.html` replays the whole set as sound and shows the code changing: a piano roll of the set with a playhead, the twelve steps to jump between, and for the step under the playhead its code with the lines that changed marked, the printout the model was given, any patterns the room refused before it, and when it was played.

The player **schedules the recorded events** through superdough. It does not evaluate the model's code in the browser. That is deliberate:

- the Dish content policy has no `unsafe-eval`, and Strudel evaluates patterns with `Function`;
- the events are what the check verified, so what is heard is what was recorded.

### Playback in the gallery sandbox

A web Dish is shown in `<iframe sandbox="allow-scripts allow-forms">` (no `allow-same-origin`), and `/dishes/` is served with `Content-Security-Policy: sandbox allow-scripts allow-forms; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; …` and `Access-Control-Allow-Origin: *`.

`scripts/verify-music-room-browser.mjs` plays two hand-written sample sets through the room, serves the result with exactly those headers (read from `vercel.json`) inside exactly that iframe (the attribute is read from `ArtifactPane.tsx`), and drives it in headless Chromium with every other host made unresolvable. Measured on 2026-11-13 with Chromium 153:

- the frame's origin is `null`, and the only requests are the host page, `index.html` and `worklets.js`;
- AudioWorklet processors load, and between them the two sets put all eleven sounds of the room through the synth with no event failing;
- every step of both sets measures sound on an analyser at the output, and pause suspends the audio clock;
- with `--full`, one set played from start to finish in real time: all 1877 of its events were scheduled once and none failed.

Two things made this work, and both are constraints on any future player:

- **No inlined worklets.** superdough normally loads its worklets from a `data:` URL, which that policy refuses for scripts. The vendored build points it at `worklets.js` beside the page instead.
- **The CORS header is load-bearing.** A sandboxed page has an opaque origin, so even its own sibling file is a cross-origin fetch. Without `Access-Control-Allow-Origin` on `/dishes/` the worklets do not load. The script records that case too: the page still plays, and says in a notice which sounds are missing (about one event in eight failed in the sample).

The player uses superdough's own synths and Strudel's own event lengths, so a set should sound as it would in Strudel. Scheduling is the player's own, though, and nobody has yet compared it by ear against the Strudel editor, so treat that as intended, not shown.

`node scripts/verify-music-room-browser.mjs --serve` keeps the sample sets up at a local address, in the same sandbox, to listen by hand.

## Licence

Strudel, superdough and kabelsalat are **AGPL-3.0-or-later**. This repository has no licence file of its own.

What this pilot does to meet the AGPL's terms:

- The licence text travels with the equipment (`room/LICENSE`), with the notices of every bundled MIT, BSD and ISC package.
- The bundles are unminified, built by `scripts/vendor-music-room.mjs` from registry packages pinned by sha512 in `manifest.json`, and the two build-time modifications are stated in each bundle's header, the manifest and `NOTICE.md`.
- `room.mjs` and `player.html` link or embed the engine, so `NOTICE.md` offers the whole `room/` directory, and the `index.html` and `worklets.js` the room writes, under the same licence.
- Every published Dish carries the room as `inputs/room/`, so the source and licence sit beside the object code, and the player's footer says where.

What follows from that, for Burooj to accept or decline:

1. **`room.mjs` and `player.html`, Kitchen's own work, become AGPL-3.0-or-later.** They live in one directory with their own notice. The runner and the gallery only copy those files and run the room as a separate program, which the AGPL treats as an aggregate, so it does not extend to them. The room's own tests and browser check import from `room.mjs` and fall under the same notice.
2. **Every Dish of this Recipe publishes AGPL code** (the player page) on the public gallery, with its source alongside.
3. A model's patterns and the recording of them are treated as that model's output, not as a derivative of Strudel. That is the usual reading of programs written against an interpreter, not legal advice.

This is a reading of the licence by an engineer, not a lawyer's opinion.

## Size, and where equipment lives

| Piece | Bytes |
| --- | --- |
| `strudel.mjs` | 1,025,976 |
| `superdough.js` | 89,313 |
| `worklets.js` | 84,320 |
| `LICENSE`, notices, manifest | 70,502 |
| `room.mjs`, `player.html`, `README.md`, `NOTICE.md` | about 50,000 |
| **Mounted room** | **about 1.3 MB** |

A sample Dish artifact is 0.4 to 0.55 MB (`index.html` holds the synth and the recording; `recording.json` is 100 to 175 kB).

The repository has two homes for supplied equipment:

- **Recipe fixtures**: hashed into the recipe hash, verified unchanged after the Run, and published byte-for-byte in each Dish's `inputs/`. Third-party fixtures go under `fixtures/upstream/`, which lint already ignores.
- **A toolchain** (`catalog/toolchains/<name>/`): a pinned Docker image the Run is checked in, with an engine copied to `toolchain.engineMount`. The film Recipes use this. The engine is not verified after the Run and is published only as a pin.

The room is plain Node and must run in any harness with a shell and without Docker, so the pilot uses fixtures, in the Recipe's own directory. That costs about 1.3 MB of `inputs/` in every Dish, and a second Recipe in the room would duplicate the equipment. When that second Recipe arrives, the room should move to a shared, hash-pinned home: a toolchain kind with no image, whose files are copied to the engine mount, verified by tree hash after the Run as a skill layer is, and published as a pin. That is a runner change and was left out of the pilot.

## Authoring checkpoint for `play-a-short-set`

Per `AGENTS.md`, for Burooj to accept, change or reject:

- **Task.** Play a short live set in the music room: twelve steps, hearing each only as numbers.
- **Why return to it.** It shows how a model behaves over time rather than what it can assemble: whether it listens, how it builds and ends, what it does after a refusal, whether it plans or responds.
- **Lineage.** Hybrid: a live-coded set is a familiar task; the room and hearing by numbers are his arena idea.
- **Structure.** One prompt turn. The loop lives inside the turn, driven by the model. A staged sibling would be a different Recipe. It is not on the `music` Menu: those fourteen are made things heard in seconds, and this is a different kind.
- **Fixture source.** Kitchen-written room; Strudel vendored from its published packages. Nothing private.
- **Deliverable.** Nothing by hand: the room writes the player, the recording and the worklets.
- **Acceptance boundary.** `room.mjs check`, described above. Nothing musical.
- **Presentation.** `static-web-v1`: the supplied player in the gallery iframe.

## Left open

- **Showing several models' sets together.** Every recording of one recipe hash shares the same step and cycle grid, and `/dishes/` is readable cross-origin, so a Recipe-level view could fetch each Dish's `recording.json` and draw the sets on one step axis: a piano-roll lane per model, and per-step lines for density, register, voices and tempo, which are already in each `heard`. That is where sets would read as character the way overlaid tracks did in the sailing sim. Listening stays one set at a time; a shared transport would need the gallery to message the sandboxed players. None of this is built.
- **A "build the world" Recipe and the subagent toggle.** The issue's order was: a Recipe that asks a model to build a world, a switch that lets it use subagents so that Recipe can be cooked with and without, then promoting the best world into a fixture for a second Recipe. This pilot did the last step first, with a Kitchen-written world, to find what a world has to provide: a step command, a raw printout, a recording with integrity, a deterministic check, a player that survives the sandbox, and licence-clean equipment. That list is the output contract a build-the-world Recipe would set, and the browser script is the shape of its acceptance check. The subagent switch belongs to the configuration, like memory and connections, so with and without are two configurations and never Repeats. It bears on building a world. Playing in one stays solitary.
- **Restart, undo, preview and time.** See "What they do not prove". A declared `budget` would bound a set that never ends; none is declared.
- **A step that makes no events.** Code whose result is not a pattern, or whose last line is `setcpm(…)`, is played as silence and uses a step, as the Strudel editor would. The printout shows `events: 0` at once, but the step is spent. Refusing such a step unless the code says `silence` would spare a typo and would also refuse a deliberate rest written another way. Burooj's call.
- **Before Ready.** The Recipe Book lists the public text fixtures of Ready Recipes as editable supplied files. The 1 MB engine should not be edited there; equipment needs excluding from Book edits or the shared home above. A private provenance record for the Recipe is also needed on the Kitchen host.
- **Text the public scan refuses.** A model's pattern is published inside the recording. A comment using the word for written music that the scan reads as ranking language, or mini-notation shaped like a path such as `"[c3 e3]/2/3"`, would fail publication as a Kitchen fault. The scan does not know it is reading music.
- **By ear.** Nobody has listened to the sample sets. The browser check measures that sound comes out, not what it is.
