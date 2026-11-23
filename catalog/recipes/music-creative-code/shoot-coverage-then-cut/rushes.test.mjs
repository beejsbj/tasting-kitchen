import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { conformRuns, readLog } from "./validation/rushes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const ff = (cwd, argv) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...argv], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};

test("the conform groups frames into runs of one clip played forward", () => {
  const matches = [[0, "rushes/a.mp4", 10], [1, "rushes/a.mp4", 11], [2, "rushes/a.mp4", 11], [3, "rushes/b.mp4", 0], [4, null, null], [5, "rushes/b.mp4", 1]]
    .map(([frame, file, clipFrame]) => ({ frame, file, clipFrame }));
  assert.deepEqual(conformRuns(matches).map((run) => [run.from, run.to, run.file, run.clipFrom, run.clipTo]), [
    [0, 1, "rushes/a.mp4", 10, 11], [2, 2, "rushes/a.mp4", 11, 11], [3, 3, "rushes/b.mp4", 0, 0], [4, 4, null, null, null], [5, 5, "rushes/b.mp4", 1, 1],
  ]);
});

test("the rushes log must list every clip with its camera and hash", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rushes-log-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "rushes"));
  for (const name of ["a", "b"]) writeFileSync(path.join(directory, "rushes", `${name}.mp4`), name);
  const cwd = process.cwd();
  process.chdir(directory);
  t.after(() => process.chdir(cwd));
  const files = ["rushes/a.mp4", "rushes/b.mp4"];
  const good = readLog({ clips: [{ file: "rushes/a.mp4", camera: "wide", sha256: sha256("rushes/a.mp4") }, { file: "rushes/b.mp4", camera: "close", sha256: sha256("rushes/b.mp4") }] }, files);
  assert.deepEqual([good.problems, good.cameras], [[], 2]);
  const bad = readLog({ clips: [{ file: "rushes/a.mp4", camera: "", sha256: "0" }, { file: "cuts/x.mp4", camera: "x" }] }, files).problems.join("; ");
  assert.match(bad, /needs a camera/u);
  assert.match(bad, /does not have the sha256/u);
  assert.match(bad, /rushes\/<name>\.mp4/u);
  assert.match(bad, /rushes\/b\.mp4 is in rushes\/ but not in the log/u);
});

// Four takes of one small event, as four cameras would see it, at 320 x 180.
const SIZE = "320x180";
const TAKES = {
  a: `testsrc2=s=${SIZE}:r=24`,
  b: `mandelbrot=s=${SIZE}:r=24`,
  c: `color=c=0x1a2238:s=${SIZE}:r=24,drawbox=x=120:y=50:w=80:h=80:c=0xf0c040:t=fill,noise=alls=20:allf=t`,
  d: `cellauto=s=${SIZE}:r=24:rule=110`,
};
const CONTRACT = {
  width: 320, height: 180, fps: 24, duration: 2, frames: 48,
  rushes: { log: "rushes/rushes.json", minClips: 4, minCameras: 4, minSeconds: 8, maxSeconds: 20, cuts: ["cut-1.mp4", "film.mp4"], anchors: ["cut-1.mp4"] },
};

