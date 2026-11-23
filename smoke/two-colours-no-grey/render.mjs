// Render the no-model smoke reference inside the film toolchain image.
// Run from the delivery root with the fixtures mounted and this directory at source/:
//   node source/render.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";

import { SMOKE_CHECKS, readme, renderFilm } from "./kit/film-kit.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { browser, contract } = await renderFilm({
  title: "Two colours, no grey",
  sceneFile: path.join(here, "scene.js"),
  contactCells: [0.5, 3, 6, 9, 12, 15, 18, 21, 23.5].map((time) => [time, "lamp"]),
});
await browser.close();
writeFileSync("evidence.json", `${JSON.stringify({ colours: ["#14213d", "#fca311"], checks: SMOKE_CHECKS }, null, 2)}\n`);
writeFileSync("README.md", readme("Two colours, no grey", { lines: ["Ink #14213d and paper #fca311 only: light is an ordered dither, written pixel by pixel with putImageData so nothing is antialiased. `player.html?capture` shows the canvas alone at 1:1."] }));
console.log(`rendered ${contract.frames} frames to film.mp4, player.html, contact.png`);
