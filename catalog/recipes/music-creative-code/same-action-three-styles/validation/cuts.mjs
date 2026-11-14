// Cut check: the hard cuts a film's edl.json declares are the hard cuts in its
// picture, within one frame. FFmpeg's scene-change filter (scdet) measures
// each frame's mean absolute difference from the one before (mafd, percent of
// full scale); a hard cut is a spike in it. Burden of proof is asymmetric so an
// ambiguous picture never fails a film:
// - a declared cut is confirmed by any change within a frame of it that is at
//   least 0.15% and either three times the quieter side's usual level or 6%
//   above it. 0.15% is three times the floor a still code-drawn shot encodes
//   to (a half-second jump of a 60 x 160 px figure in a locked 1080p wide
//   measures 0.16%); the 6% margin, an unmistakable cut's own size, keeps a
//   cut confirmed under grain or fast motion that lifts the local level (a
//   reframe under heavy grain measures 11.5% against 3.9%). Other declared
//   cuts are left out of the local level, so a run of one-frame shots
//   confirms; where nothing else is left, each change must reach 6%. This is
//   generous: a cut declared where an abrupt motion or a dissolve starts, or
//   inside animation held on twos (every drawing change is a step from a
//   still frame), can pass; one declared in a still or steadily moving
//   stretch cannot. A cut smaller than both can go unconfirmed; the brief
//   says so.
// - an undeclared cut fails only when it is unmistakable: at least 6% and three
//   times the largest change on either side, so a pan, a whip, motion that
//   starts abruptly or animation held on twos and threes never reads as a cut.
//   Shot changes between different compositions measure 10% and more.
// Isolated changes from 1.5% up to that level are reported for tasting, not
// failed. A flash or a light that changes the whole frame at once is a cut to
// this check; the brief says to list it. Declared transitions (a dissolve, a
// wipe) are exempt over their span and are not confirmed: only hard cuts are.
// One frame of tolerance absorbs the one real ambiguity, whether a cut's frame
// is the outgoing shot's last or the incoming shot's first; code-rendered cuts
// are otherwise frame-exact.
// Run from the delivery root: node validation/cuts.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CUT_THRESHOLDS = Object.freeze({
  toleranceFrames: 1,
  side: 5, // frames on each side that set the local level (the two beside the change are skipped)
  floor: 0.05, // quietest local level: a still code-drawn shot encodes to 0.00-0.02
  confirmMafd: 0.15, // three times the floor
  confirmRatio: 3,
  confirmMargin: 6, // above the local level: an unmistakable cut's size (extraMafd)
  extraMafd: 6,
  extraRatio: 3,
  reportMafd: 1.5,
});

/** Per-frame mean absolute difference from the previous frame, from FFmpeg's scdet. Frame 0 is 0. */
export function frameDifferences(file) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-vf", "scdet=threshold=100,metadata=mode=print:key=lavfi.scd.mafd:file=-", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`Cannot measure frame differences in ${file}: ${result.stderr?.trim() || result.error?.message}`);
  const values = [...result.stdout.matchAll(/lavfi\.scd\.mafd=([\d.]+)/gu)].map((match) => Number(match[1]));
  if (values.length === 0) throw new Error(`No frames measured in ${file}`);
  return values;
}

function secondSmallest(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(1, sorted.length - 1)];
}

/**
 * Each frame's difference against its neighbourhood, skipping k-1 and k+1
 * (a one-frame shot moves both) and any frame in `declared` (another cut is
 * not the shot's own level): `usual` is the quieter side's usual level (second
 * smallest), null when every neighbour was a declared cut; `quiet` is the
 * change against it, `isolated` against the largest change on either side.
 */
export function discontinuities(mafd, thresholds = CUT_THRESHOLDS, declared = new Set()) {
  const window = (from, to) => {
    const indices = [];
    for (let i = Math.max(1, from); i < Math.min(mafd.length, to); i++) indices.push(i);
    return { any: indices.length > 0, values: indices.filter((i) => !declared.has(i)).map((i) => mafd[i]) };
  };
  return mafd.map((value, k) => {
    if (k === 0) return { frame: 0, mafd: 0, usual: 0, quiet: 0, isolated: 0 };
    const windows = [window(k - 1 - thresholds.side, k - 1), window(k + 2, k + 2 + thresholds.side)];
    const sides = windows.map((side) => side.values).filter((side) => side.length);
    const usual = sides.length ? Math.min(...sides.map(secondSmallest)) : windows.some((side) => side.any) ? null : 0;
    const largest = sides.length ? Math.max(...sides.flat()) : 0;
    return { frame: k, mafd: value, usual, quiet: value / Math.max(thresholds.floor, usual ?? 0), isolated: value / Math.max(thresholds.floor, largest) };
  });
}

