// Render the no-model smoke reference inside the film toolchain image: all three
// parts' artifacts at once, as the delivery stands after the director's note.
// Run from the delivery root with the fixtures mounted and this directory at source/:
//   node source/render.mjs
// Rushes are rendered from the scene; both cuts are conformed from the encoded
// rushes with FFmpeg (trim and concatenate), never redrawn.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { RATE, SMOKE_CHECKS, contactSheet, contract as readContract, encodePlayer, loadScene, openPlayer, playerHtml, readme, scratch, setVariant, sha256, writeWav } from "./kit/film-kit.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const contract = readContract();
const sceneSource = readFileSync(path.join(here, "scene.js"), "utf8");
const scene = loadScene(sceneSource);
const TAKE = 16, CAMERAS = Object.keys(scene.cameras);

// Part one: one continuous take per camera, silent. The page is outside the delivery.
const work = scratch("coverage-");
const page = path.join(work, "rushes.html");
writeFileSync(page, playerHtml({ title: "Rushes", width: contract.width, height: contract.height, duration: TAKE, scene: sceneSource }));
const { browser, page: tab } = await openPlayer(page);
mkdirSync("rushes", { recursive: true });
for (const camera of CAMERAS) {
  await setVariant(tab, camera);
  await encodePlayer(tab, { out: `rushes/${camera}.mp4`, fps: contract.fps, frames: TAKE * contract.fps });
}
writeFileSync("rushes/rushes.json", `${JSON.stringify({ clips: CAMERAS.map((camera) => ({ file: `rushes/${camera}.mp4`, camera, sha256: sha256(`rushes/${camera}.mp4`) })) }, null, 2)}\n`);

// Parts two and three: each shot is [camera, first clip frame, frame count].
const cuts = {
  "cut-1": [["wide", 0, 240], ["close", 150, 144], ["high", 200, 96], ["low", 216, 120], ["wide", 264, 120]],
  film: [["high", 0, 144], ["close", 0, 192], ["low", 60, 144], ["close", 200, 96], ["wide", 240, 144]],
};
const wav = writeWav(path.join(work, "room.wav"), scene.sound(RATE, contract.duration));
const edls = {};
for (const [name, shots] of Object.entries(cuts)) {
  const inputs = shots.flatMap(([camera]) => ["-i", `rushes/${camera}.mp4`]);
  const graph = shots.map(([, from, frames], i) => `[${i}:v]trim=start_frame=${from}:end_frame=${from + frames},setpts=PTS-STARTPTS[v${i}]`).join(";")
    + `;${shots.map((_, i) => `[v${i}]`).join("")}concat=n=${shots.length}:v=1:a=0[v]`;
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-i", wav, "-filter_complex", graph, "-map", "[v]", "-map", `${shots.length}:a`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(contract.fps), "-frames:v", String(contract.frames),
    "-c:a", "aac", "-b:a", "192k", "-t", String(contract.duration), "-movflags", "+faststart", `${name}.mp4`], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`conform of ${name} failed`);
  let start = 0;
  edls[name] = { fps: contract.fps, frames: contract.frames, shots: shots.map(([camera, from, frames], i) => { const shot = { id: `${name}-${i + 1}-${camera}-${from}`, start, end: start + frames }; start += frames; return shot; }) };
  if (start !== contract.frames) throw new Error(`${name} runs ${start} frames, not ${contract.frames}`);
}
writeFileSync("cut-1.edl.json", `${JSON.stringify(edls["cut-1"], null, 2)}\n`);
writeFileSync("edl.json", `${JSON.stringify(edls.film, null, 2)}\n`);
writeFileSync("index.html", readFileSync("fixtures/player.html"));

// Contact sheet: one frame from every clip, then one from every shot of each cut.
await contactSheet(tab, [
  ...CAMERAS.map((camera) => [8, `clip ${camera}`, camera]),
  ...Object.entries(cuts).flatMap(([name, shots]) => shots.map(([camera, from], i) => [from / contract.fps, `${name} ${(edls[name].shots[i].start / contract.fps).toFixed(2)} s`, camera])),
], "contact.png", { cols: 5, cellWidth: 320 });
await browser.close();

writeFileSync("evidence.json", `${JSON.stringify({
  beats: [{ id: "cut-1-impact", time: (240 + 144 + 96 + 24) / contract.fps }, { id: "film-reveal", time: (720 - 144) / contract.fps }],
  checks: SMOKE_CHECKS,
}, null, 2)}\n`);
writeFileSync("README.md", readme("Shoot coverage, then cut", { lines: [
  "The event: a ball rolls off a table and tips a cup. Rushes: four silent 16-second takes (wide, close, high, low), logged with their sha256 in `rushes/rushes.json`.",
  "`cut-1.mp4` tells it in order; `film.mp4` holds the wide shot back until the last shot, after the director's note. Both are conformed from the encoded rushes with FFmpeg; the room tone is synthesized.",
] }));
console.log("rendered rushes, cut-1.mp4 and film.mp4");
