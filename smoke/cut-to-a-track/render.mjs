// Render the no-model smoke reference inside the film toolchain image.
// Run from the delivery root with the fixtures and inputs mounted and this directory at source/:
//   node source/render.mjs
// The soundtrack is inputs/track.wav, encoded as AAC at its own level; the live player plays it from film.mp4.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SMOKE_CHECKS, loadScene, readme, renderFilm } from "./kit/film-kit.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const sceneFile = path.join(here, "scene.js");
const { browser, contract, scene } = await renderFilm({
  title: "Cut to a track",
  sceneFile,
  wav: "inputs/track.wav",
  audioSrc: "film.mp4",
  contactCells: loadScene(readFileSync(sceneFile, "utf8")).shots.map((shot) => [shot.start / 24 + 0.5, `${(shot.start / 24).toFixed(2)} s ${shot.id}`]),
});
await browser.close();
writeFileSync("edl.json", `${JSON.stringify({ fps: contract.fps, frames: contract.frames, shots: scene.shots.map(({ id, start, end }) => ({ id, start, end })) }, null, 2)}\n`);
writeFileSync("evidence.json", `${JSON.stringify({
  beats: [{ id: "cut-into-silence", time: 12 }, { id: "boom", time: 605 / 24 }],
  checks: SMOKE_CHECKS,
}, null, 2)}\n`);
writeFileSync("README.md", readme("Cut to a track", { lines: [
  "Cuts with the music at 4.8, 9.6 and 15.0 s (bar lines and the drone's entry) and at the boom near 25.2 s; against it at 12.0 s, inside the silence, and at 19.0 s, off the grid. The track is used unchanged.",
] }));
console.log(`rendered ${contract.frames} frames to film.mp4 with ${scene.shots.length} shots`);
