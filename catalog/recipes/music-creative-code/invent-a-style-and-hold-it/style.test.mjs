import assert from "node:assert/strict";
import test from "node:test";

import { hasFfmpeg, makeDelivery, runCheck } from "../../../../tests/support/film-delivery.mjs";

const recipeDir = import.meta.dirname;
const contract = { width: 96, height: 96, fps: 30, duration: 2, frames: 60, beats: [{ id: "hardest-moment", note: true }], style: { file: "STYLE.md", rules: 5 } };
const checks = [{ name: "test", result: "passed", detail: "test delivery" }];
const evidence = { beats: [{ id: "hardest-moment", time: 1.9, note: "Rules 2 and 4 meet when the swarm crosses itself." }], checks };
const STYLE = `# Ledger Bloom

A style of accounts that flower.

1. Every mark is a tally stroke of one fixed length.
2. Strokes only ever add; nothing is erased on screen.
3. Colour changes only where a column of tallies closes.
4. Motion happens in whole strokes, one per frame per column.
5. The paper grid is visible in every frame and never moves.
`;
const skip = !hasFfmpeg && "ffmpeg is not installed";

test("a named style with five numbered rules and a noted hardest moment passes", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence, files: { "STYLE.md": STYLE } });
  const film = runCheck(root, "validation/film.mjs");
  assert(film.passed, film.output);
  const style = runCheck(root, "validation/style.mjs");
  assert(style.passed, style.output);
  assert.match(style.output, /names "Ledger Bloom" and states 5 numbered rules/u);
});

test("the hardest moment may fall anywhere but needs one time and a note", { skip }, async (t) => {
  const late = await makeDelivery(t, recipeDir, { contract, evidence: { ...evidence, beats: [{ ...evidence.beats[0], time: 2.5 }] } });
  assert.match(runCheck(late, "validation/film.mjs").output, /Beat window: hardest-moment/u);
  const bare = await makeDelivery(t, recipeDir, { contract, evidence: { ...evidence, beats: [{ id: "hardest-moment", time: 0.2 }] } });
  assert.match(runCheck(bare, "validation/film.mjs").output, /Beat note: hardest-moment/u);
  const missing = await makeDelivery(t, recipeDir, { contract, evidence: { beats: [], checks } });
  assert.match(runCheck(missing, "validation/film.mjs").output, /One evidence time for hardest-moment/u);
});

test("STYLE.md without a name, with four or six rules, or misnumbered fails", { skip }, async (t) => {
  const cases = [
    [STYLE.replace("# Ledger Bloom\n", "Ledger Bloom\n"), /must begin with the style's name/u],
    [STYLE.replace(/^5\..*\n/mu, ""), /exactly 5 numbered rules; found 4/u],
    [`${STYLE}6. A sixth rule sneaks in here.\n`, /exactly 5 numbered rules; found 6/u],
    [STYLE.replace("3. Colour", "4. Colour"), /numbered 1 to 5 in order/u],
    [STYLE.replace("5. The paper grid is visible in every frame and never moves.", "5. Grid."), /Rule 5 is too short/u],
  ];
  const root = await makeDelivery(t, recipeDir, { contract, evidence });
  assert.match(runCheck(root, "validation/style.mjs").output, /STYLE\.md missing/u);
  for (const [text, expected] of cases) {
    const bad = await makeDelivery(t, recipeDir, { contract, evidence, files: { "STYLE.md": text } });
    const result = runCheck(bad, "validation/style.mjs");
    assert(!result.passed);
    assert.match(result.output, expected);
  }
});
