# Play a short set

You are in a music room. The instrument is Strudel, the live-coding pattern language. Play a short live set on it.

## How the room works

- A set is 12 steps. Each step is 8 cycles of music, about 16 seconds at the starting tempo.
- To play a step, write a Strudel pattern to a file and run `node room/room.mjs play <file>`.
- The room commits the step and prints what just sounded: for every cycle, the onsets, pitches and sounds, as numbers. There is no audio here. That printout is how you hear.
- A committed step cannot be changed or played again. This is a performance, not a composition.
- A pattern the room cannot play is refused with the reason. A refusal does not use a step, and it is kept in the recording.
- `room/README.md` lists the commands, the sounds this room has, and a short syntax crib.

## What I want

A set I would want to listen to from start to finish. What a set is, how it opens, where it goes and how it ends are yours to decide.

Play one step, read what came back, then decide the next.

## What to deliver

Nothing beyond the twelve played steps. The room writes `index.html`, `recording.json` and `worklets.js` itself. Leave those, and everything under `room/`, as the room made them.
