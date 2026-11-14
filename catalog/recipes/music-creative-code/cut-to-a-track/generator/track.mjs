// Kitchen's 30-second track for cut-to-a-track, and its cue sheet. Seeded and
// written as plain PCM so the same script makes the same file: a groove at
// 100 BPM, one metallic hit that falls between beats, a hard stop into four and
// a half seconds of digital silence, a slow rise, then the groove's return and a
// hard stop. Quiet passages stay at least -45 dBFS or are digital zero, so the
// identity check can follow every half-second through AAC. The cue sheet is
// the composition's own timing (not detection), so the Recipe tastes the cut,
// not beat tracking.
//   node generator/track.mjs [fixtures-directory]   (default: fixtures)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const RATE = 48000;
export const SECONDS = 30;
export const FPS = 24;
export const BPM = 100;
export const SEED = 20261114;
const BEAT = 60 / BPM;
const PEAK_DBFS = -2; // AAC raises peaks by a dB or two; the film check allows up to -0.1 dBTP

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function render() {
  const n = RATE * SECONDS;
  const left = new Float64Array(n), right = new Float64Array(n);
  const random = mulberry32(SEED);
  const noise = () => random() * 2 - 1;
  const onsets = [];
  const at = (t) => Math.round(t * RATE);
  // pan -1 (left) to 1 (right); the centre is full level in both channels.
  const add = (t0, seconds, fn, pan = 0) => {
    const from = at(t0), to = Math.min(n, from + Math.round(seconds * RATE));
    const l = Math.min(1, 1 - pan), r = Math.min(1, 1 + pan);
    for (let i = Math.max(0, from); i < to; i++) { const value = fn((i - from) / RATE); left[i] += l * value; right[i] += r * value; }
  };
  const scale = (from, to, fn) => { for (let i = from; i < to; i++) { const g = fn(i); left[i] *= g; right[i] *= g; } };
  const cue = (t, sound, strength) => onsets.push({ t: Math.round(t * 1000) / 1000, sound, strength });

  const kick = (t0, amp) => {
    let phase = 0;
    add(t0, 0.4, (t) => { phase += (2 * Math.PI * (45 + 75 * Math.exp(-t * 30))) / RATE; return amp * Math.exp(-t * 9) * Math.sin(phase) + (t < 0.004 ? amp * 0.3 * noise() : 0); });
    cue(t0, "kick", amp);
  };
  const hat = (t0, amp) => {
    let last = 0;
    add(t0, 0.06, (t) => { const x = noise(); const y = x - last; last = x; return amp * 0.5 * y * Math.exp(-t * 70); }, 0.35);
    cue(t0, "hat", amp);
  };
  const bass = (t0, seconds, frequency, amp) => {
    add(t0, seconds, (t) => { const env = Math.min(1, t / 0.006) * Math.exp(-t * 2.2) * Math.min(1, (seconds - t) / 0.03); const w = 2 * Math.PI * frequency * t; return amp * env * (Math.sin(w) + 0.3 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w)); });
    cue(t0, "bass", amp);
  };
  const pluck = (t0, frequency, amp) => {
    add(t0, 0.9, (t) => { const w = 2 * Math.PI * frequency * t; return amp * Math.min(1, t / 0.002) * (Math.sin(w) * Math.exp(-t * 5) + 0.4 * Math.sin(2 * w) * Math.exp(-t * 9) + 0.2 * Math.sin(3 * w) * Math.exp(-t * 14)); }, -0.3);
    cue(t0, "pluck", amp);
  };
  const clang = (t0, amp) => {
    const partials = [[1, 1, 2.2], [2.76, 0.7, 3.1], [5.4, 0.45, 4.5], [8.93, 0.3, 6.5], [13.34, 0.2, 9]];
    add(t0, 1.8, (t) => amp * Math.min(1, t / 0.001) * partials.reduce((sum, [ratio, level, decay]) => sum + level * Math.sin(2 * Math.PI * 340 * ratio * t) * Math.exp(-t * decay), 0) / 2.2, 0.45);
    cue(t0, "clang", amp);
  };
  const boom = (t0, amp) => {
    let low = 0;
    // Mostly a low boom: broadband noise is what AAC keeps least faithfully.
    let phase = 0;
    add(t0, 1.6, (t) => { low += 0.2 * (noise() - low); phase += (2 * Math.PI * (40 + 60 * Math.exp(-t * 8))) / RATE; return amp * (0.35 * low * Math.exp(-t * 4) + Math.sin(phase) * Math.exp(-t * 2.2)); });
    cue(t0, "boom", amp);
  };

  // A: the groove, 0.0-10.8 s. Bass on beats 1 and 3, a pickup on the last eighth, a pluck figure in bars 2 and 4.
  const groove = (from, beats, accent) => {
    const roots = [55, 55, 65.41, 49];
    for (let b = 0; b < beats; b++) {
      const t = from + b * BEAT, bar = Math.floor(b / 4), inBar = b % 4;
      kick(t, b === 0 ? accent : 0.8);
      hat(t + BEAT / 2, inBar === 3 ? 0.45 : 0.3);
      if (inBar === 0 || inBar === 2) bass(t, BEAT * 1.6, roots[bar % 4], 0.5);
      if (inBar === 3) bass(t + BEAT / 2, BEAT / 2, roots[(bar + 1) % 4] * 1.5, 0.35);
      if (bar % 2 === 1 && inBar === 1) [440, 523.25, 587.33, 523.25].forEach((f, i) => pluck(t + i * BEAT / 2, f, 0.22));
    }
  };
  groove(0, 18, 0.9);
  // The one hit that falls between beats.
  clang(6.97, 0.75);

  // B: silence, 10.5-15.0 s. The groove stops dead at 10.5 s: a 20 ms gate, then zero.
  const gateFrom = at(10.48), gateTo = at(10.5);
  scale(gateFrom, at(15), (i) => (i < gateTo ? 0.5 + 0.5 * Math.cos((Math.PI * (i - gateFrom)) / (gateTo - gateFrom)) : 0));

  // C: the slow rise, 15.0-25.2 s: a gliding drone (root, fifth and octave, so nothing beats), a
  // darker noise swell opening up, thumps from 19.8 s.
  const riseFrom = 15, riseTo = 25.2, riseLength = riseTo - riseFrom;
  cue(riseFrom, "drone", 0.05);
  let phases = [0, 0, 0], low = 0;
  add(riseFrom, riseLength, (t) => {
    const x = t / riseLength, level = 10 ** ((-30 + 24 * x ** 1.3) / 20), frequency = 55 * 2 ** x;
    let drone = 0;
    phases = phases.map((phase, voice) => {
      const next = phase + (2 * Math.PI * frequency * [1, 1.5, 2][voice]) / RATE;
      for (let h = 1; h <= 6; h++) drone += Math.sin(h * next) / h / (voice + 2);
      return next;
    });
    low += (0.005 + 0.12 * x ** 2) * (noise() - low);
    return level * (0.8 * drone + 0.5 * low * x);
  });
  for (let b = 0; 19.8 + b * BEAT < riseTo - 0.01; b++) kick(19.8 + b * BEAT, 0.2 + 0.6 * (b / 8));

  // D: the return, 25.2-29.5 s, stopped dead at 29.5 s; the last half-second is zero.
  boom(riseTo, 0.5);
  groove(riseTo, 6, 1);
  kick(28.8, 1);
  bass(28.8, 1.0, 55, 0.6);
  const tailFrom = at(29.48), tailTo = at(29.5);
  scale(tailFrom, n, (i) => (i < tailTo ? 0.5 + 0.5 * Math.cos((Math.PI * (i - tailFrom)) / (tailTo - tailFrom)) : 0));

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = 10 ** (PEAK_DBFS / 20) / peak;
  // Interleaved stereo, so no player or encoder has to choose how to upmix it.
  const pcm = new Int16Array(2 * n);
  const sample = (value) => Math.round(Math.max(-1, Math.min(1, value * gain)) * 32767);
  for (let i = 0; i < n; i++) { pcm[2 * i] = sample(left[i]); pcm[2 * i + 1] = sample(right[i]); }
  return { pcm, cues: cueSheet(pcm, onsets) };
}