async function delivery(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rushes-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const sub of ["rushes", "validation", "fixtures"]) mkdirSync(path.join(directory, sub));
  for (const name of ["rushes.mjs", "cuts.mjs"]) copyFileSync(path.join(here, "validation", name), path.join(directory, "validation", name));
  writeFileSync(path.join(directory, "fixtures", "contract.json"), JSON.stringify(CONTRACT));
  for (const [name, source] of Object.entries(TAKES)) ff(directory, ["-f", "lavfi", "-i", source, "-frames:v", "72", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", `rushes/${name}.mp4`]);
  const log = (cameras = ["wide", "high", "close", "floor"]) => writeFileSync(path.join(directory, "rushes", "rushes.json"), JSON.stringify({
    clips: Object.keys(TAKES).map((name, i) => ({ file: `rushes/${name}.mp4`, camera: cameras[i], sha256: sha256(path.join(directory, "rushes", `${name}.mp4`)) })),
  }));
  log();
  return { directory, log };
}

// A cut assembled from rushes segments [clip, first frame, frames, extra filter], re-encoded as an editor's export would be.
function cut(directory, name, segments) {
  const inputs = segments.flatMap(([clip]) => ["-i", `rushes/${clip}.mp4`]);
  const graph = segments.map(([, from, frames, filter], i) => `[${i}:v]trim=start_frame=${from}:end_frame=${from + frames},setpts=PTS-STARTPTS${filter ? `,${filter}` : ""}[v${i}]`).join(";") + `;${segments.map((_, i) => `[v${i}]`).join("")}concat=n=${segments.length}:v=1:a=0,format=yuv420p[v]`;
  ff(directory, [...inputs, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-crf", "26", name]);
}
const check = (directory) => spawnSync("node", ["validation/rushes.mjs"], { cwd: directory, encoding: "utf8" });
const EDIT = [["a", 10, 12], ["c", 30, 12], ["b", 0, 12], ["d", 50, 12]];

test("real encodes: a cut made only from the rushes passes and its conform names the takes", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const { directory } = await delivery(t);
  cut(directory, "cut-1.mp4", EDIT);
  cut(directory, "film.mp4", [["d", 20, 24], ["a", 40, 6], ["a", 40, 6, "reverse"], ["c", 0, 12]]);
  const result = check(directory);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /cut-1\.mp4 conform: 0-11 rushes\/a\.mp4 10-21; 12-23 rushes\/c\.mp4 30-41; 24-35 rushes\/b\.mp4 0-11; 36-47 rushes\/d\.mp4 50-61/u);
  assert.match(result.stdout, /Rushes log rushes\/rushes\.json sha256 [0-9a-f]{64}/u);
  assert.match(result.stdout, /cut-1\.mp4 sha256 [0-9a-f]{64}/u);
  assert.match(result.stdout, /PASS: 4 clips from 4 logged camera positions, 12\.00 s/u);
});

test("real encodes: a graded, titled, reframed or newly drawn frame is not from the rushes", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const { directory } = await delivery(t);
  cut(directory, "film.mp4", EDIT);
  const fails = (segments, pattern) => {
    cut(directory, "cut-1.mp4", segments);
    const result = check(directory);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, pattern);
  };
  fails([["a", 10, 12], ["c", 30, 12, "eq=brightness=0.05"], ["b", 0, 12], ["d", 50, 12]], /cut-1\.mp4: 12 frames are not in the rushes, first at frame 12/u);
  fails([["a", 10, 12], ["c", 30, 12], ["b", 0, 12, "drawbox=x=10:y=140:w=300:h=30:c=white:t=fill:enable='gte(n,6)'"], ["d", 50, 12]], /6 frames are not in the rushes, first at frame 30/u);
  fails([["a", 10, 12], ["c", 30, 12], ["b", 0, 12, "crop=288:162,scale=320:180"], ["d", 50, 12]], /12 frames are not in the rushes, first at frame 24/u);
  // Frame 47 drawn for the cut: a take nobody logged.
  ff(directory, ["-f", "lavfi", "-i", `smptebars=s=${SIZE}:r=24`, "-frames:v", "72", "-c:v", "libx264", "-pix_fmt", "yuv420p", "extra.mp4"]);
  copyFileSync(path.join(directory, "extra.mp4"), path.join(directory, "rushes", "e.mp4"));
  fails([["a", 10, 12], ["c", 30, 12], ["b", 0, 12], ["e", 0, 12]], /rushes\/e\.mp4 is in rushes\/ but not in the log.*cut-1\.mp4: 12 frames are not in the rushes, first at frame 36/u);
});

test("real encodes: rushes changed after logging, a cut inside a take, or too few cameras fail", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const { directory, log } = await delivery(t);
  cut(directory, "cut-1.mp4", EDIT);
  cut(directory, "film.mp4", EDIT);
  assert.equal(check(directory).status, 0);

  log(["wide", "wide", "close", "floor"]);
  assert.match(check(directory).stderr, /3 camera positions logged; at least 4 are required/u);
  log();

  // A take re-rendered after it was logged, with a cut spliced into it.
  ff(directory, ["-f", "lavfi", "-i", TAKES.a, "-f", "lavfi", "-i", TAKES.b, "-filter_complex", "[0:v]trim=end_frame=36[x];[1:v]trim=end_frame=36,setpts=PTS-STARTPTS[y];[x][y]concat=n=2:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-c:v", "libx264", "-crf", "18", "rushes/a.mp4"]);
  const changed = check(directory).stderr;
  assert.match(changed, /rushes\/a\.mp4 does not have the sha256 the log records/u);
  assert.match(changed, /rushes\/a\.mp4 has a cut inside it at frame 36/u);
});

test("real encodes: a light that changes the whole picture inside a take must be listed in the log", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const { directory } = await delivery(t);
  // Take c again, with a lamp switched on at frame 36.
  ff(directory, ["-f", "lavfi", "-i", `${TAKES.c},drawbox=x=0:y=0:w=iw:h=ih:c=white@0.5:t=fill:enable='gte(n,36)'`, "-frames:v", "72", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "rushes/c.mp4"]);
  cut(directory, "cut-1.mp4", EDIT);
  cut(directory, "film.mp4", EDIT);
  const write = (changes) => writeFileSync(path.join(directory, "rushes", "rushes.json"), JSON.stringify({
    clips: Object.keys(TAKES).map((name, i) => ({ file: `rushes/${name}.mp4`, camera: ["wide", "high", "close", "floor"][i], sha256: sha256(path.join(directory, "rushes", `${name}.mp4`)), ...(name === "c" && changes ? { changes } : {}) })),
  }));
  write(null);
  assert.match(check(directory).stderr, /rushes\/c\.mp4 has a cut inside it at frame 36/u);
  write([36]);
  const listed = check(directory);
  assert.equal(listed.status, 0, listed.stderr);
  write([200]);
  assert.match(check(directory).stderr, /lists a change at frame 200; it has 72 frames/u);
  write(["36"]);
  assert.match(check(directory).stderr, /changes must be a list of frame numbers/u);
});
