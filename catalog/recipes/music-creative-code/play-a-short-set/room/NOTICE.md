# Notice

This directory is the music room: equipment Tasting Kitchen supplies, unchanged, to every model that plays a set in it.

## What is here

- `room.mjs`, `player.html` and `README.md` were written for Tasting Kitchen.
- `strudel/` holds Strudel, the live-coding pattern language, by the Strudel contributors (https://codeberg.org/uzu/strudel):
  - `strudel.mjs`: the pattern engine (`@strudel/core`, `@strudel/mini`, `@strudel/tonal`, `@strudel/transpiler`) and its dependencies.
  - `superdough.js` and `worklets.js`: superdough, Strudel's Web Audio synth, and its AudioWorklet processors.
  - `manifest.json`: every package the three files were built from, with its version, licence and sha512, and the sha256 of each built file.
  - `THIRD-PARTY-NOTICES.md`: the licence text of each bundled package.

## Licence

Strudel is licensed under the GNU Affero General Public License, version 3 or later. `room.mjs` runs the engine and a rendered `index.html` contains the synth, so this whole directory, and the `index.html` and `worklets.js` the room writes for a set, are offered under the same licence: AGPL-3.0-or-later. The full text is in `LICENSE`. There is no warranty.

The patterns a model plays, and the recording of them, are that model's own output. This notice makes no claim over them.

## Source

Everything here is source, or is built unminified from source:

- The room's own files are in the Tasting Kitchen repository, https://github.com/beejsbj/tasting-kitchen, under `catalog/recipes/music-creative-code/play-a-short-set`.
- `scripts/vendor-music-room.mjs` in that repository rebuilds `strudel/` from the exact registry packages `manifest.json` pins.
- A published Dish carries this directory beside its artifact, under `inputs/room`.

## Changes to Strudel

Made at build time on 2026-11-13, and listed in `manifest.json`:

- superdough loads its AudioWorklet processors from `worklets.js` beside the page instead of an inlined data: URL, because a Dish is served under a content policy that refuses those.
- The shared-worker scheduler of `@strudel/core` (NeoCyclist) is replaced by a stub. The room never schedules in real time.
