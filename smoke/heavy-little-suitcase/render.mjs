// Render the no-model smoke reference inside the film toolchain image.
// Run from the delivery root with the fixtures mounted and this directory at source/:
//   node source/render.mjs
// It writes player.html, film.mp4, contact.png, index.html, README.md and evidence.json.
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
// The smoke runner supplies PLAYWRIGHT_CORE; the image supplies CHROME_PATH.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE);
const contract = JSON.parse(readFileSync("fixtures/contract.json", "utf8"));
const scene = readFileSync(path.join(here, "scene.js"), "utf8");
const sound = readFileSync(path.join(here, "sound.js"), "utf8");
const RATE = 48000;

// The live player: the same scene and sound, a pure function of time.
const player = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Heavy little suitcase (live)</title>
<style>body{margin:0;background:#141517;color:#eee;font:15px system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(92vw,50vh)}canvas{width:100%;display:block;background:#efe7d4}nav{display:flex;gap:8px;margin:8px 0}button{font:inherit}</style>
<main><canvas id="c" width="${contract.width}" height="${contract.height}"></canvas>
<nav><button id="play" type="button">Play</button><button id="sound" type="button">Start sound</button><input id="scrub" type="range" min="0" max="${contract.duration}" step="0.01" value="0" aria-label="Time"></nav></main>
<script>${scene}</script>
<script>${sound}</script>
<script>
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
let t = 0, playing = false, started = 0, audio = null, source = null;
window.seek = (time) => { t = Math.min(${contract.duration}, Math.max(0, time)); HeavySuitcase.drawScene(ctx, t); document.getElementById('scrub').value = t; };
window.ready = Promise.resolve().then(() => window.seek(0));
function frame(now) { if (!playing) return; window.seek((now - started) / 1000); if (t >= ${contract.duration}) { playing = false; document.getElementById('play').textContent = 'Play'; return; } requestAnimationFrame(frame); }
function startAudio() { if (!audio) return; source?.stop(); source = audio.createBufferSource(); const data = HeavySuitcaseSound.synthesize(audio.sampleRate); const buffer = audio.createBuffer(1, data.length, audio.sampleRate); buffer.copyToChannel(data, 0); source.buffer = buffer; source.connect(audio.destination); source.start(0, t); }
document.getElementById('play').onclick = () => { playing = !playing; document.getElementById('play').textContent = playing ? 'Pause' : 'Play'; if (playing) { if (t >= ${contract.duration}) t = 0; started = performance.now() - t * 1000; startAudio(); requestAnimationFrame(frame); } else source?.stop(); };
document.getElementById('sound').onclick = () => { audio ??= new AudioContext(); if (playing) startAudio(); };
document.getElementById('scrub').oninput = (event) => { window.seek(+event.target.value); if (playing) { started = performance.now() - t * 1000; startAudio(); } };
</script></html>
`;
writeFileSync("player.html", player);
copyFileSync("fixtures/player.html", "index.html");

// The soundtrack, written outside the delivery.
const scratch = mkdtempSync(path.join(tmpdir(), "suitcase-"));
const wav = path.join(scratch, "sound.wav");
{
  globalThis.eval(sound);
  const data = globalThis.HeavySuitcaseSound.synthesize(RATE, contract.duration);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length * 4, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(32, 34); header.write("data", 36); header.writeUInt32LE(data.length * 4, 40);
  writeFileSync(wav, Buffer.concat([header, Buffer.from(data.buffer)]));
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 600, height: 1000 } });
await page.goto(pathToFileURL(path.resolve("player.html")).href);
await page.evaluate(() => window.ready);

const encoder = spawn("ffmpeg", [
  "-v", "error", "-y", "-f", "image2pipe", "-framerate", String(contract.fps), "-i", "-", "-i", wav,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(contract.fps), "-frames:v", String(contract.frames),
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "film.mp4",
], { stdio: ["pipe", "inherit", "inherit"] });
const encoded = new Promise((resolve, reject) => { encoder.on("error", reject); encoder.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))); });
for (let n = 0; n < contract.frames; n++) {
  const png = await page.evaluate((time) => { window.seek(time); return document.getElementById("c").toDataURL("image/png"); }, n / contract.fps);
  if (!encoder.stdin.write(Buffer.from(png.slice(png.indexOf(",") + 1), "base64"))) await new Promise((resolve) => encoder.stdin.once("drain", resolve));
}
encoder.stdin.end();
await encoded;

// Contact sheet: every beat plus the moments between, labelled with time and beat.
const beats = { "first-attempt": 5.2, "change-of-plan": 9.0, success: 18.45 };
const sheet = [[0.5, "start"], [4.3, "anticipation"], ...Object.entries(beats).map(([id, time]) => [time, id]), [12.8, "tilt"], [14.6, "pivot"], [16.2, "lever"], [20.0, "climb"], [21.9, "relief"], [23.0, "settled"]].sort((a, b) => a[0] - b[0]);
const contact = await page.evaluate((cells) => {
  const cols = 4, w = 270, h = 480, pad = 12, label = 26;
  const out = document.createElement("canvas");
  out.width = cols * (w + pad) + pad; out.height = Math.ceil(cells.length / cols) * (h + label + pad) + pad;
  const c = out.getContext("2d"); c.fillStyle = "#1d1d1f"; c.fillRect(0, 0, out.width, out.height);
  cells.forEach(([time, name], i) => {
    window.seek(time);
    const x = pad + (i % cols) * (w + pad), y = pad + Math.floor(i / cols) * (h + label + pad);
    c.drawImage(document.getElementById("c"), x, y + label, w, h);
    c.fillStyle = "#eee"; c.font = "15px monospace"; c.fillText(`${time.toFixed(2)} s  ${name}`, x + 2, y + 18);
  });
  return out.toDataURL("image/png");
}, sheet);
writeFileSync("contact.png", Buffer.from(contact.slice(contact.indexOf(",") + 1), "base64"));
await browser.close();

writeFileSync("evidence.json", `${JSON.stringify({
  beats: Object.entries(beats).map(([id, time]) => ({ id, time })),
  checks: [
    { name: "smoke reference", result: "passed", detail: "Kitchen's no-model reference: rendered frame by frame from the live player inside the film toolchain image." },
    { name: "listening", result: "not-run", detail: "No one listened to this render; it is a toolchain smoke, not a tasting." },
    { name: "phone-size inspection", result: "not-run", detail: "Only the contact sheet was produced; motion quality is not claimed." },
  ],
}, null, 2)}\n`);
writeFileSync("README.md", `# Heavy little suitcase: Kitchen smoke reference

This is not a model's Dish. Kitchen made it by hand to prove that the film toolchain image can render, validate, sanitize and play back a delivery of this Recipe's exact contract.

Rebuild from the delivery root, inside the film toolchain image, with fixtures mounted:

    node source/render.mjs

- \`source/scene.js\`: the drawing, a pure function of time.
- \`source/sound.js\`: seeded synthesized sound shared by the player and the export.
- \`source/render.mjs\`: builds \`player.html\`, renders each frame in Chromium and encodes with FFmpeg.

Checks and limits: see \`evidence.json\`. No listening or motion review was done; the acting is schematic.
`);
console.log(`rendered ${contract.frames} frames to film.mp4, player.html, contact.png`);
