// Sets a stage the way Kitchen's runner mounts this Recipe, and plays the hand-written
// sample sets through the room. Shared by room.test.mjs and scripts/verify-music-room-browser.mjs.
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const recipeDirectory = import.meta.dirname;

/** Copy every fixture of recipe.json to its mount path under `stage`. */
export async function mountRoom(stage) {
  const recipe = JSON.parse(await readFile(path.join(recipeDirectory, "recipe.json"), "utf8"));
  for (const fixture of recipe.setup.fixtures) {
    const target = path.join(stage, fixture.mountAs);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(recipeDirectory, fixture.path), target);
  }
  return recipe;
}

/** The twelve patterns of samples/<name>.strudel, in order. */
export async function sampleSteps(name) {
  const text = await readFile(path.join(recipeDirectory, "samples", `${name}.strudel`), "utf8");
  return text.split(/^\/\/ --- step \d+\n/mu).slice(1).map((code) => `${code.trim()}\n`);
}

/** Run the mounted room's command line as a model would, from the stage. */
export function room(stage, ...argv) {
  const result = spawnSync(process.execPath, ["room/room.mjs", ...argv], { cwd: stage, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* usage errors print to stderr */ }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

/** Write one pattern file and play it. */
export async function playPattern(stage, name, code) {
  const file = path.join(stage, "patterns", `${name}.js`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  return room(stage, "play", path.relative(stage, file));
}

/** Play a whole sample set, one step after another. */
export async function playSample(stage, name) {
  const printouts = [];
  for (const [index, code] of (await sampleSteps(name)).entries()) {
    const played = await playPattern(stage, String(index + 1).padStart(2, "0"), code);
    if (played.status !== 0) throw new Error(`sample ${name} step ${index + 1} was refused: ${played.json?.error ?? played.stderr}`);
    printouts.push(played.json);
  }
  return printouts;
}
