# film-fix

A review tool for films made with the code-animations skill. You watch the film, click where something is wrong, write what should happen instead, and export a fix pack that any AI (Claude, Codex, ChatGPT, Gemini) can act on without other context.

## Open it

Double-click `film-fix.html`. It opens in Chrome or Edge from file://, with no server, no install and no build step.

- **Open film folder** (Chrome/Edge): pick the folder that holds the film's `index.html`. The export is written into that folder.
- **Open index.html**, or drop the file on the page: same review, but the export downloads as a zip.

Scroll the page to move through the film, and you hear the soundtrack while you scroll. ← → step one frame, Shift steps one second, Space plays, M mutes. Click the frame to add a note. Notes are kept in this browser per film file and size.

The format menu (16:9 / 9:16 / 4:5) reloads the film at that size. Notes are kept separately for each format.

**Edit (key E):** in films with a `/*TUNE*/` block and `E()` elements (see SKILL.md), drag an element to move it or drag a corner to scale it. Arrows nudge it and + − change its size. **Save to index.html** rewrites only the TUNE line and keeps a dated backup the first time. In any other film, drag a box around what should move, then move or scale the copy. Enter turns the result into a note with exact numbers.

## The fix pack

Written to `<film folder>/fixes/`, or zipped as `fixes-<name>.zip` with the same layout:

- `FIXES.md`: film file, sha256, duration, fps, size and date, then instructions for an AI that has never seen this setup, then one section per fix with timecode, frame, shot, x/y position and the range to re-render.
- `fixes.json`: the same data, machine-readable (schema `film-fix-v1`).
- `frames/fix-NN.png`: the frame with the spot ringed and numbered. `frames/fix-NN-clean.png` is the same frame without the mark. Nudge fixes add `frames/fix-NN-after.png`, a mockup of the target.
- Hand the `fixes/` folder and `index.html` to the AI.
