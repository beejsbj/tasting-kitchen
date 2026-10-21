// node harness/lint.mjs <work/index.html> [--format 16x9|9x16|4x5 | --all-formats] [--json out.json] [--step 0.1]
// Quality gate: fails a film on measurable weaknesses (tiny text, text off the safe area, overlapping labels,
// frozen or empty frames, broken shot list, sound off the marks, walls of text). Works on any film that follows
// the window.__anim contract, with no change to the film: text drawing is instrumented from outside.
// Prints a PASS/WARN/FAIL table per format and exits 1 on any FAIL.
import fs from 'node:fs';
import path from 'node:path';
import { openWork, parseArgs, ensureDir } from './lib.mjs';

// ====================================================================================================
// Thresholds. S = min(W,H), so every size scales with the format (1080 for all the standard formats).
// ====================================================================================================
const TEXT_FAIL = 0.026;      // 28 px at 1080: below this a label is unreadable on a phone held at arm's length
const TEXT_WARN = 0.033;      // 36 px at 1080: SKILL's floor for secondary text in 9:16 (phones were the #1 defect)
const SAFE_FAIL = 0.04;       // text closer than 4% of S to an edge gets cut by feed UI and rounded phone corners
const SAFE_WARN = 0.06;       // the SKILL's own safe margin M = 0.06*S
const OVERLAP_FAIL = 0.15;    // two labels sharing >15% of the smaller one's box read as a collision, not a layout
const OVERLAP_MIN_S = 0.2;    // a collision must last this long to FAIL; shorter ones are labels passing each other (WARN)
const VISIBLE_ALPHA = 0.5;    // below half opacity text is fading in/out, not meant to be read yet
const REST_PX = 2;            // a label is "at rest" if it moved/resized less than this (or REST_FRAC of its height)
const REST_FRAC = 0.04;       //   between neighbouring samples; pops and camera flights are exempt from size/margin
const MAP_SCALE = 0.5;        // text shrunk by a zoom-out (transform scale < 0.5) is part of an overview map, not a label:
                              //   it is left out of the text checks and listed as a WARN so nothing passes silently
const STATIC_DIFF = 0.25;     // mean abs luma change (0..255) against the FIRST frame of a still run, like ffmpeg
                              //   freezedetect n=0.001 (~0.25/255) in qa.sh. Root cause of a miss: comparing each sample
                              //   to its neighbour at 0.05 let slow drift (thin spokes turning, a grid creeping) measure
                              //   0.03-0.06 per 0.1 s, so a 4 s freeze broke into sub-second runs; the anchor adds it up
const STATIC_WARN = 2.0;      // seconds: ffmpeg freezedetect in qa.sh uses the same 2 s
const STATIC_FAIL = 3.0;      // seconds: a 3 s freeze reads as a stalled player
const EMPTY_STD = 4.0;        // luma stddev (0..255) of the downscaled frame: below this the frame is one flat colour
const SHOT_MIN = 1.0;         // seconds: a shot shorter than this is a flash, not a shot
const ONSET_WIN = 0.040;      // seconds: a sound more than 40 ms off its visual event reads as out of sync
const ONSET_N = 1024;          // FFT frame (21 ms at 48 kHz) for the onset detector
const ONSET_HOP = 0.005;       // seconds between frames: 5 ms keeps the timing error well inside ONSET_WIN
const ONSET_RATIO = 2;        // an onset peak is at least 2x the mean spectral flux around it (tuned: clean score 13/13,
                              //   same score with plucks 120 ms late 1/13)
const SYNC_FAIL = 0.70;       // fraction of marks that must have an onset
const SYNC_WARN = 0.90;
const PEAK_WARN_DB = -1.0;    // SKILL target: peak under -1 dBFS (AAC adds ~0.5 dB on top)
const WORDS_PORTRAIT = 18;    // words on screen at once before a phone viewer stops reading
const WORDS_LANDSCAPE = 30;
const DIFF_W = 160;           // frames are downscaled to this width for the pixel checks (speed; detail doesn't matter)
const MAX_ITEMS = 6;          // evidence lines printed per check (the JSON has all of them)

