// Kitchen's music analysis of the lyric excerpt, in the engine's data/audio.json
// shape, so every model and layer gets the same beats and envelopes and the
// Recipe tastes the film rather than beat detection. The result is derived from
// the private excerpt and is itself private: write it beside excerpt.wav.
//   node analysis/excerpt-analysis.mjs <excerpt.wav> <audio.json> [--compare other-audio.json]
// --compare prints only aggregate agreement with another analysis's beats.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RATE = 48000;
export const FPS = 100;
const HOP = RATE / FPS;
const ENV_WINDOW = 2048;
const BANDS = { low: [null, 150], mid: [150, 2000], high: [4000, null] };
// Narrower bands only feed the onset envelope: a kick, a snare and a consonant each rise in their own.
const ONSET_BANDS = [[null, 150], [150, 400], [400, 1000], [1000, 2500], [2500, 6000], [6000, null]];
const MIN_BPM = 60;
const MAX_BPM = 200;
const PRIOR_BPM = 120; // log-normal tempo prior, as librosa's beat tracker uses
const TIGHTNESS = 100; // penalty on beat-interval deviation in the dynamic program

export function decodeMono(file) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`Cannot decode ${file}: ${result.stderr?.toString().trim() || result.error?.message}`);
  const bytes = result.stdout;
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
}

/** RBJ biquad, run forward then backward so the envelopes keep the music's timing. */
function biquad(signal, type, frequency) {
  const w = (2 * Math.PI * frequency) / RATE, q = Math.SQRT1_2, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w);
  const [b0, b1, b2] = type === "low" ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  const pass = (x) => {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
  return pass(pass(signal).reverse()).reverse();
}

function band(signal, [lo, hi]) {
  let out = signal;
  if (lo) out = biquad(out, "high", lo);
  if (hi) out = biquad(out, "low", hi);
  return out;
}

/** Centered RMS at FPS frames. */
function frameRms(signal, frames, window = ENV_WINDOW) {
  const prefix = new Float64Array(signal.length + 1);
  for (let i = 0; i < signal.length; i++) prefix[i + 1] = prefix[i] + signal[i] * signal[i];
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const from = Math.max(0, Math.round(f * HOP - window / 2)), to = Math.min(signal.length, Math.round(f * HOP + window / 2));
    out[f] = to > from ? Math.sqrt((prefix[to] - prefix[from]) / (to - from)) : 0;
  }
  return out;
}

/** 10 ms attack, 90 ms release, like the upstream analysis. */
function smooth(envelope, attack = 0.01, release = 0.09) {
  const up = 1 - Math.exp(-1 / (attack * FPS)), down = 1 - Math.exp(-1 / (release * FPS));
  const out = new Float32Array(envelope.length);
  let state = 0;
  for (let i = 0; i < envelope.length; i++) { const x = envelope[i]; state += (x > state ? up : down) * (x - state); out[i] = state; }
  return out;
}

function percentile(values, p) {
  const sorted = Float32Array.from(values).sort();
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
}

/** Divide by the 99th percentile and clip to 0..1; three decimals keep the file small. */
function normalize(envelope) {
  const reference = percentile(envelope, 99) || 1;
  return Array.from(envelope, (value) => Math.round(Math.min(1, value / reference) * 1000) / 1000);
}

/** Half-wave-rectified rise of log energy in one band. */
function bandRise(signal, range, frames) {
  const energy = frameRms(band(signal, range), frames, 1024);
  const floor = percentile(energy, 50) * 0.01 + 1e-9;
  const rise = new Float32Array(frames);
  for (let f = 1; f < frames; f++) rise[f] = Math.max(0, Math.log(energy[f] + floor) - Math.log(energy[f - 1] + floor));
  return rise;
}

/** Summed band rises, mean removed: high where something starts. The lowest band's rise is kept for phase. */
export function onsetStrength(signal, frames) {
  const strength = new Float32Array(frames);
  let low = null;
  for (const range of ONSET_BANDS) {
    const rise = bandRise(signal, range, frames);
    low ??= rise;
    for (let f = 0; f < frames; f++) strength[f] += rise[f];
  }
  const mean = strength.reduce((sum, value) => sum + value, 0) / frames;
  return { strength: strength.map((value) => Math.max(0, value - mean)), low };
}

