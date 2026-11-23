import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BPM, RATE, render, wavBytes } from "./generator/track.mjs";
import { assessIdentity, compareAudio, decodePcm, THRESHOLDS } from "./validation/audio-identity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const committed = readFileSync(path.join(here, "fixtures", "track.wav"));
const cues = JSON.parse(readFileSync(path.join(here, "fixtures", "cues.json"), "utf8"));
const contract = JSON.parse(readFileSync(path.join(here, "fixtures", "contract.json"), "utf8"));
const generated = render();
const samples = new Int16Array(committed.buffer.slice(committed.byteOffset + 44, committed.byteOffset + committed.length));

test("the committed track and cue sheet are what the seeded generator writes", () => {
  // Byte equality is expected; one step of rounding is allowed in case another engine's Math differs in a last bit.
  const fresh = wavBytes(generated.pcm);
  assert.equal(fresh.length, committed.length);
  assert.deepEqual(fresh.subarray(0, 44), committed.subarray(0, 44), "same WAV header");
  let worst = 0;
  for (let i = 0; i < generated.pcm.length; i++) worst = Math.max(worst, Math.abs(generated.pcm[i] - samples[i]));
  assert(worst <= 1, `regenerated samples differ by ${worst}`);
  assert.deepEqual(generated.cues.onsets, cues.onsets);
  assert.deepEqual(generated.cues.grid, cues.grid);
  assert(generated.cues.envelope.values.every((value, i) => (value === null) === (cues.envelope.values[i] === null) && (value === null || Math.abs(value - cues.envelope.values[i]) <= 0.1)));
});

test("the track is 30 s of 48 kHz stereo with the irregularities the brief promises", () => {
  assert.equal(samples.length, 2 * 30 * RATE);
  assert.equal(committed.readUInt16LE(22), 2);
  assert.equal(committed.readUInt32LE(24), RATE);
  // A long silence: digital zero from 10.5 s to 15.0 s, and the last half-second.
  for (let i = Math.round(10.5 * RATE); i < 15 * RATE; i++) assert.equal(samples[2 * i] | samples[2 * i + 1], 0, `sample at ${i / RATE}`);
  assert.deepEqual(cues.envelope.values.slice(Math.ceil(10.5 * 24), 15 * 24).filter((value) => value !== null), []);
  // One hit off the beat: the clang is the only onset more than 40 ms from the sixteenth-note grid.
  const sixteenth = 60 / BPM / 4;
  const off = cues.onsets.filter((onset) => onset.sound !== "stop" && Math.abs(onset.t / sixteenth - Math.round(onset.t / sixteenth)) * sixteenth > 0.04);
  assert.deepEqual(off.map((onset) => [onset.t, onset.sound]), [[6.97, "clang"]]);
  // A slow rise: each second from 15 s to 25 s is louder than the one before.
  const second = (t) => { const frames = cues.envelope.values.slice(t * 24, (t + 1) * 24).filter((value) => value !== null); return frames.reduce((sum, value) => sum + value, 0) / frames.length; };
  // Nothing is cued where nothing sounds; the hard stops are cued.
  assert.deepEqual(cues.onsets.filter((onset) => (onset.t > 10.5 && onset.t < 15) || onset.t > 29.5), []);
  assert.deepEqual(cues.onsets.filter((onset) => onset.sound === "stop").map((onset) => onset.t), [10.5, 29.5]);
  for (let t = 16; t < 25; t++) assert(second(t) > second(t - 1), `rise between ${t - 1} and ${t} s`);
  for (let i = Math.round(29.5 * RATE); i < 30 * RATE; i++) assert.equal(samples[2 * i] | samples[2 * i + 1], 0, `sample at ${i / RATE}`);
  assert.equal(contract.audio.fixture, "inputs/track.wav");
});

test("the identity bounds forbid a trim: the film keeps the track's level", () => {
  // The WAV's own samples, as FFmpeg would decode them, so this needs no FFmpeg.
  const source = Float32Array.from(samples, (value) => value / 32768);
  const scaled = (db) => source.map((value) => value * 10 ** (db / 20));
  const bounds = { ...THRESHOLDS, minGainDb: contract.audio.minGainDb, maxGainDb: contract.audio.maxGainDb };
  assert.equal(assessIdentity(compareAudio(source, source), bounds).passed, true);
  assert.match(assessIdentity(compareAudio(source, scaled(-3)), bounds).reasons.join(), /level changed by -3\.00 dB/u);
  assert.equal(assessIdentity(compareAudio(source, scaled(-3))).passed, true, "the lyric bounds would have allowed it");
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("real encodes: the track muxed as AAC passes; re-edited, overdubbed or padded sound fails", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cut-to-a-track-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const track = path.join(here, "fixtures", "track.wav");
  const bounds = { ...THRESHOLDS, minGainDb: contract.audio.minGainDb, maxGainDb: contract.audio.maxGainDb };
  const source = decodePcm(track);
  const verdict = async (name, audioArgs) => {
    const film = path.join(directory, `${name}.mp4`);
    const result = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=24:d=30", ...audioArgs, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-t", "30", film], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return assessIdentity(compareAudio(source, decodePcm(film)), bounds);
  };
  const plain = await verdict("plain", ["-i", track]);
  assert.equal(plain.passed, true, plain.reasons.join("; "));
  // Bars moved: 2-4 s replaced by 22-24 s, as an editor fitting music to picture would.
  const remix = path.join(directory, "remix.wav");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", track, "-filter_complex", "[0:a]asplit=3[a][b][c];[a]atrim=0:2[x];[b]atrim=22:24,asetpts=PTS-STARTPTS[y];[c]atrim=4:30,asetpts=PTS-STARTPTS[z];[x][y][z]concat=n=3:v=0:a=1[out]", "-map", "[out]", remix]);
  assert.match((await verdict("remix", ["-i", remix])).reasons.join(), /half-second at 2\.5 s does not match/u);
  // A whoosh laid into the silence.
  const overdub = path.join(directory, "overdub.wav");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", track, "-f", "lavfi", "-i", "anoisesrc=d=0.6:c=pink:a=0.05:r=48000", "-filter_complex", "[1:a]adelay=12000|12000,apad[n];[0:a][n]amix=inputs=2:duration=first:normalize=0[out]", "-map", "[out]", overdub]);
  assert.match((await verdict("overdub", ["-i", overdub])).reasons.join(), /added where the excerpt is silent/u);
  // Started half a second late.
  const late = path.join(directory, "late.wav");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", track, "-af", "adelay=500|500", "-t", "30", late]);
  assert.equal((await verdict("late", ["-i", late])).passed, false);
});
