import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkFilm, compareCuts, cueOffsets, discontinuities, readEdl } from "./validation/cuts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILM_RECIPES = ["cut-to-a-track", "shoot-coverage-then-cut", "the-thing-we-never-see", "same-action-three-styles"];

test("every film-editing recipe carries the same cut and film checks", () => {
  for (const name of ["cuts.mjs", "film.mjs"]) {
    const canonical = readFileSync(path.join(here, "validation", name));
    for (const recipe of FILM_RECIPES) assert.deepEqual(readFileSync(path.resolve(here, "..", recipe, "validation", name)), canonical, `${recipe}/validation/${name} is a copy`);
  }
});

// Difference curves as FFmpeg would measure them, without FFmpeg.
const still = (frames, level = 0.01) => Array.from({ length: frames }, (_, k) => (k === 0 ? 0 : level));
const withSpikes = (curve, spikes) => curve.map((value, k) => spikes[k] ?? value);
const edl = (cuts, frames, extra = {}) => {
  const bounds = [0, ...cuts, frames];
  return { fps: 24, frames, shots: bounds.slice(0, -1).map((start, i) => ({ id: `s${i}`, start, end: bounds[i + 1], ...(extra[i] ?? {}) })) };
};
const compare = (curve, cuts, options = {}) => compareCuts(curve, readEdl(edl(cuts, curve.length, options.shots), { fps: 24, frames: curve.length, transitions: options.transitions ?? true }));

test("a declared cut is confirmed by a spike within one frame, and only once", () => {
  const curve = withSpikes(still(96), { 40: 18 });
  assert.deepEqual(compare(curve, [40]).missing, []);
  assert.deepEqual(compare(curve, [41]).missing, [], "one frame late is the edge convention, not a different edit");
  assert.equal(compare(curve, [42]).missing.length, 1, "two frames off is a different edit");
  assert.equal(compare(curve, [40, 41]).missing.length, 1, "one spike cannot confirm two declared cuts");
  assert.deepEqual(compare(curve, [40]).extra, []);
});

test("an undeclared spike is a cut; motion, steps and animation on twos are not", () => {
  assert.deepEqual(compare(withSpikes(still(96), { 30: 12 }), []).extra.map((d) => d.frame), [30]);
  // Fast steady motion: every frame changes a lot, none stands out.
  assert.deepEqual(compare(still(96, 9), []).extra, []);
  // Motion that starts abruptly: high on one side only.
  assert.deepEqual(compare(still(96).map((value, k) => (k >= 50 ? 9 : value)), []).extra, []);
  // Held on twos and on threes: big changes with still frames between them.
  assert.deepEqual(compare(still(96).map((value, k) => (k % 2 === 0 ? 8 : 0.01)), []).extra, []);
  assert.deepEqual(compare(still(96).map((value, k) => (k % 3 === 0 ? 8 : 0.01)), []).extra, []);
});

test("a one-frame flash is two cuts, and both are found", () => {
  const curve = withSpikes(still(96), { 50: 40, 51: 40 });
  assert.deepEqual(compare(curve, []).extra.map((d) => d.frame), [50, 51]);
  const declared = compare(curve, [50, 51]);
  assert.deepEqual([declared.missing, declared.extra], [[], []]);
});

test("a cut in a fast montage is confirmed against the quieter side", () => {
  const curve = still(96).map((value, k) => (k >= 40 && k % 2 === 0 ? 15 : value));
  const cuts = Array.from({ length: 28 }, (_, i) => 40 + 2 * i);
  assert.deepEqual(compare(curve, cuts).missing, []);
});

test("a small change below the report level is neither a cut nor reported; between levels it is reported", () => {
  assert.deepEqual(compare(withSpikes(still(96), { 30: 1 }), []).unclear, []);
  const middling = compare(withSpikes(still(96), { 30: 3 }), []);
  assert.deepEqual([middling.extra, middling.unclear.map((d) => d.frame)], [[], [30]]);
});

