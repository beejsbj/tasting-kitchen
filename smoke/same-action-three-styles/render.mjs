// Render the no-model smoke reference inside the film toolchain image.
// Run from the delivery root with the fixtures mounted and this directory at source/:
//   node source/render.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SMOKE_CHECKS, loadScene, readme, renderFilm } from "./kit/film-kit.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const sceneFile = path.join(here, "scene.js");
const shots = loadScene(readFileSync(sceneFile, "utf8")).shots;
const { browser, contract } = await renderFilm({
  title: "Same action, three styles",
  sceneFile,
  // The same moment (3.5 s into the action) in each version, then one frame per shot.
  contactCells: [[3.5, "flat at 3.5 s"], [11.5, "line at 3.5 s"], [19.5, "pixel at 3.5 s"], ...shots.map((shot) => [shot.start / 24 + 0.5, `${(shot.start / 24).toFixed(2)} s ${shot.id}`])],
});
await browser.close();
writeFileSync("edl.json", `${JSON.stringify({ fps: contract.fps, frames: contract.frames, shots: shots.map(({ id, start, end }) => ({ id, start, end })) }, null, 2)}\n`);
writeFileSync("evidence.json", `${JSON.stringify({
  beats: [{ id: "landing-flat", time: 6 }, { id: "landing-line", time: 14 }, { id: "landing-pixel", time: 22 }],
  checks: SMOKE_CHECKS,
}, null, 2)}\n`);
writeFileSync("README.md", readme("Same action, three styles", { lines: [
  "The action: a ball tossed into a bucket. The languages: flat shapes on navy; line drawing on paper, wide then close; chunky pixels on green.",
] }));
console.log(`rendered ${contract.frames} frames to film.mp4 with ${shots.length} shots`);