function cueSheet(pcm, onsets) {
  const frame = RATE / FPS, envelope = [];
  for (let f = 0; f < SECONDS * FPS; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += ((pcm[2 * i] + pcm[2 * i + 1]) / 65536) ** 2;
    const rms = Math.sqrt(sum / frame);
    envelope.push(rms > 1e-5 ? Math.round(200 * Math.log10(rms)) / 10 : null);
  }
  const strongest = Math.max(...onsets.map((onset) => onset.strength));
  return {
    duration: SECONDS,
    sampleRate: RATE,
    bpm: BPM,
    grid: Array.from({ length: Math.round(SECONDS / BEAT) }, (_, i) => Math.round(i * BEAT * 1000) / 1000),
    onsets: onsets.map((onset) => ({ ...onset, strength: Math.round((100 * onset.strength) / strongest) / 100 })).sort((a, b) => a.t - b.t || a.sound.localeCompare(b.sound)),
    envelope: { fps: FPS, unit: "dBFS RMS of the mid channel per frame; null is digital silence", values: envelope },
    notes: "Written by Kitchen with the track, from the composition itself. grid is the tempo grid at 100 BPM from 0 s, including where nothing plays. onsets are every sound's start, strength relative to the strongest.",
  };
}

export function wavBytes(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length * 2, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const directory = process.argv[2] ?? "fixtures";
  const { pcm, cues } = render();
  writeFileSync(join(directory, "track.wav"), wavBytes(pcm));
  writeFileSync(join(directory, "cues.json"), `${JSON.stringify(cues, null, 2)}\n`);
  console.log(`Wrote ${join(directory, "track.wav")} and cues.json: ${cues.onsets.length} onsets.`);
}