// No fade/black allowance at the start or end: the SKILL wants the first frame readable (thumbnail),
// no fade-to-black ending unless approved, and the last frame looping back to the first.

// ====================================================================================================
// In-page instrumentation. Runs before the film's scripts: wraps fillText/strokeText and records, per draw,
// the string, effective pixel size, opacity and the ink box in canvas pixels (transform included).
// ====================================================================================================
function instrument() {
  const L = window.__lint = { draws: [] };
  const P = CanvasRenderingContext2D.prototype;
  const styleAlpha = st => {           // canvas normalises colours to #rrggbb or rgba(r, g, b, a)
    if (typeof st !== 'string') return 1;
    const m = st.match(/rgba?\(([^)]*)\)/); if (!m) return 1;
    const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1;
  };
  for (const name of ['fillText', 'strokeText']) {
    const orig = P[name];
    P[name] = function (str, x, y, maxWidth) {
      try {
        const s = String(str);
        if (s.trim()) {
          const m = this.measureText(s), T = this.getTransform();
          // maxWidth squeezes the text horizontally around its anchor
          const sx = maxWidth !== undefined && maxWidth > 0 && m.width > maxWidth ? maxWidth / m.width : 1;
          const pts = [[x - m.actualBoundingBoxLeft * sx, y - m.actualBoundingBoxAscent], [x + m.actualBoundingBoxRight * sx, y - m.actualBoundingBoxAscent],
                       [x - m.actualBoundingBoxLeft * sx, y + m.actualBoundingBoxDescent], [x + m.actualBoundingBoxRight * sx, y + m.actualBoundingBoxDescent]]
            .map(([px, py]) => [T.a * px + T.c * py + T.e, T.b * px + T.d * py + T.f]);
          const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
          const fm = this.font.match(/(\d+(?:\.\d+)?)px/);
          L.draws.push({
            s, cv: this.canvas,
            px: fm ? parseFloat(fm[1]) * Math.hypot(T.c, T.d) : null,   // font size times the vertical scale of the transform
            k: Math.hypot(T.c, T.d),
            a: this.globalAlpha * styleAlpha(name === 'fillText' ? this.fillStyle : this.strokeStyle),
            box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
          });
        }
      } catch (e) { /* instrumentation must never break the film */ }
      return orig.apply(this, arguments);
    };
  }
}

// One sample: seek, collect the text draws on the film's canvas, and luma stats of a downscaled copy.
async function sampleAt(page, t) {
  return page.evaluate((t, DW, SD) => {
    const L = window.__lint, cv = __anim.canvas;
    L.draws.length = 0;
    __anim.seek(t);
    const texts = L.draws.filter(d => d.cv === cv).map(({ cv: _, ...d }) => d);   // offscreen canvases are not on screen
    if (!L.sm) {
      L.sm = document.createElement('canvas'); L.sm.width = DW; L.sm.height = Math.max(1, Math.round(DW * cv.height / cv.width));
      L.sx = L.sm.getContext('2d', { willReadFrequently: true });
    }
    L.sx.drawImage(cv, 0, 0, L.sm.width, L.sm.height);
    const px = L.sx.getImageData(0, 0, L.sm.width, L.sm.height).data, n = px.length / 4, lum = new Float32Array(n);
    let sum = 0; for (let i = 0; i < n; i++) { lum[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2]; sum += lum[i]; }
    const mean = sum / n; let v = 0, diff = null;
    for (let i = 0; i < n; i++) v += (lum[i] - mean) ** 2;
    if (L.anchor) { diff = 0; for (let i = 0; i < n; i++) diff += Math.abs(lum[i] - L.anchor[i]); diff /= n; }
    if (diff === null || diff >= SD) L.anchor = lum;     // the anchor only moves once the picture really changed
    return { texts, std: Math.sqrt(v / n), diff };
  }, t, DIFF_W, STATIC_DIFF);
}