/**
 * A tracker can lock onto the off-beat (hats between kicks). Like the upstream
 * analysis, settle the phase on kick attacks: if the low band rises more half a
 * beat later, move the grid there.
 */
function settlePhase(beats, low, period) {
  const half = Math.round(period / 2);
  const near = (f) => Math.max(...[-1, 0, 1].map((d) => low[f + d] ?? 0));
  const on = beats.reduce((sum, f) => sum + near(f), 0);
  const off = beats.reduce((sum, f) => sum + near(f + half), 0);
  if (!(off > 1.25 * on) || beats.length === 0) return beats;
  const moved = beats.map((f) => f + half).filter((f) => f < low.length);
  return beats[0] - half >= 0 ? [beats[0] - half, ...moved] : moved;
}

/** Onset strength minus its one-second moving average: the pulse without the slow swell. */
function detrend(strength) {
  const radius = FPS / 2, out = new Float32Array(strength.length);
  let sum = 0, count = 0;
  for (let f = 0; f < Math.min(radius, strength.length); f++) { sum += strength[f]; count++; }
  for (let f = 0; f < strength.length; f++) {
    if (f + radius < strength.length) { sum += strength[f + radius]; count++; }
    if (f - radius - 1 >= 0) { sum -= strength[f - radius - 1]; count--; }
    out[f] = strength[f] - sum / count;
  }
  return out;
}

/** Tempo candidates (BPM, fit) from the detrended onset autocorrelation under a tempo prior. */
export function tempoCandidates(strength) {
  const pulse = detrend(strength);
  const autocorrelation = (period) => { let sum = 0; for (let f = period; f < pulse.length; f++) sum += pulse[f] * pulse[f - period]; return sum / (pulse.length - period); };
  const candidates = [];
  for (let period = Math.ceil((60 / MAX_BPM) * FPS); period <= Math.floor((60 / MIN_BPM) * FPS); period++) {
    const prior = Math.exp(-0.5 * Math.log2((60 * FPS) / period / PRIOR_BPM) ** 2);
    candidates.push({ period, fit: autocorrelation(period) * prior, raw: autocorrelation(period) });
  }
  // Refine each local maximum to a fractional period with a parabola through its neighbours.
  const peaks = candidates.filter((c, i) => i > 0 && i < candidates.length - 1 && c.fit >= candidates[i - 1].fit && c.fit >= candidates[i + 1].fit);
  return peaks.map((c) => {
    const [a, b, d] = [autocorrelation(c.period - 1), c.raw, autocorrelation(c.period + 1)];
    const shift = a - 2 * b + d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - d)) / (a - 2 * b + d))) : 0;
    return { period: c.period + shift, bpm: (60 * FPS) / (c.period + shift), fit: c.fit };
  }).sort((x, y) => y.fit - x.fit);
}

/** Ellis's dynamic-programming beat tracker on the onset envelope. */
function trackBeats(strength, period) {
  const scale = percentile(strength, 99) || 1;
  const onset = strength.map((value) => value / scale);
  const total = new Float64Array(onset.length), previous = new Int32Array(onset.length).fill(-1);
  for (let f = 0; f < onset.length; f++) {
    let best = 0, from = -1;
    for (let p = Math.max(0, Math.round(f - 2 * period)); p <= f - Math.round(period / 2); p++) {
      const candidate = total[p] - TIGHTNESS * Math.log((f - p) / period) ** 2;
      if (from < 0 || candidate > best) { best = candidate; from = p; }
    }
    total[f] = onset[f] + (from >= 0 ? Math.max(0, best) : 0);
    previous[f] = from >= 0 && best > 0 ? from : -1;
  }
  // Start from the strongest cumulative total in the last beat period.
  let last = onset.length - 1;
  for (let f = Math.max(0, Math.round(onset.length - period)); f < onset.length; f++) if (total[f] > total[last]) last = f;
  const beats = [];
  for (let f = last; f >= 0; f = previous[f]) beats.unshift(f);
  return beats;
}

