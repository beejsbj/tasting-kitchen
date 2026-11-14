// The shared film check, validation/film.mjs, as every film Recipe in this family carries it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ffmpeg, hasFfmpeg, makeDelivery, runCheck } from "../../../../tests/support/film-delivery.mjs";

const recipeDir = import.meta.dirname;
const contract = { width: 64, height: 80, fps: 24, duration: 2, frames: 48 };
const evidence = { checks: [{ name: "test", result: "passed", detail: "test delivery" }] };
const skip = !hasFfmpeg && "ffmpeg is not installed";

test("the film Recipes carry the same film check", () => {
  const family = ["film-from-a-written-look", "two-colours-no-grey", "invent-a-style-and-hold-it", "three-styleframes-then-film", "titles-for-a-film-that-doesnt-exist"];
  const copies = family.map((id) => readFileSync(path.join(recipeDir, "..", id, "validation/film.mjs"), "utf8"));
  for (const [i, copy] of copies.entries()) assert.equal(copy, copies[0], `${family[i]} has a different validation/film.mjs`);
});

test("an evenly spaced film passes and needs no beats when the contract has none", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence });
  const result = runCheck(root, "validation/film.mjs");
  assert(result.passed, result.output);
});

test("frames of uneven duration fail even when their count is right", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence });
  // Half the frames last 1/48 s and half 1/16 s.
  ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=64x80:r=24:d=2", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=2",
    "-vf", "settb=1/480,setpts='if(lt(N,24),N/48,0.5+(N-24)/16)/TB'", "-fps_mode", "passthrough", "-enc_time_base", "1/480",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-video_track_timescale", "480", "-af", "volume=-12dB", "-c:a", "aac", path.join(root, "film.mp4")]);
  const result = runCheck(root, "validation/film.mjs");
  assert(!result.passed);
  assert.match(result.output, /Frames must be evenly spaced at 24 fps: frame 1 comes 0\.0208 s/u);
});
