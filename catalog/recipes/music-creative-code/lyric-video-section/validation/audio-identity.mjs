// Audio identity: the film's soundtrack must be the supplied excerpt, aligned
// with the picture, neither stretched, re-mixed, replaced nor padded. Compared
// as decoded PCM against inputs/excerpt.wav after AAC; a uniform level trim is
// reported, not failed, because the excerpt itself peaks above the film
// check's -0.1 dBTP ceiling. Uniform means every audible half-second carries
// the same gain: a fade, a level ride or a limiter is not a trim.
// Run from the delivery root: node validation/audio-identity.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RATE = 48000;
export const THRESHOLDS = Object.freeze({
  maxLagMs: 20, // audio may not lead or trail the picture by more than this
  minWindowCorrelation: 0.95, // every audible half-second must match after alignment (96 kbps AAC reaches 0.96)
  minMeanCorrelation: 0.98,
  minGainDb: -6, // a uniform trim is allowed; a remaster or re-mix is not
  maxGainDb: 0.5,
  maxGainDeviationDb: 1, // each half-second's gain against the overall trim (128 kbps AAC stays within 0.1 dB)
  steadyRms: 0.01, // -40 dBFS: windows loud enough for a per-window gain to mean anything
  maxDurationDeltaS: 0.05,
  silentRms: 0.001, // -60 dBFS: windows the excerpt leaves silent
  maxAddedRms: 0.003, // sound added where the excerpt is silent
});
const WINDOW_S = 0.5;
const SEARCH_S = 0.25;

/** Decode any file's first audio stream to interleaved 48 kHz stereo float PCM. */
export function decodePcm(file) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "2", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`Cannot decode audio in ${file}: ${result.stderr?.toString().trim() || result.error?.message}`);
  const bytes = result.stdout;
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
}

