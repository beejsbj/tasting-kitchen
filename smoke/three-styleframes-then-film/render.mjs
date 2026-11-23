// Render the no-model smoke reference inside the film toolchain image: both
// parts' artifacts at once, as the delivery stands after part two.
// Run from the delivery root with the fixtures mounted and this directory at source/:
//   node source/render.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SMOKE_CHECKS, encodePlayer, readme, renderFilm, setVariant, stillPng } from "./kit/film-kit.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { browser, page, contract } = await renderFilm({
  title: "Three styleframes, then a film",
  sceneFile: path.join(here, "scene.js"),
  contactCells: [[1, "a", "a"], [1, "b", "b"], [1, "c", "c"], [0.5, "film"], [6, "film"], [12, "film"], [18, "film"], [23.5, "film"]],
});
// Part one: a still and a 72-frame motion test of each look.
const s = contract.styleframes;
mkdirSync(s.directory, { recursive: true });
for (const id of s.ids) {
  await setVariant(page, id);
  await stillPng(page, 1, path.join(s.directory, `${id}.png`));
  await encodePlayer(page, { out: path.join(s.directory, `${id}.mp4`), fps: s.fps, frames: s.frames });
}
await setVariant(page, "film");
await browser.close();
writeFileSync(s.notes, `# Styleframes

A: arrows on a grid that point wherever they like.

B: pastel pressure blobs on a night field.

C: one thermometer filling and emptying.

Kitchen's smoke reference; these are schematic, not three real directions.
`);
writeFileSync("evidence.json", `${JSON.stringify({ chosen: "b", checks: SMOKE_CHECKS }, null, 2)}\n`);
writeFileSync("README.md", readme("Three styleframes, then a film", {
  intro: ["Styleframe taken: B, the only one on a dark field and the only one without lines."],
  lines: ["`styleframes/` holds part one: three stills, three 72-frame motion tests and their notes. The film is look B slowed and dimmed."],
}));
console.log(`rendered ${contract.frames} frames to film.mp4 and ${s.ids.length} styleframes with motion tests`);
