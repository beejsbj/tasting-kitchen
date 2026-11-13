# Turn a noisy hum into a motif

`fixtures/contour.json` is a pitch tracker's reading of a short hummed line. It is as rough as these readings are: the voice slides and wavers, there are breaths, and the tracker makes mistakes of its own.

Find the motif in it and make it something I can hear.

## What I want

- A clean motif I could hand to a player: definite pitches and definite lengths.
- Your judgment about what was meant. Some of the wobbles are notes. Some are only the voice, or the tracker. Decide which, and do not keep anything just because it is in the data.
- Keep the character of the line. Tidy it; do not rewrite it.
- The motif alone, slow, in one plain sound. No accompaniment.

## What to deliver

- `index.html`: one clearly labelled button plays your motif. A second clearly labelled button plays the raw contour as a plain sliding tone, so I can hear what you started from. Both can be stopped. Once delivered it must play with no network: every file it needs ships beside it, under `assets/` if there are any.
- `notes.md`: no more than 120 words. List the notes you settled on, then say which wobbles you kept, which you dropped, and the one call you were least sure of.

How you make the sound is your choice: the browser's own audio, a music library, rendered audio files, or anything else. You may download tools while you work, as long as the finished page carries what it needs.