function mono(pcm) {
  const out = new Float32Array(pcm.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (pcm[2 * i] + pcm[2 * i + 1]) / 2;
  return out;
}

function decimate(signal, factor) {
  const out = new Float32Array(Math.floor(signal.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += signal[i * factor + k];
    out[i] = sum / factor;
  }
  return out;
}

/** Normalized correlation of a[from, to) with b shifted by lag (b[i + lag]). */
function correlation(a, b, lag, from, to) {
  let ab = 0, aa = 0, bb = 0;
  const start = Math.max(from, -lag), end = Math.min(to, b.length - lag, a.length);
  for (let i = start; i < end; i++) {
    const x = a[i], y = b[i + lag];
    ab += x * y; aa += x * x; bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

function bestLag(a, b, radius, from, to, step = 1, around = 0) {
  let best = { lag: around, fit: -Infinity };
  for (let lag = around - radius; lag <= around + radius; lag += step) {
    const fit = correlation(a, b, lag, from, to);
    if (fit > best.fit) best = { lag, fit };
  }
  return best;
}

function loudestSpan(signal, length) {
  let best = 0, bestEnergy = -1;
  for (let start = 0; start + length <= signal.length; start += length >> 2) {
    let energy = 0;
    for (let i = start; i < start + length; i++) energy += signal[i] * signal[i];
    if (energy > bestEnergy) { bestEnergy = energy; best = start; }
  }
  return [best, Math.min(signal.length, best + length)];
}

/**
 * Compare a candidate soundtrack with the source. Both are interleaved stereo
 * float PCM at RATE. Returns measurements; assessIdentity applies thresholds.
 */
export function compareAudio(source, candidate) {
  const s = mono(source), c = mono(candidate);
  // Coarse lag on a decimated loud span, then refine at the full rate.
  const factor = 6;
  const sd = decimate(s, factor), cd = decimate(c, factor);
  const [from, to] = loudestSpan(sd, Math.min(sd.length, Math.round(6 * RATE / factor)));
  const coarse = bestLag(sd, cd, Math.round(SEARCH_S * RATE / factor), from, to);
  const fine = bestLag(s, c, factor * 2, from * factor, to * factor, 1, coarse.lag * factor);
  const lag = fine.lag;

  // Least-squares gain of candidate against source at that lag.
  let sc = 0, ss = 0;
  for (let i = Math.max(0, -lag); i < Math.min(s.length, c.length - lag); i++) { sc += s[i] * c[i + lag]; ss += s[i] * s[i]; }
  const gain = ss > 0 ? sc / ss : 0;

  const windowLength = Math.round(WINDOW_S * RATE);
  const windows = [];
  for (let start = 0; start + windowLength <= s.length; start += windowLength) {
    let se = 0, ce = 0, sce = 0;
    for (let i = start; i < start + windowLength; i++) {
      se += s[i] * s[i];
      const j = i + lag;
      const y = j >= 0 && j < c.length ? c[j] : 0;
      ce += y * y;
      sce += s[i] * y;
    }
    const sourceRms = Math.sqrt(se / windowLength), candidateRms = Math.sqrt(ce / windowLength);
    const silent = sourceRms < THRESHOLDS.silentRms;
    windows.push({
      t: start / RATE,
      silent,
      sourceRms,
      candidateRms,
      correlation: silent ? null : Math.min(correlation(source, candidate, 2 * lag, 2 * start, 2 * (start + windowLength)), 1),
      // This half-second's least-squares gain relative to the whole soundtrack's.
      gainDeviationDb: sourceRms >= THRESHOLDS.steadyRms && sce > 0 && gain > 0 ? 20 * Math.log10(sce / se / gain) : null,
    });
  }
  const audible = windows.filter((window) => !window.silent);
  const correlations = audible.map((window) => window.correlation);
  const steady = windows.filter((window) => window.gainDeviationDb !== null);
  const unsteady = steady.reduce((worst, window) => (worst === null || Math.abs(window.gainDeviationDb) > Math.abs(worst.gainDeviationDb) ? window : worst), null);
  return {
    lagSamples: lag,
    lagMs: (lag / RATE) * 1000,
    gainDb: gain > 0 ? 20 * Math.log10(gain) : -Infinity,
    sourceSeconds: s.length / RATE,
    candidateSeconds: c.length / RATE,
    durationDeltaS: (c.length - s.length) / RATE,
    meanCorrelation: correlations.length ? correlations.reduce((sum, value) => sum + value, 0) / correlations.length : 0,
    minWindowCorrelation: correlations.length ? Math.min(...correlations) : 0,
    worstWindow: audible.reduce((worst, window) => (worst === null || window.correlation < worst.correlation ? window : worst), null)?.t ?? null,
    maxGainDeviationDb: unsteady ? Math.abs(unsteady.gainDeviationDb) : 0,
    worstGainWindow: unsteady?.t ?? null,
    steadyWindows: steady.length,
    maxAddedRms: Math.max(0, ...windows.filter((window) => window.silent).map((window) => window.candidateRms)),
    audibleWindows: audible.length,
  };
}

export function assessIdentity(metrics, thresholds = THRESHOLDS) {
  const reasons = [];
  if (Math.abs(metrics.durationDeltaS) > thresholds.maxDurationDeltaS) reasons.push(`soundtrack is ${metrics.candidateSeconds.toFixed(3)} s; the excerpt is ${metrics.sourceSeconds.toFixed(3)} s`);
  if (Math.abs(metrics.lagMs) > thresholds.maxLagMs) reasons.push(`soundtrack is offset ${metrics.lagMs.toFixed(1)} ms from the excerpt`);
  if (!(metrics.gainDb >= thresholds.minGainDb && metrics.gainDb <= thresholds.maxGainDb)) reasons.push(`level changed by ${metrics.gainDb.toFixed(2)} dB; only a uniform trim between ${thresholds.minGainDb} and +${thresholds.maxGainDb} dB is allowed`);
  if (metrics.maxGainDeviationDb > thresholds.maxGainDeviationDb) reasons.push(`the level of the half-second at ${metrics.worstGainWindow?.toFixed(1)} s differs from the overall trim by ${metrics.maxGainDeviationDb.toFixed(2)} dB; a trim must be uniform, not a fade, level ride or limiter`);
  if (metrics.minWindowCorrelation < thresholds.minWindowCorrelation) reasons.push(`the half-second at ${metrics.worstWindow?.toFixed(1)} s does not match the excerpt (correlation ${metrics.minWindowCorrelation.toFixed(4)})`);
  if (metrics.meanCorrelation < thresholds.minMeanCorrelation) reasons.push(`mean correlation ${metrics.meanCorrelation.toFixed(4)} is below ${thresholds.minMeanCorrelation}`);
  if (metrics.maxAddedRms > thresholds.maxAddedRms) reasons.push(`sound was added where the excerpt is silent (RMS ${metrics.maxAddedRms.toFixed(4)})`);
  return { passed: reasons.length === 0, reasons };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const contract = JSON.parse(readFileSync("fixtures/contract.json", "utf8"));
  const metrics = compareAudio(decodePcm(contract.excerptFixture ?? "inputs/excerpt.wav"), decodePcm("film.mp4"));
  const verdict = assessIdentity(metrics);
  const summary = `lag ${metrics.lagMs.toFixed(2)} ms, level ${metrics.gainDb.toFixed(2)} dB (uniform within ${metrics.maxGainDeviationDb.toFixed(2)} dB), correlation mean ${metrics.meanCorrelation.toFixed(4)} / min ${metrics.minWindowCorrelation.toFixed(4)} over ${metrics.audibleWindows} audible half-seconds`;
  if (!verdict.passed) {
    console.error(`FAIL: audio identity: ${verdict.reasons.join("; ")} (${summary})`);
    process.exit(1);
  }
  console.log(`PASS: the soundtrack is the supplied excerpt: ${summary}.`);
}
