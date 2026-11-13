// Render the lyric Recipe's no-model smoke reference with the pinned engine,
// inside the film toolchain image. Run from the delivery root, with Kitchen's
// engine at engine/, the private inputs at inputs/ and this directory at source/:
//   node source/render.mjs
// Lyric text and audio are read from inputs/ at render time; none is in this source.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const contract = JSON.parse(readFileSync("fixtures/contract.json", "utf8"));
const lyrics = JSON.parse(readFileSync(contract.lyricsFixture, "utf8"));
const words = lyrics.lines.flatMap((line) => line.words);
const run = (argv, cwd) => execFileSync(argv[0], argv.slice(1), { cwd, stdio: ["ignore", "inherit", "inherit"] });
const scratch = mkdtempSync(path.join(tmpdir(), "lyric-"));
const TRIM_DB = -1; // the excerpt peaks at +0.4 dBTP; the film check allows at most -0.1

// 1. Wire the supplied inputs and this source into Kitchen's engine.
copyFileSync("inputs/excerpt.wav", "engine/audio/track.wav");
copyFileSync(contract.lyricsFixture, "engine/data/lyrics.json");
copyFileSync(path.join(here, "timeline.ts"), "engine/app/src/timeline.ts");
copyFileSync(path.join(here, "scenes/words.ts"), "engine/app/src/scenes/words.ts");

// 2. Kitchen's music analysis of the excerpt, supplied to every model as inputs/audio.json.
copyFileSync("inputs/audio.json", "engine/data/audio.json");

// 3. Render with the engine's offline renderer, words shown on their measured onsets (no display lead).
const app = path.resolve("engine/app");
const raw = path.join(scratch, "raw.mp4");
run(["bun", "scripts/render.ts", "video", "--from", "0", "--to", String(contract.duration), "--fps", String(contract.fps), "--crf", "18", "--preset", "veryfast", "--tune", "none", "--noaudio", "--lead", "0", "--out", raw], app);
run(["bun", "scripts/render.ts", "sheet", "--from", "0.5", "--to", String(contract.duration - 0.5), "--n", "30", "--cols", "6", "--lead", "0", "--out", path.resolve("contact.png")], app);

// 4. Encode the delivery: the engine's 1920x1080 frames at the contract size, the supplied audio under them.
run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-i", "inputs/excerpt.wav", "-map", "0:v:0", "-map", "1:a:0",
  "-vf", `scale=${contract.width}:${contract.height}:flags=lanczos`, "-r", String(contract.fps), "-frames:v", String(contract.frames),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-af", `volume=${TRIM_DB}dB`, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "film.mp4"]);

// 5. A self-contained live preview: the same words on the same onsets, sound from the film.
const timing = lyrics.lines.map((line) => ({ start: line.start, end: line.end, words: line.words.map((word) => [word.w, word.start]) }));
writeFileSync("player.html", `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lyric video section (live preview)</title>
<style>body{margin:0;background:#141517;color:#eee;font:15px system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(96vw,1280px)}canvas{width:100%;display:block}button{font:inherit;margin-top:8px}</style>
<main><canvas id="c" width="${contract.width}" height="${contract.height}"></canvas><button id="play" type="button">Play with sound</button></main>
<script>
const LINES = ${JSON.stringify(timing)};
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
const audio = new Audio('film.mp4');
window.seek = (t) => {
  ctx.fillStyle = '#f4efe6'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const line = LINES.find((l) => t >= l.start && t < l.end) ?? [...LINES].reverse().find((l) => l.start <= t);
  if (!line) return;
  ctx.font = '800 69px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const widths = line.words.map(([w]) => ctx.measureText(w + ' ').width);
  let x = Math.max(40, (canvas.width - widths.reduce((a, b) => a + b, 0)) / 2);
  line.words.forEach(([w, start], i) => { ctx.fillStyle = t >= start ? '#15131a' : 'rgba(21,19,26,0.12)'; ctx.fillText(w, x, canvas.height / 2); x += widths[i]; });
};
window.ready = Promise.resolve().then(() => window.seek(0));
const tick = () => { window.seek(audio.currentTime); if (!audio.paused) requestAnimationFrame(tick); };
document.getElementById('play').onclick = () => { if (audio.paused) { audio.play(); requestAnimationFrame(tick); } else audio.pause(); };
</script></html>
`);
copyFileSync("fixtures/player.html", "index.html");

writeFileSync("evidence.json", `${JSON.stringify({
  words: words.map((word) => ({ w: word.w, shownAt: word.start })),
  checks: [
    { name: "smoke reference", result: "passed", detail: "Kitchen's no-model reference rendered with the pinned engine inside the film toolchain image." },
    { name: "level trim", result: "passed", detail: `The supplied excerpt was trimmed uniformly by ${TRIM_DB} dB so the AAC film stays under the -0.1 dBTP ceiling.` },
    { name: "listening", result: "not-run", detail: "No one listened to this render; it is a toolchain smoke, not a tasting." },
  ],
}, null, 2)}\n`);
mkdirSync("source/scenes", { recursive: true });
writeFileSync("README.md", `# Lyric video section: Kitchen smoke reference

This is not a model's Dish. Kitchen made it to prove that the pinned lyric engine renders the supplied timing, and that the film, audio identity, sanitization and private playback paths work end to end.

Governing idea: none. Each word appears in ink on paper at its supplied onset, so timing can be checked by eye.

Rebuild from the delivery root, inside the film toolchain image, with engine/ and inputs/ supplied:

    node source/render.mjs

Limits: the scene ignores the supplied beats; the engine's 1920x1080 frames are scaled to 1280x720; the excerpt is trimmed by ${-TRIM_DB} dB to respect the film check's true-peak ceiling. No listening review was done.
`);
console.log(`rendered ${contract.frames} frames and ${words.length} word onsets`);
