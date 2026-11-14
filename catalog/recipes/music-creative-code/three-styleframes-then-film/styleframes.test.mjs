import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { ffmpeg, hasFfmpeg, makeDelivery, runCheck, writeFilm } from "../../../../tests/support/film-delivery.mjs";

const recipeDir = import.meta.dirname;
const styleframes = { directory: "styleframes", ids: ["a", "b", "c"], width: 64, height: 80, fps: 24, frames: 12, notes: "styleframes/styleframes.md", maxNoteWords: 150 };
const contract = { width: 64, height: 80, fps: 24, duration: 2, frames: 48, styleframes };
const checks = [{ name: "test", result: "passed", detail: "test delivery" }];
const NOTES = "## A\nIsobars as embroidery.\n\n## B\nFronts drawn as fences someone keeps mending.\n\n## C\nA legend with no map.\n";
const skip = !hasFfmpeg && "ffmpeg is not installed";

async function partOne(root, { size = [64, 80], frames = 12, notes = NOTES } = {}) {
  await mkdir(path.join(root, "styleframes"), { recursive: true });
  for (const [i, id] of ["a", "b", "c"].entries()) {
    ffmpeg(["-f", "lavfi", "-i", `color=c=0x${(i * 0x404040 + 0x202020).toString(16)}:s=${size[0]}x${size[1]}`, "-frames:v", "1", path.join(root, `styleframes/${id}.png`)]);
    await writeFilm(path.join(root, `styleframes/${id}.mp4`), { width: 64, height: 80, fps: 24, frames }, { audio: false });
  }
  await writeFile(path.join(root, "styleframes/styleframes.md"), notes);
}

test("three styleframes and motion tests pass after part one, and with a choice after part two", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence: { chosen: "b", checks } });
  await partOne(root);
  const film = runCheck(root, "validation/film.mjs");
  assert(film.passed, film.output);
  const two = runCheck(root, "validation/styleframes.mjs");
  assert(two.passed, two.output);
  assert.match(two.output, /styleframe taken named/u);
  await rm(path.join(root, "film.mp4"));
  await writeFile(path.join(root, "evidence.json"), JSON.stringify({ checks }));
  const one = runCheck(root, "validation/styleframes.mjs");
  assert(one.passed, one.output);
  assert.doesNotMatch(one.output, /styleframe taken named/u);
});

test("a wrong-size frame, a short motion test, a missing frame, long notes or no choice fails", { skip }, async (t) => {
  const cases = [
    [{ size: [80, 64] }, {}, /styleframes\/a\.png width/u],
    [{ frames: 10 }, {}, /styleframes\/a\.mp4 frame count/u],
    [{ notes: `${"word ".repeat(151)}\n` }, {}, /is 151 words; keep it within 150/u],
    [{}, { chosen: "d" }, /evidence\.chosen must be one of a, b, c/u],
  ];
  for (const [shape, extra, expected] of cases) {
    const root = await makeDelivery(t, recipeDir, { contract, evidence: { chosen: "a", checks, ...extra } });
    await partOne(root, shape);
    const result = runCheck(root, "validation/styleframes.mjs");
    assert(!result.passed);
    assert.match(result.output, expected);
  }
  const root = await makeDelivery(t, recipeDir, { contract, evidence: { chosen: "a", checks } });
  await partOne(root);
  await rm(path.join(root, "styleframes/c.mp4"));
  assert.match(runCheck(root, "validation/styleframes.mjs").output, /styleframes\/c\.mp4 missing or empty/u);
});