/**
 * Read an EDL against the film's frame count. Shots tile [0, frames) in
 * order; each shot after the first comes in on a hard cut unless it declares
 * `in: { transition, frames }`.
 */
export function readEdl(edl, { fps, frames, transitions = true }) {
  const problems = [];
  if (!edl || typeof edl !== "object") return { cuts: [], spans: [], problems: ["edl.json is not an object"] };
  if (edl.fps !== fps) problems.push(`edl fps ${edl.fps} is not ${fps}`);
  if (edl.frames !== frames) problems.push(`edl frames ${edl.frames} is not ${frames}`);
  const shots = Array.isArray(edl.shots) ? edl.shots : [];
  if (shots.length === 0) problems.push("edl.shots must list at least one shot");
  const cuts = [], spans = [], ids = new Set();
  let expected = 0;
  for (const [index, shot] of shots.entries()) {
    const label = `shot ${index + 1}`;
    if (typeof shot?.id !== "string" || !shot.id.trim()) problems.push(`${label} needs an id`);
    else if (ids.has(shot.id)) problems.push(`shot id ${shot.id} is repeated`);
    else ids.add(shot.id);
    if (!Number.isInteger(shot?.start) || !Number.isInteger(shot?.end)) { problems.push(`${label} needs integer start and end frames`); continue; }
    if (shot.start !== expected) problems.push(`${label} starts at frame ${shot.start}; the previous shot ends at ${expected}`);
    if (shot.end <= shot.start) problems.push(`${label} ends at or before it starts`);
    expected = shot.end;
    if (index === 0) {
      if (shot.in !== undefined) problems.push("the first shot has no incoming edit");
      continue;
    }
    if (shot.in === undefined || shot.in === "cut") { cuts.push(shot.start); continue; }
    const length = shot.in?.frames;
    if (typeof shot.in?.transition !== "string" || !shot.in.transition.trim() || !Number.isInteger(length) || length < 1) {
      problems.push(`${label} in must be "cut" or { "transition": "<kind>", "frames": <n> }`);
    } else if (shot.start + length > shot.end) {
      problems.push(`${label}'s ${shot.in.transition} runs ${length} frames, past the shot's end`);
    } else if (!transitions) {
      problems.push(`${label} comes in on a ${shot.in.transition}; this film takes hard cuts only`);
    } else {
      spans.push([shot.start, shot.start + length]);
    }
  }
  if (shots.length && expected !== frames) problems.push(`shots end at frame ${expected}; the film has ${frames}`);
  return { cuts, spans, problems };
}

/** Compare declared hard cuts with the picture's discontinuities. */
export function compareCuts(mafd, { cuts, spans = [] }, thresholds = CUT_THRESHOLDS) {
  const frames = discontinuities(mafd, thresholds, new Set(cuts));
  const tolerance = thresholds.toleranceFrames;
  const confirms = (d) => {
    if (!d || d.frame === 0 || d.mafd < thresholds.confirmMafd) return false;
    if (d.usual === null) return d.mafd >= thresholds.confirmMargin;
    return d.quiet >= thresholds.confirmRatio || d.mafd - d.usual >= thresholds.confirmMargin;
  };
  const used = new Set(), confirmed = [], missing = [];
  for (const cut of cuts) {
    const candidates = [cut, cut - 1, cut + 1, cut - 2, cut + 2].filter((k) => Math.abs(k - cut) <= tolerance);
    const match = candidates.find((k) => !used.has(k) && confirms(frames[k]));
    if (match === undefined) missing.push({ frame: cut, mafd: frames[cut]?.mafd ?? null });
    else { used.add(match); confirmed.push({ frame: cut, detected: match, mafd: frames[match].mafd }); }
  }
  const declared = (k) => cuts.some((cut) => Math.abs(k - cut) <= tolerance) || spans.some(([from, to]) => k >= from - tolerance && k <= to + tolerance);
  const spikes = frames.filter((d) => d.frame > 0 && d.isolated >= thresholds.extraRatio && !declared(d.frame));
  const extra = spikes.filter((d) => d.mafd >= thresholds.extraMafd).map(({ frame, mafd: value }) => ({ frame, mafd: value }));
  const unclear = spikes.filter((d) => d.mafd >= thresholds.reportMafd && d.mafd < thresholds.extraMafd).map(({ frame, mafd: value }) => ({ frame, mafd: value }));
  return { confirmed, missing, extra, unclear, frames: mafd.length };
}

