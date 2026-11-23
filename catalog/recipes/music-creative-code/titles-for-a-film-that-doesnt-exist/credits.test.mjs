import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { hasFfmpeg, makeDelivery, runCheck } from "../../../../tests/support/film-delivery.mjs";

const recipeDir = import.meta.dirname;
const contract = { width: 192, height: 108, fps: 24, duration: 12, frames: 288, minIntegratedLufs: -40, credits: { fixture: "fixtures/credits.json", minSeconds: 1.5 } };
const supplied = JSON.parse(readFileSync(path.join(recipeDir, "fixtures/credits.json"), "utf8"));
const checks = [{ name: "test", result: "passed", detail: "test delivery" }];
const credits = ["title", ...supplied.credits.map((credit) => credit.id)].map((id, i) => ({ id, on: i * 1.3, off: i * 1.3 + 1.6 }));
const evidence = { credits, intent: "A quiet rural thriller about debts that come due.", checks };
const skip = !hasFfmpeg && "ffmpeg is not installed";

test("the fixture is a title and eight credits with distinct ids", () => {
  assert.equal(typeof supplied.title, "string");
  assert.equal(supplied.credits.length, 8);
  assert.equal(new Set(supplied.credits.map((credit) => credit.id)).size, 8);
});

test("every credit timed inside the film for at least 1.5 s, with an intent, passes", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence });
  const film = runCheck(root, "validation/film.mjs");
  assert(film.passed, film.output);
  assert.doesNotMatch(film.output, /integrated loudness -70\.0 LUFS/u, "loudness comes from the ebur128 summary, not its first frame line");
  const result = runCheck(root, "validation/credits.mjs");
  assert(result.passed, result.output);
  assert.match(result.output, /title and 8 credits, each at least 1\.5 s/u);
});

test("a missing, short, outside, duplicated or unknown credit fails", { skip }, async (t) => {
  const cases = [
    [credits.filter((credit) => credit.id !== "c5"), /One on\/off entry for c5/u],
    [credits.map((credit) => (credit.id === "c3" ? { ...credit, off: credit.on + 1 } : credit)), /Credit c3 is on screen 1\.00 s; it needs at least 1\.5 s/u],
    [credits.map((credit) => (credit.id === "c8" ? { id: "c8", on: 11, off: 12.5 } : credit)), /Credit c8 needs 0 <= on < off <= 12 s/u],
    [[...credits, credits[2]], /One on\/off entry for c2/u],
    [[...credits, { id: "tagline", on: 1, off: 3 }], /Unknown credit id in evidence: "tagline"/u],
  ];
  for (const [list, expected] of cases) {
    const root = await makeDelivery(t, recipeDir, { contract, evidence: { ...evidence, credits: list } });
    const result = runCheck(root, "validation/credits.mjs");
    assert(!result.passed);
    assert.match(result.output, expected);
  }
  const silent = await makeDelivery(t, recipeDir, { contract, evidence: { credits, checks } });
  assert.match(runCheck(silent, "validation/credits.mjs").output, /evidence\.intent/u);
});

test("a near-silent soundtrack fails the loudness floor", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence, volumeDb: -60 });
  const result = runCheck(root, "validation/film.mjs");
  assert(!result.passed);
  assert.match(result.output, /below -40 LUFS: the soundtrack is close to silent/u);
});
