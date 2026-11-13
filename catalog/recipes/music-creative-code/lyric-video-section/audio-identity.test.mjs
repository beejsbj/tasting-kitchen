import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assessIdentity, compareAudio, decodePcm, RATE } from "./validation/audio-identity.mjs";

// A synthetic, deterministic "song": chords with a pulse, noise bursts and one silent bar.
function song(seconds = 8) {
  const n = Math.round(seconds * RATE);
  const pcm = new Float32Array(2 * n);
  let seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const silent = t >= 5 && t < 6;
    const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.2 * t);
    const chord = Math.sin(2 * Math.PI * 220 * t) + 0.6 * Math.sin(2 * Math.PI * 277.2 * t + 1) + 0.4 * Math.sin(2 * Math.PI * 329.6 * t * (1 + 0.002 * Math.sin(t)));
    const burst = (t % 0.5) < 0.04 ? noise() * 1.5 : 0;
    const value = silent ? 0 : 0.2 * pulse * chord + 0.2 * burst;
    pcm[2 * i] = value;
    pcm[2 * i + 1] = silent ? 0 : 0.8 * value + 0.05 * Math.sin(2 * Math.PI * 440 * t);
  }
  return pcm;
}

const source = song();
const frames = (pcm) => pcm.length / 2;
const map = (pcm, fn) => { const out = new Float32Array(pcm.length); for (let i = 0; i < frames(pcm); i++) { const [l, r] = fn(i); out[2 * i] = l; out[2 * i + 1] = r; } return out; };
const at = (pcm, i) => (i >= 0 && i < frames(pcm) ? [pcm[2 * i], pcm[2 * i + 1]] : [0, 0]);
const verdict = (candidate) => assessIdentity(compareAudio(source, candidate));

test("the exact excerpt, or a uniform trim of it, is the excerpt", () => {
  const same = compareAudio(source, source);
  assert.equal(same.lagSamples, 0);
  assert(Math.abs(same.gainDb) < 1e-6);
  assert(same.minWindowCorrelation > 0.9999);
  assert.equal(assessIdentity(same).passed, true);
  const trimmed = compareAudio(source, map(source, (i) => at(source, i).map((value) => value * 10 ** (-1 / 20))));
  assert(Math.abs(trimmed.gainDb + 1) < 0.01, "a -1 dB trim is measured and reported");
  assert.equal(assessIdentity(trimmed).passed, true);
  assert(trimmed.maxGainDeviationDb < 0.01, "a uniform trim is uniform in every half-second");
  const deepest = compareAudio(source, map(source, (i) => at(source, i).map((value) => value * 10 ** (-6 / 20))));
  assert.equal(assessIdentity(deepest).passed, true, "the brief's deepest trim, -6 dB, is accepted");
});

test("a fade, a level ride or a trim past -6 dB is not a uniform trim", () => {
  const fade = verdict(map(source, (i) => { const t = i / RATE; return at(source, i).map((value) => value * (t > 6 ? 10 ** ((-6 * (t - 6)) / 2 / 20) : 1)); }));
  assert.equal(fade.passed, false);
  assert.match(fade.reasons.join(), /half-second at 7\.5 s differs from the overall trim/u);

  const ride = verdict(map(source, (i) => { const t = i / RATE; return at(source, i).map((value) => value * (t >= 2 && t < 4 ? 10 ** (-3 / 20) : 1)); }));
  assert.equal(ride.passed, false, "two seconds pulled down 3 dB is a level ride");

  assert.match(verdict(map(source, (i) => at(source, i).map((value) => value * 10 ** (-7 / 20)))).reasons.join(), /level changed by -7\.00 dB/u);
});

test("a late, stretched, louder, shortened, replaced or overdubbed soundtrack is not the excerpt", () => {
  const delay = Math.round(0.06 * RATE);
  const late = verdict(map(source, (i) => at(source, i - delay)));
  assert.equal(late.passed, false);
  assert.match(late.reasons.join(), /offset 60\.0 ms/u);

  const stretched = verdict(map(source, (i) => { const x = i / 1.005, k = Math.floor(x), f = x - k; return at(source, k).map((value, c) => value * (1 - f) + at(source, k + 1)[c] * f); }));
  assert.equal(stretched.passed, false);

  assert.match(verdict(map(source, (i) => at(source, i).map((value) => value * 10 ** (1 / 20)))).reasons.join(), /level changed by 1\.00 dB/u);

  const short = verdict(source.subarray(0, 2 * (frames(source) - Math.round(0.5 * RATE))));
  assert.match(short.reasons.join(), /soundtrack is 7\.500 s/u);

  const replaced = verdict(map(source, (i) => (i >= 2 * RATE && i < 2.5 * RATE ? at(source, i + 3 * RATE) : at(source, i))));
  assert.equal(replaced.passed, false);
  assert.match(replaced.reasons.join(), /half-second at 2\.0 s/u);

  const overdub = verdict(map(source, (i) => { const t = i / RATE; const beep = t >= 5.2 && t < 5.4 ? 0.05 * Math.sin(2 * Math.PI * 1000 * t) : 0; return at(source, i).map((value) => value + beep); }));
  assert.match(overdub.reasons.join(), /added where the excerpt is silent/u);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("an AAC film soundtrack of the excerpt passes through a real decode", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "audio-identity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const raw = path.join(directory, "source.f32");
  await writeFile(raw, Buffer.from(source.buffer));
  const wav = path.join(directory, "excerpt.wav");
  const film = path.join(directory, "film.mp4");
  const encode = (argv) => assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", ...argv]).status, 0);
  encode(["-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", raw, "-c:a", "pcm_s16le", wav]);
  encode(["-f", "lavfi", "-i", "color=c=black:s=64x64:r=30:d=8", "-i", wav, "-af", "volume=-1dB", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", film]);
  const metrics = compareAudio(decodePcm(wav), decodePcm(film));
  assert.equal(assessIdentity(metrics).passed, true, JSON.stringify(metrics));
  assert(Math.abs(metrics.lagMs) < 1, "ffmpeg's edit list removes the AAC priming delay");
});