// ====================================================================================================
// Geometry helpers (boxes are [x0, y0, x1, y1] in canvas px)
// ====================================================================================================
const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inter = (p, q) => area([Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.min(p[2], q[2]), Math.min(p[3], q[3])]);
const onScreen = (b, W, H) => b[2] > 0 && b[3] > 0 && b[0] < W && b[1] < H;
const fmtT = t => t.toFixed(2) + 's';
const shotAt = (shots, t) => (shots.find(s => t >= s.start && t < s.end) || {}).id || '-';

// At rest = the same string sits in (almost) the same box in a neighbouring sample. Text that is popping in,
// sliding in a push transition or riding a camera flight is judged once it lands, not mid-motion.
function atRest(d, neighbours) {
  const tol = Math.max(REST_PX, REST_FRAC * (d.box[3] - d.box[1]));
  return neighbours.some(n => n && n.some(o => o.s === d.s && o.box.every((v, i) => Math.abs(v - d.box[i]) <= tol)));
}

// ====================================================================================================
// Checks. Each returns { id, status, summary, items[] }.
// ====================================================================================================
const worst = (a, b) => (['FAIL', 'WARN', 'PASS'].indexOf(a) < ['FAIL', 'WARN', 'PASS'].indexOf(b) ? a : b);

function checkTextSize(samples, W, H, shots) {
  const S = Math.min(W, H), byStr = new Map();
  samples.forEach((sm, i) => sm.vis.forEach(d => {
    if (d.px == null || !atRest(d, [samples[i - 1]?.vis, samples[i + 1]?.vis])) return;
    const r = byStr.get(d.s); if (!r || d.px < r.px) byStr.set(d.s, { px: d.px, t: sm.t });
  }));
  let status = 'PASS'; const items = [];
  for (const [s, r] of [...byStr].sort((p, q) => p[1].px - q[1].px)) {
    const st = r.px < TEXT_FAIL * S ? 'FAIL' : r.px < TEXT_WARN * S ? 'WARN' : null; if (!st) continue;
    status = worst(status, st); items.push(`${st} ${r.px.toFixed(1)}px "${s.slice(0, 40)}" at ${fmtT(r.t)} (${shotAt(shots, r.t)})`);
  }
  const mapped = new Map(); samples.forEach(sm => sm.map.forEach(d => { if (d.px != null && d.px < TEXT_FAIL * S && !mapped.has(d.s)) mapped.set(d.s, sm.t); }));
  if (mapped.size) {
    status = worst(status, 'WARN'); const t = Math.min(...mapped.values());
    items.push(`WARN ${mapped.size} strings shrunk below the floor by a zoom-out (scale < ${MAP_SCALE}), treated as an overview map, first at ${fmtT(t)} (${shotAt(shots, t)}): check that frame reads as a picture`);
  }
  const min = Math.min(...[...byStr.values()].map(r => r.px));
  return { id: 'text-size', status, items,
    summary: `smallest resting text ${isFinite(min) ? min.toFixed(1) : '-'}px; floor ${(TEXT_FAIL * S).toFixed(0)}px FAIL / ${(TEXT_WARN * S).toFixed(0)}px WARN` };
}

