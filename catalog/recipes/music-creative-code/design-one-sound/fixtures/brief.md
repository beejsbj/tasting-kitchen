# Design one sound: a slightly broken music box

Build one instrument: a warm, slightly broken music box. Then play `fixtures/phrase.json` on it so I can hear it.

## What I want

- A sound you build yourself. Do not use a recording of a real music box or a ready-made instrument.
- Warm, and recognisably a music box before I read the label.
- Slightly broken. The fault should be small and specific, the way a real mechanism wears, and it should have charm. Not ruined, and not random.
- The notes in `fixtures/phrase.json` as written, with nothing added. Small unevenness in timing or tuning is the instrument's business; the notes are not.

## What to deliver

Put these in the folder you start in, not in a subfolder.

- `index.html`: one clearly labelled button plays a single note on its own, so I can hear the instrument bare. A second clearly labelled button plays the phrase. Both can be stopped. Once delivered it must play with no network: every file it needs ships beside it, under `assets/` if there are any.
- `notes.md`: no more than 120 words on how the sound is built, what makes it warm, and exactly what is broken about it.

How you make the sound is your choice: the browser's own audio, a music library, rendered audio files, or anything else. You may download tools while you work, as long as the finished page carries what it needs.
