// Shared equipment for Kitchen's no-model film smoke references. Kitchen copies
// this directory to source/kit/ beside each reference, so a delivery's source
// stays self-contained. Run inside the film toolchain image, from the delivery
// root, with fixtures mounted; the smoke runner supplies PLAYWRIGHT_CORE and the
// image supplies CHROME_PATH.
//
// A scene is plain browser-and-Node JavaScript that sets globalThis.Scene:
//   { background: "#rrggbb", draw(ctx, t, width, height), sound(rate, duration) -> Float32Array (mono) }
// draw is a pure function of time; sound is seeded and deterministic.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RATE = 48000;
export const contract = () => JSON.parse(readFileSync("fixtures/contract.json", "utf8"));
export const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
export const scratch = (prefix = "smoke-") => mkdtempSync(path.join(tmpdir(), prefix));

/** Evaluate a scene's source in Node (for its sound) and return its Scene object. */
export function loadScene(source) {
  const holder = {};
  new Function("globalThis", source)(holder);
  return holder.Scene;
}

/** Write mono float samples as a 32-bit float WAV. */
export function writeWav(file, samples, rate = RATE) {
  const data = Float32Array.from(samples);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length * 4, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(32, 34); header.write("data", 36); header.writeUInt32LE(data.length * 4, 40);
  writeFileSync(file, Buffer.concat([header, Buffer.from(data.buffer, data.byteOffset, data.byteLength)]));
  return file;
}

/**
 * The live player: the scene drawn on a canvas as a pure function of time, with
 * play/pause, a scrub bar and an explicit button to start sound. `?capture`
 * shows the picture alone at 1:1 from the top-left corner. Sound comes from the
 * scene's own synthesizer, or from `audioSrc` (a file in the delivery) when given.
 */