function checkSafeArea(samples, W, H, shots) {
  const S = Math.min(W, H), byStr = new Map();
  samples.forEach((sm, i) => sm.vis.forEach(d => {
    if (!atRest(d, [samples[i - 1]?.vis, samples[i + 1]?.vis])) return;
    const m = Math.min(d.box[0], d.box[1], W - d.box[2], H - d.box[3]);
    const r = byStr.get(d.s); if (!r || m < r.m) byStr.set(d.s, { m, t: sm.t });
  }));
  let status = 'PASS'; const items = [];
  for (const [s, r] of [...byStr].sort((p, q) => p[1].m - q[1].m)) {
    const st = r.m < SAFE_FAIL * S ? 'FAIL' : r.m < SAFE_WARN * S ? 'WARN' : null; if (!st) continue;
    status = worst(status, st); items.push(`${st} "${s.slice(0, 40)}" ${r.m.toFixed(0)}px from edge at ${fmtT(r.t)} (${shotAt(shots, r.t)})`);
  }
  return { id: 'safe-area', status, items, summary: `margin ${(SAFE_FAIL * S).toFixed(0)}px FAIL / ${(SAFE_WARN * S).toFixed(0)}px WARN` };
}

function checkOverlap(samples, shots, step) {
  const pairs = new Map();
  samples.forEach((sm, si) => {
    const v = sm.vis;
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
      const p = v[i], q = v[j], small = Math.min(area(p.box), area(q.box)); if (!small) continue;
      if (p.s === q.s) {    // same string twice at the same spot = shadow/outline technique, not a collision
        const hh = Math.min(p.box[3] - p.box[1], q.box[3] - q.box[1]);
        if (Math.hypot((p.box[0] + p.box[2] - q.box[0] - q.box[2]) / 2, (p.box[1] + p.box[3] - q.box[1] - q.box[3]) / 2) < 0.25 * hh) continue;
      }
      const f = inter(p.box, q.box) / small; if (f <= OVERLAP_FAIL) continue;
      // keyed by string prefixes so a line that is still typing stays one pair
      const key = [p.s.slice(0, 24), q.s.slice(0, 24)].sort().join(' | '), r = pairs.get(key);
      if (!r) { pairs.set(key, { a: p.s, b: q.s, f, last: si, run: 1, best: 1, bestT: sm.t }); continue; }
      if (r.last === si) continue;                                  // same pair twice in one frame
      r.run = r.last === si - 1 ? r.run + 1 : 1; r.last = si; r.f = Math.max(r.f, f);
      if (r.run > r.best) { r.best = r.run; r.bestT = +(sm.t - (r.run - 1) * step).toFixed(2); }
    }
  });
  let status = 'PASS'; const items = [];
  for (const r of [...pairs.values()].sort((x, y) => x.bestT - y.bestT)) {
    const dur = r.best * step, st = dur >= OVERLAP_MIN_S - 1e-9 ? 'FAIL' : 'WARN'; status = worst(status, st);
    items.push(`${st} "${r.a.slice(0, 30)}" x "${r.b.slice(0, 30)}" at ${fmtT(r.bestT)} (${shotAt(shots, r.bestT)}) for ~${dur.toFixed(1)}s, up to ${(r.f * 100).toFixed(0)}% of the smaller`);
  }
  items.sort((x, y) => (x[0] === 'F' ? 0 : 1) - (y[0] === 'F' ? 0 : 1));   // collisions first, brief pass-bys after
  const nf = items.filter(i => i[0] === 'F').length;
  return { id: 'text-overlap', status, items, summary: `${nf} collisions lasting >= ${OVERLAP_MIN_S}s, ${items.length - nf} brief pass-bys (>${OVERLAP_FAIL * 100}% of the smaller box)` };
}

function checkStatic(samples, shots) {
  const runs = []; let start = null;
  for (let i = 1; i < samples.length; i++) {
    const still = samples[i].diff < STATIC_DIFF;
    if (still && start === null) start = samples[i - 1].t;
    if ((!still || i === samples.length - 1) && start !== null) { runs.push([start, still ? samples[i].t : samples[i - 1].t]); start = null; }
  }
  let status = 'PASS'; const items = [];
  let longest = 0;
  for (const [a, b] of runs) {
    const d = b - a; longest = Math.max(longest, d);
    const st = d > STATIC_FAIL ? 'FAIL' : d > STATIC_WARN ? 'WARN' : null; if (!st) continue;
    status = worst(status, st); items.push(`${st} static ${fmtT(a)}-${fmtT(b)} (${d.toFixed(1)}s, ${shotAt(shots, a)})`);
  }
  return { id: 'static-stretch', status, items, summary: `longest still stretch ${longest.toFixed(1)}s (mean luma change vs the run's first frame < ${STATIC_DIFF}/255)` };
}

