import assert from "node:assert/strict";
import test from "node:test";

import { analyze, compareBeats, FPS, RATE } from "./analysis/excerpt-analysis.mjs";

// A synthetic groove with a known grid: kick on every beat at 150 BPM from 0.23 s,
// an off-beat hat, a sustained pad and a quiet first second.
const BPM = 150, FIRST = 0.23, SECONDS = 12;
function groove() {
  const n = SECONDS * RATE, out = new Float32Array(n);
  let seed = 3;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  const period = 60 / BPM;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const k = t - FIRST - Math.floor((t - FIRST) / period) * period;
    const kick = t >= FIRST ? Math.exp(-k * 30) * Math.sin(2 * Math.PI * 60 * k) : 0;
    const h = (k + period / 2) % period;
    const hat = t >= FIRST ? Math.exp(-h * 80) * noise() * 0.4 : 0;
    const pad = 0.05 * Math.sin(2 * Math.PI * 330 * t) * Math.min(1, t);
    out[i] = 0.6 * kick + hat + pad;
  }
  return out;
}

const result = analyze(groove());
const truth = Array.from({ length: Math.floor((SECONDS - FIRST) * BPM / 60) + 1 }, (_, i) => FIRST + (i * 60) / BPM).filter((t) => t < SECONDS);

test("the analysis is in the engine's data/audio.json shape", () => {
  assert.equal(result.duration, SECONDS);
  assert.equal(result.fps, FPS);
  for (const name of ["rms", "low", "mid", "high"]) {
    assert.equal(result[name].length, SECONDS * FPS, `${name} has one value per frame`);
    assert(result[name].every((value) => value >= 0 && value <= 1), `${name} is normalized to 0..1`);
  }
  assert(Array.isArray(result.beats) && Array.isArray(result.downbeats));
  assert.deepEqual(result.sections, [{ name: "section", start: 0, end: SECONDS }]);
  assert(result.onsets.mix.every(([t, strength]) => t >= 0 && t <= SECONDS && strength > 0 && strength <= 1));
  assert.match(result.notes, /downbeats and section boundaries are not inferred/u, "the file says what it does not know");
});

test("beats land on a known grid, with its tempo", () => {
  assert(Math.abs(result.bpm - BPM) < 1.5, `tempo ${result.bpm}`);
  const agreement = compareBeats(result.beats, truth, 0.02);
  assert(agreement.withinTolerance >= 0.95, JSON.stringify(agreement));
  assert(Math.abs(result.beats.length - truth.length) <= 1, `${result.beats.length} beats for ${truth.length}`);
});

test("envelopes follow the music: the kick is low, the quiet start is quiet", () => {
  const frame = (t) => Math.round(t * FPS);
  const kick = frame(FIRST + 60 / BPM * 8 + 0.01), between = frame(FIRST + 60 / BPM * 8.5 + 0.03);
  assert(result.low[kick] > result.low[between], "low band peaks on the kick");
  assert(result.rms[frame(0.1)] < 0.2, "the opening is quiet before the groove starts");
});
