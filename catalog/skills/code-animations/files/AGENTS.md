# AGENTS.md

Instructions for any coding agent (Codex, Cursor, Copilot, Gemini CLI, Jules, Claude Code and others) that uses this repo.

## What this repo is

A method and a harness for "code-rendered" films. A film is one `index.html` whose `window.__anim.seek(t)` draws any frame as a pure function of `t`, plus a procedural score from `renderAudio()`. The scripts in `harness/` seek it in headless Chrome and render MP4s in 16:9, 9:16, 4:5 and 1:1 from one timeline.

The harness makes a film correct and measurable. It does not make it accurate or watchable. That part is the process below, and it is not optional.

## Before you write any code

Read `SKILL.md` fully: the contract, the multi-format rules, the sound rules, the QA section and the list of defects earlier builds hit. Do not build your own pipeline, renderer or review method. A film made outside this process shipped charming and wrong (inaccurate anatomy) because nobody compared it to a reference.

## The workflow, in order

1. **Brief.** What the source says, audience, length, formats, narration or not. Answer the four story questions in SKILL.md (character, everyday object per idea, persistent HUD, loop back to the first frame).
2. **`STORYBOARD.md`** before code: one row per scene with time range, on-screen content, action and audio cue. Every event time becomes `TL` and `marks`.
3. **Start from `example/browser-10s/index.html`.** Copy it and change it. Don't start from a blank file.
4. **Build** the hardest frame first, `shoot` it in every format, look at it, then build out.
5. **Gates** (the Definition of done below).

## Definition of done

Run from the folder that holds `harness/`. Every command must pass, in every format you deliver:

```bash
node harness/verify.mjs  <work>/index.html --format 16x9            # and --format 9x16 (and 4x5 if delivered): "verify: OK"
node harness/audio.mjs   <work>/index.html --twice                  # no FAIL
node harness/lint.mjs    <work>/index.html --all-formats            # "lint: OK (0 FAIL)"
node harness/review.mjs  <work>/index.html --format 16x9 --out out/review-16x9   # and 9x16
#   open every sheet in out/review-*/sheets/, answer every question in out/review-*/REVIEW.md
node harness/review.mjs  --check out/review-16x9/REVIEW.md          # "review check: OK", exit 0 (and 9x16)
node harness/render.mjs  <work>/index.html --format 16x9 --out out/<name>-16x9.mp4   # every delivered format
bash harness/qa.sh out/<name>-16x9.mp4 4                            # contact sheets at 4 samples/sec: look at them
```

`review.mjs` writes one contact sheet per shot and a `REVIEW.md` with fixed questions per shot. `--check` exits 1 while any answer is empty or `TODO`, any score is under 4, lint has a FAIL, a shot section was removed, the film changed after the sheets were made, a shot's answers cite no tile of its sheet as `@4.30s`, or two shots share an identical answer. After any fix, run `review.mjs` again and answer again.

If the brief has an `## Accuracy checklist`, add `--checklist <brief.md>` to both `review.mjs` commands: every item needs a verdict (`correct`, `wrong` or `missing`) with a tile citation, and `--check` fails until all are `correct`.

## Rules you may not break

- **Never claim done with a failing gate.** Report the failure instead.
- **Never weaken a gate.** Don't edit thresholds in `harness/*.mjs`, don't skip formats, don't delete questions from `REVIEW.md`, don't fill answers you didn't check. Fix the film, not the gate.
- **Look at the sheets before you answer.** Every answer describes what is on the sheet, with timecodes. An answer written without opening the image is a false claim.
- **Open each sheet and write each answer yourself; never generate REVIEW.md answers with a script — the check detects it.**
- **Accuracy against a reference.** Every depicted real thing (animal anatomy, a logo, a product UI, a diagram of a real system) must be checked against a reference image. In `REVIEW.md` question 2, name the reference (file or URL) and what you compared: direction of motion (rotation sense, flow and travel direction), relative sizes and proportions of parts, part count, colours, order of steps. No reference found: say so and score the shot below 4 until one is checked.
  - Motion direction and relative size are the most-missed errors: a chain running backward and a rear sprocket drawn nearly chainring-sized both passed every gate once.
- `seek(t)` stays pure: no `Math.random()`, no `Date`, no state carried between frames (details in SKILL.md).
- No network calls in the film. Embed assets as data URIs.

## Where fixes come from

A human reviews the film in `review/film-fix.html` and exports a fix pack into `<film folder>/fixes/`. `fixes/FIXES.md` is self-contained: timecode, frame image, position and the range to re-render for each fix. Apply each fix surgically, re-run the Definition of done, and say per fix what changed.

## What to report at the end

- The MP4 paths per format.
- The output of each gate command above (verify, audio, lint, review `--check`, qa), pasted, not paraphrased.
- The references you compared real-world objects against, per shot.
- What you did not check, and the known weaknesses still in the film.
