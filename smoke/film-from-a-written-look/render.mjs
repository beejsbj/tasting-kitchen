// Render the no-model smoke reference inside the film toolchain image.
// Run from the delivery root with the fixtures mounted and this directory at source/:
//   node source/render.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";

import { SMOKE_CHECKS, readme, renderFilm } from "./kit/film-kit.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { browser, contract } = await renderFilm({
  title: "Film from a written look",
  sceneFile: path.join(here, "scene.js"),
  contactCells: [0.5, 4, 8, 11.9, 12.1, 16, 20, 23.5].map((time) => [time, time < 12 ? "high" : "low"]),
});
await browser.close();
writeFileSync("evidence.json", `${JSON.stringify({ checks: SMOKE_CHECKS }, null, 2)}\n`);
writeFileSync("README.md", readme("Film from a written look", { lines: ["The picture is drifting isobars on a paper map; the soundtrack is a two-note pad."] }));
console.log(`rendered ${contract.frames} frames to film.mp4, player.html, contact.png`);
