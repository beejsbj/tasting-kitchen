// Render the no-model smoke reference inside the film toolchain image.
// Run from the delivery root with the fixtures mounted and this directory at source/:
//   node source/render.mjs
// The credits are read from fixtures/credits.json and written into the scene's schedule.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SMOKE_CHECKS, readme, renderFilm, scratch } from "./kit/film-kit.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const supplied = JSON.parse(readFileSync("fixtures/credits.json", "utf8"));
// Title 1.0-5.0 s, then each credit readable for 3.5 s, 4.2 s apart.
const schedule = [
  { id: "title", lines: [supplied.title], on: 1, off: 5 },
  ...supplied.credits.map((credit, i) => ({ id: credit.id, lines: [credit.role, credit.name], on: 6 + i * 4.2, off: 6 + i * 4.2 + 3.5 })),
];
const scene = path.join(scratch("titles-"), "scene.js");
writeFileSync(scene, `${readFileSync(path.join(here, "scene.js"), "utf8")}\nglobalThis.Scene.schedule = ${JSON.stringify(schedule)};\n`);
const { browser, contract } = await renderFilm({
  title: "Titles for a film that doesn't exist",
  sceneFile: scene,
  contactCells: schedule.map((card) => [(card.on + card.off) / 2, card.id]),
});
await browser.close();
writeFileSync("evidence.json", `${JSON.stringify({
  credits: schedule.map(({ id, on, off }) => ({ id, on, off })),
  intent: "A quiet literary drama, patient and a little cold.",
  checks: SMOKE_CHECKS,
}, null, 2)}\n`);
writeFileSync("README.md", readme("Titles for a film that doesn't exist", { lines: ["`render.mjs` reads the credits from `fixtures/credits.json` and writes their schedule into the scene before rendering."] }));
console.log(`rendered ${contract.frames} frames to film.mp4, player.html, contact.png`);