function checkEmpty(samples, shots) {
  const bad = samples.filter(s => s.std < EMPTY_STD), items = [];
  let i = 0;                       // merge consecutive empty samples into ranges
  while (i < bad.length) {
    let j = i; while (j + 1 < bad.length && samples.indexOf(bad[j + 1]) === samples.indexOf(bad[j]) + 1) j++;
    items.push(`FAIL near-uniform frame ${fmtT(bad[i].t)}${j > i ? '-' + fmtT(bad[j].t) : ''} (luma std ${bad[i].std.toFixed(1)}, ${shotAt(shots, bad[i].t)})`);
    i = j + 1;
  }
  const min = Math.min(...samples.map(s => s.std));
  return { id: 'empty-frame', status: bad.length ? 'FAIL' : 'PASS', items, summary: `lowest luma std ${min.toFixed(1)} (floor ${EMPTY_STD})` };
}

function checkShots(shots, D, fps) {
  const fr = 1 / fps, items = [];
  if (!shots.length) items.push('FAIL __anim.shots is empty');
  const s = [...shots].sort((a, b) => a.start - b.start);
  if (s.length && s[0].start > fr) items.push(`FAIL nothing covers 0-${fmtT(s[0].start)}`);
  if (s.length && s.at(-1).end < D - fr) items.push(`FAIL nothing covers ${fmtT(s.at(-1).end)}-${fmtT(D)}`);
  for (let i = 1; i < s.length; i++) {
    const g = s[i].start - s[i - 1].end;
    if (g > fr) items.push(`FAIL gap ${fmtT(s[i - 1].end)}-${fmtT(s[i].start)} between ${s[i - 1].id} and ${s[i].id}`);
    if (g < -1e-3) items.push(`FAIL ${s[i - 1].id} and ${s[i].id} overlap by ${(-g).toFixed(3)}s`);
  }
  for (const x of s) if (x.end - x.start < SHOT_MIN) items.push(`FAIL ${x.id} lasts ${(x.end - x.start).toFixed(2)}s (< ${SHOT_MIN}s)`);
  return { id: 'shots-coverage', status: items.length ? 'FAIL' : 'PASS', items, summary: `${shots.length} shots over ${D}s` };
}

// Minimal PCM16 WAV reader (the contract says renderAudio returns 16-bit PCM). Returns mono samples + peak.
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let p = 12, ch = 0, sr = 0, bits = 0, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = buf.readUInt16LE(p + 10); sr = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22); }
    if (id === 'data') { data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + len)); break; }
    p += 8 + len + (len & 1);
  }
  if (!data || bits !== 16 || !ch) throw new Error(`unsupported WAV (bits ${bits}, channels ${ch})`);
  const n = Math.floor(data.length / (2 * ch)), mono = new Float32Array(n); let peak = 0;
  for (let i = 0; i < n; i++) {
    let m = 0; for (let c = 0; c < ch; c++) { const v = data.readInt16LE(2 * (i * ch + c)) / 32768; m += v; peak = Math.max(peak, Math.abs(v)); }
    mono[i] = m / ch;
  }
  return { mono, sr, peak };
}

// In-place radix-2 FFT (n a power of two), for the onset detector below.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {                   // bit-reversal permutation
    let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len / 2;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k, b = a + h, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Onsets by log spectral flux (1024-sample Hann frames, 5 ms hop). Broadband energy flux was tried first and
