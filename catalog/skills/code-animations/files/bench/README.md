# Bench: does another AI tool reach the floor by following this repo?

Three fixed briefs, one fixed prompt, one meter. Each brief carries its source facts inline, so no web research is needed, and asks for a score-only film (no narration) in 16x9 and 9x16.

| Brief | Kind | Length |
|---|---|---|
| `briefs/01-dns.md` | technical explainer | 25-35 s |
| `briefs/02-derailleur.md` | accuracy-heavy mechanism, with a 10-item checklist | 25-40 s |
| `briefs/03-population.md` | data film, numbers on screen as they land | 20-30 s |

## Protocol

1. Fresh copy of the repo (no `out/`, no `.git`, no earlier `works/`), with `harness/node_modules` installed.
2. The tool gets ONLY that copy and this prompt, verbatim, with `NN` and the brief file filled in:
   `Make the film described in bench/briefs/NN-<name>.md in works/bench-NN/ following this repo's instructions. Deliver when the Definition of done passes.`
3. No human help, no extra hints, no follow-up messages. Time limit 45 min. Record the wall time and keep the tool's full log.
4. Score: `node bench/score.mjs works/bench-NN --brief bench/briefs/NN-<name>.md` from the copy's root. Prints a table and writes `works/bench-NN/score.json`.
5. For brief 02, a person (or a separate reviewer with no stake in the run) judges the accuracy checklist item by item from the review sheets in `out/review-*/sheets/`: shown correctly, wrong, or missing. Also check whether the tool's `REVIEW.md` answers match what the sheets show.

## Accuracy checklist convention

A brief may carry a heading that starts with `## Accuracy checklist`, followed by a numbered list (`1. ...`, one item per line). `review.mjs --checklist <brief.md>` copies each item into `REVIEW.md` as `C1.`, `C2.`, ... with a `**Verdict:**` line. A verdict starts with `correct`, `wrong` or `missing`, cites the tile that shows it as `@4.30s` (a time from a "Tiles at:" line), then says what was seen:

`**Verdict:** correct @16.14s the chain climbs to the larger sprocket while the crank turns forward`

`review.mjs --check <REVIEW.md> --checklist <brief.md>` fails if a brief item is missing from `REVIEW.md`, or any verdict is empty, `wrong`, `missing` or uncited. `score.mjs` passes `--checklist` on its own when the brief has one.

## What the score means, and what it doesn't

`score.mjs` measures the floor: verify (16x9, 9x16), `audio --twice`, lint FAIL and WARN counts, `review --check` per format, `STORYBOARD.md` present, duration inside the brief's range. Weights are constants at the top of the file, with the reasoning. It exits 0 always; it is a meter, not a gate.

It does not measure taste, story or accuracy. A film can score 100 and draw the derailleur upside down. `review --check` only proves the questions were answered and scored 4+, not that the answers are true. That is why brief 02's checklist and the honesty of `REVIEW.md` are judged separately, from the sheets.

## Results

| Date | Tool | Model | Brief | Wall time | Score | Score under v2 gates | Gates failed | Accuracy | REVIEW.md honest? |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-29 | Claude Code CLI 2.1.284 (`claude -p`) | claude-opus-5-5 | 02 | 39 min | 98 | 68: review --check fails both formats (no `@` citations, no checklist section) | none (1 lint WARN: 9x16 density) | 10/10 (cage swing on a bigger sprocket is labelled, the motion is barely visible) | yes: timecodes and claims match the sheets; lists its own weaknesses |
| 2026-09-29 | Codex CLI 0.157.1 (`codex exec`) | gpt-6-sol, reasoning high | 02 | 39 min | 92 | 62: review --check fails both formats (no `@` citations, no checklist section) | none (4 lint WARN: text-size and density, both formats) | 8/10: pedals and chain arrows run backward in the side view (item 9), linkage drawn as one bar, not a parallelogram (item 6); rear sprocket drawn nearly chainring-sized | partly: timecodes match, but answers were written in bulk by a script and claim reference checks that missed the backward pedalling |
| 2026-09-29 | Run 2 (v2 gates, fresh clone): Claude Code CLI 2.1.284 (`claude -p --safe-mode`) | claude-opus-5-5 | 02 | 29 min, 86 turns, $6.58 list | 100 | 100 (this run was made under v2) | none (0 WARN; review --check OK both formats with 10 checklist verdicts) | 10/10: chain and crank run forward (top run moves toward the chainring frame to frame), sprocket and chainring sizes follow real tooth counts (44T, 11-34), shifts shown in side and rear view at once | yes: 10/10 verdicts match the sheets; answers hand-written per format (12 sheets opened), no fill script |
| 2026-09-29 | Run 2 (v2 gates, fresh clone): Codex CLI 0.157.1 (`codex exec`) | gpt-6-sol, reasoning high | 02 | 27 min, 75 commands, 270,562 tokens | 90 | 90 (this run was made under v2) | lint WARN x5: text-size and safe-area in both formats, density in 9x16 | 9/10: item 9 missing, because the shifts happen only in the rear view with no crank on screen, so "while the pedals turn forward" is a caption, not shown. Off-checklist: the rear sprocket is drawn at about 0.6-0.75 of the chainring and barely changes size between gears in the side view. Backward pedalling and the one-bar linkage from run 1 are fixed | mostly: 9 of 10 verdicts match; C9 says `correct` for item 9. Answers hand-written with apply_patch, distinct per format, no fill script; the log can't show whether the sheets were opened |

Both runs used the developer's normal global tool config (a user-level CLAUDE.md and hooks for Claude, an older copy of this skill in `~/.codex/skills` for Codex), so neither was a perfectly clean room. Codex's first attempt hit its usage limit before doing anything and was re-run in the same untouched copy.

Run 2 isolation (fresh `git clone` of fb5aac4 each, `npm ci` in `harness/`, one prompt, no follow-ups, 60 min cap, both legs in parallel): Claude ran with `--safe-mode --append-system-prompt-file <repo CLAUDE.md with AGENTS.md inlined>`. Safe mode drops the user-level CLAUDE.md, hooks, skills, plugins and MCP, but also the repo's own CLAUDE.md, so that file was handed back as a system-prompt append (`--setting-sources project` alone still loaded the user CLAUDE.md). Codex ran with `--disable hooks -c "skills.config=[{path='<~/.codex/skills/code-animations/SKILL.md>',enabled=false}]"`; checked beforehand that the old code-animations skill drops out of its skill list, but its other global skills stayed loaded. Neither was a perfect clean room. Both fetched reference photos from the web on their own: Wikimedia Commons for Claude, Park Tool and Shimano for Codex. Neither edited the harness. Accuracy was judged from the review sheets plus close-up stills made with `harness/shoot.mjs` into a separate folder: frame pairs 1/30 s apart for chain direction, and before/after frames for cage swing and sideways travel.

What it taught: the v1 gates proved that questions were answered, not that anyone looked, so a script-filled `REVIEW.md` scored the same as an honest one, and a backward-running chain scored 92. The v2 gates (citations per shot, no answers copied between shots, a verdicted checklist, a lint freeze check anchored like ffmpeg's) fail both old runs, because neither had to cite or verdict anything; a fair comparison needs a re-run under v2. Accuracy still rests on an honest verdict: a script that writes distinct, cited answers per shot passes the check.

After run 2 the brief's checklist got an item 11 (true relative sizes in every view) and item 9 now requires the turning crank on screen during the shift. Both gaps passed Codex's run 2 unchallenged, because a self-reported `correct` can't be checked by a script. Runs 1 and 2 were judged against the 10-item list.
