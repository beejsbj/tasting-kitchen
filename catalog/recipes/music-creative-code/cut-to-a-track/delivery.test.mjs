// The film and cut checks run as Kitchen runs them: from a delivery root, on
// the contract shapes the four film-editing recipes use, at a small size.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const SIZE = { width: 320, height: 180 };
const PLAYER = "<!doctype html><title>player</title>";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const SHOTS = [
  `testsrc2=s=320x180:r=24`,
  `color=c=0x1a2238:s=320x180:r=24,drawbox=x=120:y=50:w=80:h=80:c=0xf0c040:t=fill`,
  `mandelbrot=s=320x180:r=24`,
];

const ff = (cwd, argv) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...argv], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};
// A film of shots of the given lengths, with a quiet tone so the true-peak gate passes.
function film(cwd, name, lengths) {
  const inputs = lengths.flatMap((_, i) => ["-f", "lavfi", "-i", SHOTS[i % SHOTS.length]]);
  const frames = lengths.reduce((sum, n) => sum + n, 0);
  const graph = lengths.map((n, i) => `[${i}:v]trim=end_frame=${n},setpts=PTS-STARTPTS[v${i}]`).join(";") + `;${lengths.map((_, i) => `[v${i}]`).join("")}concat=n=${lengths.length}:v=1:a=0,format=yuv420p[v]`;
  ff(cwd, [...inputs, "-f", "lavfi", "-i", "sine=f=330:r=48000", "-filter_complex", `${graph};[${lengths.length}:a]volume=-12dB[a]`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "20", "-c:a", "aac", "-t", String(frames / 24), name]);
}
const edl = (lengths, extra = {}) => {
  let start = 0;
  const shots = lengths.map((n, i) => { const shot = { id: `s${i}`, start, end: start + n, ...(extra[i] ?? {}) }; start += n; return shot; });
  return { fps: 24, frames: start, shots };
};

async function delivery(t, contract) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "film-delivery-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const sub of ["fixtures", "validation", "source", "inputs"]) mkdirSync(path.join(cwd, sub));
  for (const name of ["film.mjs", "cuts.mjs"]) copyFileSync(path.join(here, "validation", name), path.join(cwd, "validation", name));
  writeFileSync(path.join(cwd, "fixtures", "contract.json"), JSON.stringify({ ...SIZE, fps: 24, duration: 2, frames: 48, ...contract }));
  writeFileSync(path.join(cwd, "fixtures", "player.html"), PLAYER);
  writeFileSync(path.join(cwd, "index.html"), PLAYER);
  writeFileSync(path.join(cwd, "player.html"), "<!doctype html><title>live</title>");
  writeFileSync(path.join(cwd, "contact.png"), PNG);
  writeFileSync(path.join(cwd, "README.md"), "# Notes\n");
  writeFileSync(path.join(cwd, "source", "scene.mjs"), "export {};\n");
  writeFileSync(path.join(cwd, "evidence.json"), JSON.stringify({ beats: [{ id: "turn", time: 1 }], checks: [{ name: "render", result: "passed", detail: "rendered 48 frames" }] }));
  const write = (name, value) => writeFileSync(path.join(cwd, name), typeof value === "string" ? value : JSON.stringify(value));
  const run = (script) => spawnSync("node", [`validation/${script}`], { cwd, encoding: "utf8" });
  return { cwd, write, run };
}

const FILES = ["index.html", "film.mp4", "player.html", "contact.png", "README.md", "evidence.json", "edl.json"];

test("one film with an EDL: both checks pass; a missing EDL, a stray beat or a wrong cut fails", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const { cwd, write, run } = await delivery(t, { files: FILES });
  film(cwd, "film.mp4", [20, 28]);
  write("edl.json", edl([20, 28]));
  const passed = run("film.mjs");
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /PASS: .*film\.mp4 true peak/u);
  const cut = run("cuts.mjs");
  assert.equal(cut.status, 0, cut.stderr);
  assert.match(cut.stdout, /PASS: film\.mp4 matches edl\.json: 1 hard cuts declared, 1 confirmed/u);

  write("edl.json", edl([48]));
  assert.match(run("cuts.mjs").stderr, /undeclared cut at frame 20/u);
  write("evidence.json", { beats: [{ id: "late", time: 2.5 }], checks: [{ name: "x", result: "not-run", detail: "y" }] });
  assert.match(run("film.mjs").stderr, /Beat time inside the film: late/u);
  write("evidence.json", { beats: [], checks: [{ name: "x", result: "not-run", detail: "y" }] });
  assert.match(run("film.mjs").stderr, /at least one moment/u);
  rmSync(path.join(cwd, "edl.json"));
  assert.match(run("film.mjs").stderr, /edl\.json/u);
});

test("required cuts: the EDL must declare them and the picture must show them", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const { cwd, write, run } = await delivery(t, { files: FILES, cuts: { required: [16, 32] } });
  film(cwd, "film.mp4", [16, 16, 16]);
  write("edl.json", edl([16, 16, 16]));
  assert.equal(run("cuts.mjs").status, 0);
  write("edl.json", edl([16, 32]));
  const missing = run("cuts.mjs");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /edl has no hard cut at frame 32 .*undeclared cut at frame 32/u);
});

test("two cuts: each film is checked on its own, transitions refused when the contract says so", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const contract = {
    films: ["cut-1.mp4", "film.mp4"],
    files: ["index.html", "cut-1.mp4", "cut-1.edl.json", "film.mp4", "edl.json", "contact.png", "README.md", "evidence.json"],
    cuts: { films: [{ film: "cut-1.mp4", edl: "cut-1.edl.json" }, { film: "film.mp4", edl: "edl.json" }], transitions: false },
  };
  const { cwd, write, run } = await delivery(t, contract);
  rmSync(path.join(cwd, "player.html"));
  film(cwd, "cut-1.mp4", [24, 24]);
  film(cwd, "film.mp4", [12, 12, 24]);
  write("cut-1.edl.json", edl([24, 24]));
  write("edl.json", edl([12, 12, 24]));
  const passed = run("film.mjs");
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /cut-1\.mp4 true peak .*film\.mp4 true peak/u);
  const cuts = run("cuts.mjs");
  assert.equal(cuts.status, 0, cuts.stderr);
  assert.match(cuts.stdout, /cut-1\.mp4 matches cut-1\.edl\.json[\s\S]*film\.mp4 matches edl\.json/u);

  write("edl.json", edl([12, 12, 24], { 1: { in: { transition: "dissolve", frames: 4 } } }));
  assert.match(run("cuts.mjs").stderr, /film\.mp4 and edl\.json disagree: shot 2 comes in on a dissolve; this film takes hard cuts only/u);
  film(cwd, "cut-1.mp4", [24, 30]);
  assert.match(run("film.mjs").stderr, /cut-1\.mp4 frame count/u);
});

test("cue report: each cut's distance from the nearest supplied cue is printed, never gated", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const { cwd, write, run } = await delivery(t, { files: FILES, cuts: { cues: "inputs/cues.json" } });
  film(cwd, "film.mp4", [24, 24]);
  write("edl.json", edl([24, 24]));
  write("inputs/cues.json", { onsets: [{ t: 0.9, sound: "kick", strength: 1 }, { t: 1.5, sound: "clang", strength: 0.8 }] });
  const result = run("cuts.mjs");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Cuts within a frame of a cue: 0\/1\. Nearest cue per cut: 1\.000 s \+100 ms from kick/u);
});
