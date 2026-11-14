// Small film deliveries for the film Recipes' check tests: a temporary
// delivery root holding the Recipe's fixtures and validation scripts, a real
// H.264/AAC film made by the local FFmpeg, and the other required files.
// Checks run as Kitchen runs them: `node validation/<check>.mjs` from the root.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

/** A Chromium-family browser for the player checks: CHROME_PATH, the image's path, then common local installs. */
export const chromePath = [
  process.env.CHROME_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((candidate) => candidate && existsSync(candidate));

const PNG_1x1 = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c636060f80f0000010100005a4d6b8a0000000049454e44ae426082", "hex");

export function ffmpeg(argv, input) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...argv], { input, maxBuffer: 1 << 26 });
  assert.equal(result.status, 0, String(result.stderr));
}

/**
 * Make a delivery root for `recipeDir` with `contract` (overriding the Recipe's
 * own contract, so tests can use a tiny film). Returns the root path.
 * `video` is either undefined (FFmpeg's test pattern) or a function (frame) => RGB24 Buffer.
 */
export async function makeDelivery(t, recipeDir, { contract, evidence, video, volumeDb = -12, files = {} }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "film-delivery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(recipeDir, "fixtures"), path.join(root, "fixtures"), { recursive: true });
  await cp(path.join(recipeDir, "validation"), path.join(root, "validation"), { recursive: true });
  await writeFile(path.join(root, "fixtures/contract.json"), JSON.stringify(contract));
  await writeFile(path.join(root, "index.html"), await readFile(path.join(root, "fixtures/player.html")));
  await writeFile(path.join(root, "contact.png"), PNG_1x1);
  await writeFile(path.join(root, "README.md"), "# Test delivery\n");
  await writeFile(path.join(root, "player.html"), "<!doctype html><canvas></canvas><script>window.seek = () => {}; window.ready = Promise.resolve();</script>\n");
  await mkdir(path.join(root, "source"));
  await writeFile(path.join(root, "source/scene.js"), "// test\n");
  await writeFile(path.join(root, "evidence.json"), JSON.stringify(evidence));
  await writeFilm(path.join(root, "film.mp4"), contract, { video, volumeDb });
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

/** An H.264/AAC film at the contract's size, rate and length, with a quiet synthesized tone. */
export async function writeFilm(file, { width, height, fps, frames }, { video, volumeDb = -12, audio = true } = {}) {
  const duration = frames / fps;
  const audioArgs = audio ? ["-f", "lavfi", "-i", `sine=frequency=330:sample_rate=48000:duration=${duration}`] : [];
  const encode = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-frames:v", String(frames), ...(audio ? ["-af", `volume=${volumeDb}dB`, "-c:a", "aac", "-b:a", "128k"] : []), "-movflags", "+faststart", file];
  if (!video) {
    ffmpeg(["-f", "lavfi", "-i", `testsrc2=s=${width}x${height}:r=${fps}:d=${duration}`, ...audioArgs, ...encode]);
    return;
  }
  const raw = Buffer.concat(Array.from({ length: frames }, (_, frame) => video(frame)));
  ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-", ...audioArgs, ...encode], raw);
}

/** Run a validation script from the delivery root the way Kitchen does. */
export function runCheck(root, script, env = {}) {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", env: { ...process.env, ...env }, timeout: 300000 });
  return { passed: result.status === 0, code: result.status, output: `${result.stdout}${result.stderr}` };
}