/** Local maxima of onset strength above an adaptive threshold, as [time, strength 0..1]. */
function pickOnsets(strength) {
  const reference = percentile(strength, 95) || 1;
  const radius = 5, meanRadius = 20;
  const onsets = [];
  for (let f = 1; f < strength.length - 1; f++) {
    const value = strength[f];
    let isPeak = value > 0;
    let mean = 0, count = 0;
    for (let k = Math.max(0, f - meanRadius); k <= Math.min(strength.length - 1, f + meanRadius); k++) {
      if (Math.abs(k - f) <= radius && strength[k] > value) isPeak = false;
      mean += strength[k]; count++;
    }
    if (isPeak && value > 1.5 * (mean / count) + 0.1 * reference) onsets.push([f / FPS, Math.round(Math.min(1, value / reference) * 1000) / 1000]);
  }
  return onsets;
}

export function analyze(signal) {
  const duration = signal.length / RATE;
  const frames = Math.ceil(duration * FPS);
  const envelopes = { rms: normalize(smooth(frameRms(signal, frames))) };
  for (const [name, range] of Object.entries(BANDS)) envelopes[name] = normalize(smooth(frameRms(band(signal, range), frames)));
  const { strength, low } = onsetStrength(signal, frames);
  const candidates = tempoCandidates(strength);
  if (!candidates.length) throw new Error("No tempo found in the onset envelope");
  const period = candidates[0].period;
  const beats = settlePhase(trackBeats(strength, period), low, period).map((frame) => frame / FPS);
  const intervals = beats.slice(1).map((beat, i) => beat - beats[i]).sort((a, b) => a - b);
  const beatPeriod = intervals.length ? intervals[intervals.length >> 1] : period / FPS;
  return {
    duration: Math.round(duration * 1000) / 1000,
    bpm: Math.round((60 / beatPeriod) * 100) / 100,
    beat_period: Math.round(beatPeriod * 10000) / 10000,
    beats,
    downbeats: [],
    sections: [{ name: "section", start: 0, end: Math.round(duration * 1000) / 1000 }],
    fps: FPS,
    ...envelopes,
    onsets: { mix: pickOnsets(strength) },
    notes: "Kitchen analysis (catalog/recipes/music-creative-code/lyric-video-section/analysis/excerpt-analysis.mjs) of the full mix only. "
      + "beats: dynamic-programming tracker on a six-band log-energy onset envelope at 100 fps (10 ms resolution), phase settled on low-band (kick) attacks; the tempo may read at half or double the felt pulse. "
      + "downbeats and section boundaries are not inferred. rms, low (<150 Hz), mid (150-2000 Hz) and high (>4 kHz): 100 fps, 10 ms attack / 90 ms release, "
      + "each divided by its 99th percentile and clipped to 0..1. No stems: vocal, drums, bass and other are absent and read as 0. "
      + "onsets.mix: [time, strength 0..1] peaks of the onset envelope. Lyric timing is in lyrics.json, not here.",
  };
}

/** Aggregate agreement of two beat lists; prints no times. */
export function compareBeats(ours, theirs, tolerance = 0.07) {
  const nearest = (list, t) => list.reduce((best, value) => (Math.abs(value - t) < Math.abs(best - t) ? value : best), Infinity);
  const offsets = ours.map((t) => Math.abs(nearest(theirs, t) - t)).sort((a, b) => a - b);
  return {
    ours: ours.length,
    theirs: theirs.length,
    withinTolerance: offsets.filter((offset) => offset <= tolerance).length / (offsets.length || 1),
    medianOffsetMs: (offsets[offsets.length >> 1] ?? NaN) * 1000,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [input, output, flag, other] = process.argv.slice(2);
  if (!input || !output || (flag && flag !== "--compare") || (flag && !other)) {
    console.error("usage: node excerpt-analysis.mjs <excerpt.wav> <audio.json> [--compare other-audio.json]");
    process.exit(2);
  }
  const analysis = analyze(decodeMono(input));
  writeFileSync(output, `${JSON.stringify(analysis)}\n`);
  console.log(`wrote ${output}: ${analysis.duration} s, ${analysis.beats.length} beats at ${analysis.bpm} BPM, ${analysis.onsets.mix.length} onsets, ${analysis.rms.length} envelope frames`);
  if (other) {
    const theirs = JSON.parse(readFileSync(other, "utf8"));
    const agreement = compareBeats(analysis.beats, theirs.beats);
    console.log(`against ${other}: ${theirs.bpm} BPM; ${agreement.ours} vs ${agreement.theirs} beats, ${(agreement.withinTolerance * 100).toFixed(0)}% within 70 ms, median offset ${agreement.medianOffsetMs.toFixed(0)} ms`);
  }
}
