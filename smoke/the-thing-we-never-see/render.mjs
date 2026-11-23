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
  title: "The thing we never see",
  sceneFile,
  contactCells: shots.map((shot) => [shot.start / 24 + 1, `${(shot.start / 24).toFixed(2)} s ${shot.id}`]),
});
await browser.close();
writeFileSync("edl.json", `${JSON.stringify({ fps: contract.fps, frames: contract.frames, shots: shots.map(({ id, start, end }) => ({ id, start, end })) }, null, 2)}\n`);
writeFileSync("evidence.json", `${JSON.stringify({
  beats: [{ id: "crash-heard-on-the-face", time: 12.5 }, { id: "shards", time: 380 / 24 }],
  checks: SMOKE_CHECKS,
}, null, 2)}\n`);
writeFileSync("README.md", readme("The thing we never see", {
  lines: ["Three shots: the shelf with the vase and a cat's tail, a face that reacts to a crash heard off screen, and the shards on the floor."],
  last: "Unseen: the cat knocked the vase off the shelf.",
}));
console.log(`rendered ${contract.frames} frames to film.mp4 with ${shots.length} shots`);