// missed a third of the plucks in a long film where they sit quietly under a music bed; a new note still shows
// as rising energy in its own frequency bins. A peak counts if it is the largest within +-15 ms and at least
// ONSET_RATIO times the mean flux around it.
function onsets(mono, sr) {
  const N = ONSET_N, hop = Math.round(sr * ONSET_HOP), nf = Math.max(0, Math.floor((mono.length - N) / hop));
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const re = new Float64Array(N), im = new Float64Array(N), prev = new Float64Array(N / 2), flux = new Float64Array(nf);
  for (let i = 0; i < nf; i++) {
    for (let k = 0; k < N; k++) { re[k] = mono[i * hop + k] * win[k]; im[k] = 0; }
    fft(re, im);
    let sum = 0;
    for (let k = 1; k < N / 2; k++) { const l = Math.log1p(100 * Math.hypot(re[k], im[k])), d = l - prev[k]; if (d > 0) sum += d; prev[k] = l; }
    flux[i] = sum;
  }
  const out = [];
  for (let i = 1; i < nf; i++) {
    let isPeak = true; for (let k = Math.max(0, i - 3); k <= Math.min(nf - 1, i + 3); k++) if (flux[k] > flux[i]) { isPeak = false; break; }
    if (!isPeak) continue;
    let m = 0, c = 0; for (let k = Math.max(0, i - 20); k < Math.min(nf, i + 10); k++) { m += flux[k]; c++; }
    if (flux[i] >= ONSET_RATIO * m / c) out.push((i * hop + N / 2) / sr);    // time at the frame centre
  }
  return out;
}

function checkAudio(wavB64, marks, shots) {
  if (!wavB64) return { id: 'audio-sync', status: 'WARN', items: [], summary: 'no renderAudio: sync not checked' };
  const { mono, sr, peak } = readWav(Buffer.from(wavB64, 'base64'));
  const on = onsets(mono, sr), items = []; let hit = 0;
  for (const m of marks) {
    const near = on.reduce((b, o) => Math.abs(o - m) < Math.abs(b - m) ? o : b, Infinity);
    if (Math.abs(near - m) <= ONSET_WIN) hit++;
    else items.push(`miss mark ${fmtT(m)} (${shotAt(shots, m)}): nearest onset ${isFinite(near) ? ((near - m) * 1000).toFixed(0) + ' ms away' : 'none'}`);
  }
  const frac = marks.length ? hit / marks.length : 1, peakDb = 20 * Math.log10(peak + 1e-12);
  let status = !marks.length ? 'WARN' : frac < SYNC_FAIL ? 'FAIL' : frac < SYNC_WARN ? 'WARN' : 'PASS';
  if (peakDb > PEAK_WARN_DB) { status = worst(status, 'WARN'); items.unshift(`WARN sample peak ${peakDb.toFixed(2)} dBFS (> ${PEAK_WARN_DB})`); }
  if (!marks.length) items.unshift('WARN __anim.marks is empty');
  return { id: 'audio-sync', status, items: status === 'PASS' ? [] : items,
    summary: `${hit}/${marks.length} marks have an onset within ±${ONSET_WIN * 1000} ms (${on.length} onsets); peak ${peakDb.toFixed(2)} dBFS` };
}

function checkDensity(samples, W, H, shots) {
  const limit = H > W ? WORDS_PORTRAIT : WORDS_LANDSCAPE; let top = { n: 0, t: 0 };
  for (const sm of samples) {
    const seen = new Set(); let n = 0;
    for (const d of sm.vis) {
      const k = d.s + '@' + Math.round(d.box[0] / 8) + ',' + Math.round(d.box[1] / 8); if (seen.has(k)) continue; seen.add(k);  // outline + fill once
      n += d.s.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
    }
    if (n > top.n) top = { n, t: sm.t };
  }
  const over = top.n > limit;
  return { id: 'density', status: over ? 'WARN' : 'PASS', items: over ? [`WARN ${top.n} words on screen at ${fmtT(top.t)} (${shotAt(shots, top.t)})`] : [],
    summary: `max ${top.n} words on screen at once (limit ${limit})` };
}