test("a declared transition is exempt over its span and not a hard cut", () => {
  const curve = still(96).map((value, k) => (k >= 40 && k < 52 ? 2 : value));
  const shots = { 1: { in: { transition: "dissolve", frames: 12 } } };
  const read = readEdl(edl([40], 96, shots), { fps: 24, frames: 96 });
  assert.deepEqual([read.cuts, read.spans, read.problems], [[], [[40, 52]], []]);
  assert.deepEqual(compare(curve, [40], { shots }).extra, []);
  assert.match(readEdl(edl([40], 96, shots), { fps: 24, frames: 96, transitions: false }).problems.join(), /hard cuts only/u);
});

test("the EDL must tile the film in frames", () => {
  const problems = (value) => readEdl(value, { fps: 24, frames: 96 }).problems.join("; ");
  assert.match(problems({ fps: 24, frames: 96, shots: [{ id: "a", start: 0, end: 40 }, { id: "b", start: 41, end: 96 }] }), /starts at frame 41/u);
  assert.match(problems({ fps: 24, frames: 96, shots: [{ id: "a", start: 0, end: 90 }] }), /shots end at frame 90/u);
  assert.match(problems({ fps: 25, frames: 96, shots: [{ id: "a", start: 0, end: 96 }] }), /fps 25/u);
  assert.match(problems({ fps: 24, frames: 96, shots: [{ id: "a", start: 0, end: 40 }, { id: "a", start: 40, end: 96 }] }), /repeated/u);
  assert.match(problems({ fps: 24, frames: 96, shots: [{ id: "a", start: 0, end: 40.5 }] }), /integer/u);
  assert.equal(problems(edl([30, 60], 96)), "");
});

test("cue offsets name the nearest cue to each cut", () => {
  const offsets = cueOffsets([24, 167], [{ t: 1, sound: "kick" }, { t: 6.97, sound: "clang" }], 24);
  assert.deepEqual(offsets.map((o) => [o.cue.sound, o.offsetMs]), [["kick", 0], ["clang", -12]]);
});

test("discontinuities skip the frames beside a change when setting the local level", () => {
  const d = discontinuities(withSpikes(still(40), { 20: 10, 21: 10 }));
  assert(d[20].isolated > 100 && d[21].isolated > 100);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const ff = (argv) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...argv], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};

// Shots drawn by FFmpeg sources: different compositions, a pan, a figure held on twos.
const SIZE = "320x180";
const SHOTS = {
  bars: `testsrc2=s=${SIZE}:r=24`,
  fractal: `mandelbrot=s=${SIZE}:r=24`,
  plate: `color=c=0x1a2238:s=${SIZE}:r=24,drawbox=x=120:y=50:w=80:h=80:c=0xf0c040:t=fill`,
  closer: `color=c=0x1a2238:s=${SIZE}:r=24,drawbox=x=80:y=10:w=160:h=160:c=0xf0c040:t=fill`,
  twos: `testsrc2=s=${SIZE}:r=24,fps=12,fps=24`,
  flash: `color=c=white:s=${SIZE}:r=24`,
};
function film(directory, name, segments) {
  const file = path.join(directory, `${name}.mp4`);
  const inputs = segments.flatMap(([source]) => ["-f", "lavfi", "-i", SHOTS[source]]);
  const graph = segments.map(([, frames], i) => `[${i}:v]trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`).join(";") + `;${segments.map((_, i) => `[v${i}]`).join("")}concat=n=${segments.length}:v=1:a=0,format=yuv420p[v]`;
  ff([...inputs, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "20", file]);
  return file;
}
const starts = (segments) => segments.slice(0, -1).reduce((list, [, frames]) => [...list, (list.at(-1) ?? 0) + frames], []);
const total = (segments) => segments.reduce((sum, [, frames]) => sum + frames, 0);

