# The music room

A room for playing a live set on Strudel, one step at a time. It has no audio. After each step it prints what sounded.

## Commands

Run these from the directory that holds `room/`.

- `node room/room.mjs play <pattern-file>` plays the next step with the Strudel code in the file, then prints what sounded.
- `node room/room.mjs status` prints how many steps are played, the tempo and where the next step starts.
- `node room/room.mjs heard [step]` prints a played step's printout again. Without a number it prints the last one.
- `node room/room.mjs check` runs the room's own check of the finished recording.

## Rules of the room

- A set is 12 steps of 8 cycles each. Step 1 is cycles 0 to 8, step 2 is cycles 8 to 16, and so on. Cycle time keeps running across steps, as it does in a live session, so `<a b c>` and `.slow(16)` carry on where they were.
- Each `play` replaces the whole pattern, as evaluating does in the Strudel editor.
- A played step is final. There is no preview and no undo.
- The tempo starts at 0.5 cycles per second. `setcps(x)` or `setcpm(x)` changes it from that step on, between 0.25 and 1 cycles per second.
- A pattern is refused, without using a step, if it does not evaluate, uses a sound the room does not have, leaves the tempo range, is over 8192 bytes, or makes more than 2048 events in one step. Every refusal is kept in the recording.
- `silence` is a valid step.
- The room keeps the set in `recording.json` and remembers each play in `.room/`. It writes `index.html` and `worklets.js` so the set can be heard later. Leave all of these, and `room/`, alone.

## Sounds

Synthesis only. There are no samples, so names such as `bd`, `hh` or `piano` are refused.

- Oscillators: `sine`, `triangle`, `square`, `sawtooth` (also `sin`, `tri`, `sqr`, `saw`), `supersaw`, `pulse`
- Noise: `white`, `pink`, `brown`, `crackle`
- A synthesized kick: `sbd`

An event with no sound plays `triangle`. An oscillator with no note plays MIDI 36.

## The printout

`play` prints JSON. The numbers are measured from the events the step produced.

- `cycles`, `cps`, `seconds`: where the step sits in the set.
- `events`, `perCycle`, `perSecond`: how many events started, in all, per cycle and per second.
- `pitch`: lowest, highest and mean MIDI note, and the pitch classes used (0 is C).
- `lengths`: shortest and longest event, in cycles.
- `controls`: the lowest and highest value of every numeric control that was set.
- `bars`: one entry per cycle. Each voice is one sound, with its onsets as positions inside the cycle (0 to 1) and the MIDI note at each onset. `sameAs` means the cycle sounded exactly like an earlier cycle of this step.

## Syntax crib

Strudel code is JavaScript. Double-quoted strings are mini-notation.

```js
setcpm(30)                                 // tempo, in cycles per minute

$: note("c2 [eb2 g2] <bb1 f2>")            // $: adds a layer; all layers play together
  .s("sawtooth").lpf(800).gain(0.6)

$: s("sbd*4")                              // the kick, four per cycle

$: n("0 2 4 <6 7>").scale("C:minor")       // scale degrees
  .s("triangle").room(0.4)

$: s("white*8").decay(0.05).hpf(6000).gain(0.3)
```

Mini-notation: a space-separated sequence fills one cycle. `[a b]` subdivides, `<a b>` takes one per cycle, `a*2` repeats, `a/2` slows, `~` rests, `a,b` plays together, `a(3,8)` is a Euclidean rhythm, `a?` plays sometimes, `a@3` lasts longer, `a!3` repeats in place.

Pattern functions include `stack`, `cat`, `note`, `n`, `scale`, `s`, `gain`, `pan`, `lpf`, `hpf`, `lpq`, `attack`, `decay`, `sustain`, `release`, `room`, `delay`, `fast`, `slow`, `rev`, `off`, `every`, `sometimes`, `degradeBy`, `struct`, `mask`, `euclid`, `add`, `sub`, `jux`, `ply`, `segment`, `range`, and the signals `sine`, `saw`, `tri`, `square`, `rand`, `perlin`. The engine is Strudel 1.2.6 and its source is in `room/strudel/strudel.mjs`.