// ====================================================================================================
// Run one format
// ====================================================================================================
async function lintFormat(html, format, step, audioCache) {
  const t0 = Date.now();
  const { browser, page, meta, w: W, h: H } = await openWork(html, format, instrument);
  try {
    const fps = await page.evaluate(() => __anim.fps || 30), D = meta.duration;
    const times = []; for (let i = 0; i * step < D - 1e-9; i++) times.push(+(i * step).toFixed(4));
    if (D - 1 / fps > times.at(-1) + 1e-6) times.push(+(D - 1 / fps).toFixed(4));   // always judge the last frame (loop point)
    const samples = [];
    for (const t of times) {
      const r = await sampleAt(page, t);
      r.t = t;
      // sub-pixel ink is invisible (e.g. a pop scaled by eOutBack(0) = 2e-16 before it starts)
      const seen = r.texts.filter(d => d.a >= VISIBLE_ALPHA && area(d.box) >= 1 && onScreen(d.box, W, H));
      r.vis = seen.filter(d => d.k >= MAP_SCALE); r.map = seen.filter(d => d.k < MAP_SCALE); samples.push(r);
    }
    if (audioCache.b64 === undefined) audioCache.b64 = await page.evaluate(async () => __anim.renderAudio ? await __anim.renderAudio() : null);
    const shots = meta.shots;
    const checks = [
      checkTextSize(samples, W, H, shots), checkSafeArea(samples, W, H, shots), checkOverlap(samples, shots, step),
      checkStatic(samples, shots), checkEmpty(samples, shots), checkShots(shots, D, fps),
      checkAudio(audioCache.b64, meta.marks, shots), checkDensity(samples, W, H, shots),
    ];
    return { format, duration: D, samples: samples.length, step, secs: +((Date.now() - t0) / 1000).toFixed(1), checks };
  } finally { await browser.close(); }
}

function printReport(html, r) {
  console.log(`\nlint ${r.format}  ${html}  (${r.duration}s, ${r.samples} samples every ${r.step}s, ${r.secs}s)`);
  console.log('| check | status | evidence |\n|---|---|---|');
  for (const c of r.checks) console.log(`| ${c.id} | ${c.status} | ${c.summary} |`);
  for (const c of r.checks) {
    if (!c.items.length) continue;
    console.log(`  ${c.id}:`);
    for (const it of c.items.slice(0, MAX_ITEMS)) console.log('    ' + it);
    if (c.items.length > MAX_ITEMS) console.log(`    ... ${c.items.length - MAX_ITEMS} more (see --json)`);
  }
  const n = s => r.checks.filter(c => c.status === s).length;
  console.log(`${r.format}: ${n('PASS')} PASS, ${n('WARN')} WARN, ${n('FAIL')} FAIL`);
}

// ====================================================================================================
// Main
// ====================================================================================================
const a = parseArgs(process.argv.slice(2));
if (!a._[0]) { console.log('usage: node harness/lint.mjs <work/index.html> [--format 16x9|9x16|4x5 | --all-formats] [--json out.json] [--step 0.1]'); process.exit(2); }
const formats = a['all-formats'] ? ['16x9', '9x16'] : [a.format || '16x9'];   // 16:9 and 9:16 are the formats every work ships
const step = Number(a.step || 0.1), audioCache = {}, results = [];
for (const f of formats) { const r = await lintFormat(a._[0], f, step, audioCache); printReport(a._[0], r); results.push(r); }
if (a.json) { ensureDir(path.dirname(path.resolve(a.json))); fs.writeFileSync(a.json, JSON.stringify({ file: a._[0], results }, null, 2)); }
const fails = results.reduce((n, r) => n + r.checks.filter(c => c.status === 'FAIL').length, 0);
console.log(fails ? `\nlint: ${fails} FAIL` : '\nlint: OK (0 FAIL)');
process.exit(fails ? 1 : 0);