test("real encodes: the cut check passes a true EDL and fails a missing, an extra or a misplaced cut", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cut-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const segments = [["bars", 30], ["plate", 20], ["closer", 25], ["fractal", 30], ["twos", 40]];
  const file = film(directory, "good", segments);
  const frames = total(segments), cuts = starts(segments);
  const check = (declared, required = []) => checkFilm({ film: file, edl: edl(declared, frames), fps: 24, frames, required });

  const good = check(cuts);
  assert.equal(good.passed, true, good.reasons.join("; "));
  assert.equal(good.confirmed.length, cuts.length);
  assert.equal(check(cuts, [50]).passed, true, "a required cut that is declared and real passes");

  const missing = check(cuts.filter((cut) => cut !== 75));
  assert.equal(missing.passed, false);
  assert.match(missing.reasons.join(), /undeclared cut at frame 75/u);

  // Declared inside the fractal's steady zoom; inside animation held on twos it would pass (see cuts.mjs).
  const extra = check([...cuts, 90].sort((a, b) => a - b));
  assert.equal(extra.passed, false);
  assert.match(extra.reasons.join(), /declared cut at frame 90 .* is not in the picture/u);

  const misplaced = check(cuts.map((cut) => (cut === 30 ? 33 : cut)));
  assert.equal(misplaced.passed, false, "three frames off is not the same cut");

  assert.match(check(cuts, [60]).reasons.join(), /no hard cut at frame 60/u);
  assert.match(checkFilm({ film: file, edl: edl(cuts, 200), fps: 24, frames: 200 }).reasons.join(), /has 145 frames/u);
});

test("real encodes: a flash frame must be declared; a dissolve passes as a transition, not in a hard-cuts-only film", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cut-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const flashed = film(directory, "flash", [["fractal", 30], ["flash", 1], ["fractal", 30]]);
  assert.match(checkFilm({ film: flashed, edl: edl([], 61), fps: 24, frames: 61 }).reasons.join(), /undeclared cut at frame 30.*undeclared cut at frame 31/u);
  assert.equal(checkFilm({ film: flashed, edl: edl([30, 31], 61), fps: 24, frames: 61 }).passed, true);

  const dissolved = path.join(directory, "dissolve.mp4");
  ff(["-f", "lavfi", "-i", SHOTS.bars, "-f", "lavfi", "-i", SHOTS.plate, "-filter_complex", "[0:v]trim=end_frame=48,setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=48,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=0.5:offset=1.5,format=yuv420p[v]", "-map", "[v]", "-c:v", "libx264", "-crf", "20", dissolved]);
  const frames = 84, transition = { 1: { in: { transition: "dissolve", frames: 12 } } };
  const asTransition = checkFilm({ film: dissolved, edl: edl([36], frames, transition), fps: 24, frames });
  assert.equal(asTransition.passed, true, asTransition.reasons.join("; "));
  assert.equal(checkFilm({ film: dissolved, edl: edl([36], frames, transition), fps: 24, frames, transitions: false }).passed, false, "a hard-cuts-only film refuses it");
});

test("real encodes at 1920 x 1080: a pan and a reframing cut on a flat ground", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cut-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "hd.mp4");
  const plate = (x, w) => `color=c=0x1a2238:s=1920x1080:r=24,drawbox=x=${x}:y=${540 - w / 2}:w=${w}:h=${w}:c=0xf0c040:t=fill`;
  ff(["-f", "lavfi", "-i", plate(860, 200), "-f", "lavfi", "-i", plate(760, 400), "-f", "lavfi", "-i", "mandelbrot=s=3840x1080:r=24",
    "-filter_complex", "[0:v]trim=end_frame=24,setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=24,setpts=PTS-STARTPTS[b];[2:v]trim=end_frame=24,setpts=PTS-STARTPTS,crop=1920:1080:x='n*60':y=0[c];[a][b][c]concat=n=3:v=1:a=0,format=yuv420p[v]",
    "-map", "[v]", "-c:v", "libx264", "-crf", "23", file]);
  const result = checkFilm({ film: file, edl: edl([24, 48], 72), fps: 24, frames: 72 });
  assert.equal(result.passed, true, result.reasons.join("; "));
  assert.equal(checkFilm({ film: file, edl: edl([48], 72), fps: 24, frames: 72 }).passed, true, "the 200-to-400 px reframe (about 3%) is below the undeclared-cut level: reported, not failed");
  assert.deepEqual(checkFilm({ film: file, edl: edl([48], 72), fps: 24, frames: 72 }).unclear.map((d) => d.frame), [24]);
});
