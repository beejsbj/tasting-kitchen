// Render the no-model smoke reference inside the film toolchain image.
// Run from the delivery root with the fixtures mounted and this directory at source/:
//   node source/render.mjs
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SMOKE_CHECKS, readme, renderFilm } from "./kit/film-kit.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { browser, contract } = await renderFilm({
  title: "Invent a style and hold it",
  sceneFile: path.join(here, "scene.js"),
  contactCells: [[0.5, "rest"], [6, "push"], [12, "push"], [18, "press"], [20, "hardest-moment"], [22, "release"], [26, "hold"], [29.5, "end"]],
});
await browser.close();
copyFileSync(path.join(here, "STYLE.md"), "STYLE.md");
writeFileSync("evidence.json", `${JSON.stringify({
  beats: [{ id: "hardest-moment", time: 20, note: "Rules 2 and 3 are under pressure as the tiles squeeze; the squeeze still moves in quarter-unit steps and the horizon stays whole." }],
  checks: SMOKE_CHECKS,
}, null, 2)}\n`);
writeFileSync("README.md", readme("Invent a style and hold it", { lines: ["The style is Quarter Tiles, stated in `STYLE.md`."] }));
console.log(`rendered ${contract.frames} frames to film.mp4, player.html, contact.png, STYLE.md`);