export function playerHtml({ title, width, height, duration, scene, audioSrc = null }) {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} (live)</title>
<style>html,body{margin:0;background:#141517;color:#eee;font:15px system-ui}main{width:min(94vw,${width}px);margin:12px auto}canvas{width:100%;display:block}nav{display:flex;gap:8px;margin:8px 0}button{font:inherit}input{flex:1}
.capture,.capture body{background:transparent;overflow:hidden}.capture main{width:${width}px;margin:0}.capture nav{display:none}</style>
<main><canvas id="c" width="${width}" height="${height}"></canvas>
<nav><button id="play" type="button">Play</button><button id="sound" type="button">Start sound</button><input id="scrub" type="range" min="0" max="${duration}" step="0.01" value="0" aria-label="Time"></nav></main>
<script>${scene}</script>
<script>
const capture = new URLSearchParams(location.search).has('capture');
if (capture) { document.documentElement.className = 'capture'; document.documentElement.style.background = document.body.style.background = Scene.background; }
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
const DURATION = ${duration}, AUDIO_SRC = ${JSON.stringify(audioSrc)};
let t = 0, playing = false, started = 0, audio = null, source = null, element = null;
window.seek = (time) => { t = Math.min(DURATION, Math.max(0, time)); ctx.save(); Scene.draw(ctx, t, canvas.width, canvas.height); ctx.restore(); document.getElementById('scrub').value = t; };
window.ready = Promise.resolve().then(() => window.seek(0));
function frame(now) { if (!playing) return; window.seek((now - started) / 1000); if (t >= DURATION) { playing = false; document.getElementById('play').textContent = 'Play'; return; } requestAnimationFrame(frame); }
function startAudio() {
  if (AUDIO_SRC) { if (!element) return; element.currentTime = t; element.play(); return; }
  if (!audio) return; source?.stop(); source = audio.createBufferSource();
  const data = Scene.sound(audio.sampleRate, DURATION), buffer = audio.createBuffer(1, data.length, audio.sampleRate);
  buffer.copyToChannel(data, 0); source.buffer = buffer; source.connect(audio.destination); source.start(0, t);
}
function stopAudio() { if (AUDIO_SRC) element?.pause(); else source?.stop(); }
document.getElementById('play').onclick = () => { playing = !playing; document.getElementById('play').textContent = playing ? 'Pause' : 'Play'; if (playing) { if (t >= DURATION) t = 0; started = performance.now() - t * 1000; startAudio(); requestAnimationFrame(frame); } else stopAudio(); };
document.getElementById('sound').onclick = () => { if (AUDIO_SRC) element ??= new Audio(AUDIO_SRC); else audio ??= new AudioContext(); if (playing) startAudio(); };
document.getElementById('scrub').oninput = (event) => { window.seek(+event.target.value); if (playing) { started = performance.now() - t * 1000; startAudio(); } };
</script></html>
`;
}

/** Chromium with a page holding the given player file; returns { browser, page }. */
export async function openPlayer(file) {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"] });
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  page.on("pageerror", (error) => { throw error; });
  await page.goto(pathToFileURL(path.resolve(file)).href);
  await page.evaluate(() => window.ready);
  return { browser, page };
}

const pngOf = async (page, time) => {
  const url = await page.evaluate((at) => { window.seek(at); return document.getElementById("c").toDataURL("image/png"); }, time);
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
};

function encoder(argv) {
  const child = spawn("ffmpeg", argv, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))); });
  return { child, done };
}

/** H.264 (and AAC when `wav` is given) of `frames` player frames from `from` seconds, one PNG per frame. */
export async function encodePlayer(page, { out, fps, frames, from = 0, wav = null }) {
  const audioArgs = wav ? ["-i", wav] : [];
  const { child, done } = encoder([
    "-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", ...audioArgs,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps), "-frames:v", String(frames),
    ...(wav ? ["-c:a", "aac", "-b:a", "192k", "-t", String(frames / fps)] : ["-an"]), "-movflags", "+faststart", out,
  ]);
  for (let n = 0; n < frames; n++) {
    if (!child.stdin.write(await pngOf(page, from + n / fps))) await new Promise((resolve) => child.stdin.once("drain", resolve));
  }
  child.stdin.end();
  await done;
}

/** One player frame as a PNG file. */
export async function stillPng(page, time, file) {
  writeFileSync(file, await pngOf(page, time));
}

/**
 * A labelled contact sheet of player frames: cells are [time, label] or
 * [time, label, variant], where variant sets Scene.variant (a styleframe look,
 * a camera position) before the frame is drawn. The variant is restored after.
 */
export async function contactSheet(page, cells, file, { cols = 4, cellWidth = 360 } = {}) {
  const url = await page.evaluate(({ cells: list, cols: columns, cellWidth: w }) => {
    const source = document.getElementById("c"), h = Math.round((w * source.height) / source.width), pad = 12, label = 26;
    const out = document.createElement("canvas"), kept = window.Scene.variant;
    out.width = columns * (w + pad) + pad; out.height = Math.ceil(list.length / columns) * (h + label + pad) + pad;
    const c = out.getContext("2d"); c.fillStyle = "#1d1d1f"; c.fillRect(0, 0, out.width, out.height);
    list.forEach(([time, name, variant], i) => {
      window.Scene.variant = variant ?? kept;
      window.seek(time);
      const x = pad + (i % columns) * (w + pad), y = pad + Math.floor(i / columns) * (h + label + pad);
      c.drawImage(source, x, y + label, w, h);
      c.fillStyle = "#eee"; c.font = "15px monospace"; c.fillText(`${time.toFixed(2)} s  ${name}`, x + 2, y + 18);
    });
    window.Scene.variant = kept;
    return out.toDataURL("image/png");
  }, { cells, cols, cellWidth });
  writeFileSync(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
}

/**
 * The usual single-film delivery: player.html, film.mp4 (from the player, with the
 * scene's sound or a supplied WAV), contact.png and index.html. Leaves the page
 * open for further stills; the caller closes the browser.
 */
export async function renderFilm({ title, sceneFile, contactCells, wav = null, audioSrc = null }) {
  const c = contract();
  const sceneSource = readFileSync(sceneFile, "utf8");
  writeFileSync("player.html", playerHtml({ title, width: c.width, height: c.height, duration: c.duration, scene: sceneSource, audioSrc }));
  writeFileSync("index.html", readFileSync("fixtures/player.html"));
  const soundtrack = wav ?? writeWav(path.join(scratch(), "sound.wav"), loadScene(sceneSource).sound(RATE, c.duration));
  const { browser, page } = await openPlayer("player.html");
  await encodePlayer(page, { out: "film.mp4", fps: c.fps, frames: c.frames, wav: soundtrack });
  await contactSheet(page, contactCells, "contact.png");
  return { browser, page, contract: c, scene: loadScene(sceneSource) };
}

/** Set Scene.variant in the page (a styleframe look, a camera position). */
export const setVariant = (page, variant) => page.evaluate((value) => { window.Scene.variant = value; }, variant);

/** The shared smoke README: `intro` lines come first, the Recipe's `lines` after the file list, `last` at the very end. */
export function readme(title, { intro = [], lines = [], last = null } = {}) {
  return `# ${title}: Kitchen smoke reference
${intro.map((line) => `\n${line}\n`).join("")}
This is not a model's Dish. Kitchen made it by hand to prove that the film toolchain image can render, validate, sanitize and play back a delivery of this Recipe's exact contract. It proves equipment, not taste: the picture and sound are schematic.

Rebuild from the delivery root, inside the film toolchain image, with fixtures mounted:

    node source/render.mjs

- \`source/scene.js\`: the picture, a pure function of time, and its seeded synthesized sound.
- \`source/render.mjs\`: builds the delivery for this Recipe.
- \`source/kit/film-kit.mjs\`: Kitchen's shared smoke equipment (live player, frame-by-frame Chromium capture, FFmpeg encode, contact sheet).
${lines.map((line) => `\n${line}`).join("\n")}

Checks and limits: see \`evidence.json\`. No listening or motion review was done.
${last ? `\n${last}\n` : ""}`;
}

/** The checks every smoke reference reports honestly. */
export const SMOKE_CHECKS = Object.freeze([
  { name: "smoke reference", result: "passed", detail: "Kitchen's no-model reference: rendered frame by frame from the live player inside the film toolchain image." },
  { name: "listening", result: "not-run", detail: "No one listened to this render; it is a toolchain smoke, not a tasting." },
  { name: "motion review", result: "not-run", detail: "Only the contact sheet was produced; motion quality is not claimed." },
]);