/** Nearest cue to each cut, in milliseconds (negative: the cut comes before the cue). Reported, never gated. */
export function cueOffsets(cuts, onsets, fps) {
  return cuts.map((frame) => {
    const t = frame / fps;
    const nearest = onsets.reduce((best, onset) => (best === null || Math.abs(onset.t - t) < Math.abs(best.t - t) ? onset : best), null);
    return { frame, t, cue: nearest, offsetMs: nearest ? Math.round((t - nearest.t) * 1000) : null };
  });
}

export function checkFilm({ film, edl, fps, frames, required = [], transitions = true }, thresholds = CUT_THRESHOLDS) {
  const read = readEdl(edl, { fps, frames, transitions });
  const reasons = [...read.problems];
  for (const frame of required) if (!read.cuts.includes(frame)) reasons.push(`edl has no hard cut at frame ${frame} (${(frame / fps).toFixed(3)} s)`);
  const mafd = frameDifferences(film);
  if (mafd.length !== frames) reasons.push(`${film} has ${mafd.length} frames; the contract says ${frames}`);
  const result = compareCuts(mafd, read, thresholds);
  const at = (frame) => `frame ${frame} (${(frame / fps).toFixed(3)} s)`;
  for (const cut of result.missing) reasons.push(`declared cut at ${at(cut.frame)} is not in the picture (difference ${cut.mafd?.toFixed(2) ?? "none"}%)`);
  for (const cut of result.extra) reasons.push(`undeclared cut at ${at(cut.frame)} (difference ${cut.mafd.toFixed(2)}%)`);
  return { passed: reasons.length === 0, reasons, ...result, cuts: read.cuts, spans: read.spans };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const contract = JSON.parse(readFileSync("fixtures/contract.json", "utf8"));
  const spec = contract.cuts ?? {};
  const films = spec.films ?? [{ film: "film.mp4", edl: "edl.json" }];
  const cues = spec.cues ? JSON.parse(readFileSync(spec.cues, "utf8")).onsets : null;
  let failed = false;
  for (const { film, edl } of films) {
    let result;
    try {
      result = checkFilm({ film, edl: JSON.parse(readFileSync(edl, "utf8")), fps: contract.fps, frames: contract.frames, required: spec.required ?? [], transitions: spec.transitions ?? true });
    } catch (error) {
      console.error(`FAIL: ${film}: ${error.message}`);
      failed = true;
      continue;
    }
    const summary = `${result.cuts.length} hard cuts declared, ${result.confirmed.length} confirmed, ${result.spans.length} transitions exempt`;
    if (!result.passed) { failed = true; console.error(`FAIL: ${film} and ${edl} disagree: ${result.reasons.join("; ")} (${summary})`); }
    else console.log(`PASS: ${film} matches ${edl}: ${summary}.`);
    if (result.unclear.length) console.log(`  Unclear changes left to tasting: ${result.unclear.slice(0, 8).map((d) => `frame ${d.frame} (${d.mafd.toFixed(2)}%)`).join(", ")}`);
    if (cues) {
      const offsets = cueOffsets(result.cuts, cues, contract.fps);
      const near = offsets.filter((o) => o.offsetMs !== null && Math.abs(o.offsetMs) <= 1000 / contract.fps);
      console.log(`  Cuts within a frame of a cue: ${near.length}/${offsets.length}. Nearest cue per cut: ${offsets.map((o) => `${o.t.toFixed(3)} s ${o.cue ? `${o.offsetMs >= 0 ? "+" : ""}${o.offsetMs} ms from ${o.cue.sound}` : "no cue"}`).join("; ")}`);
    }
  }
  if (failed) process.exit(1);
}
