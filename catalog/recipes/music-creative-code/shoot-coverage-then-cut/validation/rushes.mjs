// Rushes check: the rushes are what the first turn logged, each one take with
// no cut inside it, and every frame of every cut is a frame of the rushes.
// - rushes/rushes.json lists every clip in rushes/ with its camera and sha256;
//   the files must still have those hashes. Kitchen does not keep a copy of
//   the workspace between turns, so this proves the rushes and the log agree,
//   not that neither changed after the first turn. The first turn's reply
//   names the log's sha256 in the trace; this check prints the delivered one
//   for the taster to compare, and the cut-1.mp4 hash likewise.
// - Every frame of each cut is compared, as a 48 x 27 RGB thumbnail, with
//   every rushes frame; it must be within 3 levels (of 255) on average of one
//   of them. Re-encoding the same frames measures well under 1; a grade, a
//   title, a reframe or a frame drawn for the cut measures more. A small
//   punch-in on a plain picture can pass; the brief forbids it and tasting
//   owns it.
// The conform it prints (which clip and frames each run of the cut came from)
// is Kitchen's reading of the edit, for the taster beside edl.json.
// Run from the delivery root: node validation/rushes.mjs
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { compareCuts, frameDifferences } from "./cuts.mjs";

export const THUMB = Object.freeze({ width: 48, height: 27, channels: 3 });
export const RUSHES_THRESHOLDS = Object.freeze({
  maxFrameDifference: 3, // mean absolute difference per thumbnail value, 0-255
});
const PIXELS = THUMB.width * THUMB.height * THUMB.channels;
const BLOCK = { x: 8, y: 9 }; // 6 x 3 blocks; their means bound the full difference from below

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Decode a film's frames to small RGB thumbnails, one Uint8Array of frames x PIXELS. */
export function thumbnails(file) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-vf", `scale=${THUMB.width}:${THUMB.height}:flags=area,format=rgb24`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`Cannot decode ${file}: ${result.stderr?.toString().trim() || result.error?.message}`);
  const bytes = new Uint8Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.length);
  return { bytes, frames: Math.floor(bytes.length / PIXELS) };
}

function blockMeans(bytes, frames) {
  const bx = THUMB.width / BLOCK.x, by = THUMB.height / BLOCK.y, per = bx * by * THUMB.channels;
  const out = new Float32Array(frames * per);
  for (let f = 0; f < frames; f++) {
    for (let y = 0; y < THUMB.height; y++) {
      for (let x = 0; x < THUMB.width; x++) {
        for (let c = 0; c < THUMB.channels; c++) {
          const block = (Math.floor(y / BLOCK.y) * bx + Math.floor(x / BLOCK.x)) * THUMB.channels + c;
          out[f * per + block] += bytes[f * PIXELS + (y * THUMB.width + x) * THUMB.channels + c] / (BLOCK.x * BLOCK.y);
        }
      }
    }
  }
  return { means: out, per };
}

/** Index the rushes for frame lookup: every clip's thumbnails in one array, with block means. */
export function indexRushes(clips) {
  const parts = clips.map((clip) => ({ file: clip.file, ...thumbnails(clip.file) }));
  const frames = parts.reduce((sum, part) => sum + part.frames, 0);
  const bytes = new Uint8Array(frames * PIXELS), owner = [];
  let at = 0;
  for (const part of parts) {
    bytes.set(part.bytes.subarray(0, part.frames * PIXELS), at * PIXELS);
    for (let f = 0; f < part.frames; f++) owner.push({ file: part.file, frame: f });
    at += part.frames;
  }
  return { bytes, frames, owner, ...blockMeans(bytes, frames) };
}

function difference(a, ai, b, bi, limit) {
  let sum = 0;
  const stop = limit * PIXELS;
  for (let i = 0; i < PIXELS; i++) {
    sum += Math.abs(a[ai * PIXELS + i] - b[bi * PIXELS + i]);
    if (sum > stop) return Infinity;
  }
  return sum / PIXELS;
}

/**
 * Find each cut frame in the rushes. The frame after the previous match is
 * tried first (play, hold, step, reverse); otherwise every rushes frame whose
 * block means could be close enough is compared in full.
 */
export function conform(index, cut, thresholds = RUSHES_THRESHOLDS) {
  const limit = thresholds.maxFrameDifference;
  const cutMeans = blockMeans(cut.bytes, cut.frames).means;
  const matches = [];
  let previous = null;
  for (let q = 0; q < cut.frames; q++) {
    let best = null;
    if (previous !== null) {
      for (const r of [previous + 1, previous, previous + 2, previous - 1]) {
        if (r < 0 || r >= index.frames) continue;
        const value = difference(cut.bytes, q, index.bytes, r, limit);
        if (value <= limit && (best === null || value < best.difference)) best = { rushes: r, difference: value };
      }
    }
    if (best === null) {
      for (let r = 0; r < index.frames; r++) {
        let bound = 0;
        for (let k = 0; k < index.per; k++) bound += Math.abs(cutMeans[q * index.per + k] - index.means[r * index.per + k]);
        if (bound / index.per > limit) continue;
        const value = difference(cut.bytes, q, index.bytes, r, best ? Math.min(limit, best.difference) : limit);
        if (value <= limit && (best === null || value < best.difference)) best = { rushes: r, difference: value };
      }
    }
    matches.push(best ? { frame: q, file: index.owner[best.rushes].file, clipFrame: index.owner[best.rushes].frame, rushes: best.rushes, difference: best.difference } : { frame: q, file: null, clipFrame: null, rushes: null, difference: null });
    previous = best ? best.rushes : null;
  }
  return matches;
}

/** Read and verify the rushes log against the files. */
export function readLog(log, files) {
  const problems = [];
  const clips = Array.isArray(log?.clips) ? log.clips : [];
  const listed = new Set();
  for (const [i, clip] of clips.entries()) {
    if (typeof clip?.file !== "string" || !/^rushes\/[A-Za-z0-9._-]+\.mp4$/u.test(clip.file)) { problems.push(`clip ${i + 1}: file must be rushes/<name>.mp4`); continue; }
    if (listed.has(clip.file)) problems.push(`${clip.file} is listed twice`);
    listed.add(clip.file);
    if (typeof clip.camera !== "string" || !clip.camera.trim()) problems.push(`${clip.file} needs a camera`);
    if (!files.includes(clip.file)) { problems.push(`${clip.file} is listed but missing`); continue; }
    if (clip.sha256 !== sha256(clip.file)) problems.push(`${clip.file} does not have the sha256 the log records`);
  }
  for (const file of files) if (!listed.has(file)) problems.push(`${file} is in rushes/ but not in the log`);
  return { clips: clips.filter((clip) => listed.has(clip.file) && files.includes(clip.file)), cameras: new Set(clips.map((clip) => clip?.camera)).size, problems };
}

function probe(file) {
  const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=codec_name,width,height,avg_frame_rate,nb_read_packets", "-of", "json", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffprobe ${file}: ${result.stderr.trim()}`);
  const stream = JSON.parse(result.stdout).streams?.[0];
  if (!stream) throw new Error(`${file} has no video`);
  const [n, d] = stream.avg_frame_rate.split("/").map(Number);
  return { codec: stream.codec_name, width: stream.width, height: stream.height, fps: n / d, frames: Number(stream.nb_read_packets) };
}

export function checkRushes(contract, thresholds = RUSHES_THRESHOLDS) {
  const spec = contract.rushes;
  const reasons = [];
  const files = readdirSync("rushes").filter((name) => name.endsWith(".mp4")).sort().map((name) => `rushes/${name}`);
  const log = readLog(JSON.parse(readFileSync(spec.log, "utf8")), files);
  reasons.push(...log.problems);
  if (log.clips.length < spec.minClips) reasons.push(`${log.clips.length} clips; at least ${spec.minClips} are required`);
  if (log.cameras < spec.minCameras) reasons.push(`${log.cameras} camera positions logged; at least ${spec.minCameras} are required`);
  let seconds = 0;
  for (const clip of log.clips) {
    const info = probe(clip.file);
    seconds += info.frames / contract.fps;
    if (info.codec !== "h264" || info.width !== contract.width || info.height !== contract.height || info.fps !== contract.fps) reasons.push(`${clip.file} is ${info.codec} ${info.width}x${info.height} at ${info.fps} fps; rushes are h264 ${contract.width}x${contract.height} at ${contract.fps} fps`);
    const inside = compareCuts(frameDifferences(clip.file), { cuts: [] });
    if (inside.extra.length) reasons.push(`${clip.file} has a cut inside it at frame ${inside.extra.map((d) => d.frame).join(", ")}; a clip is one take`);
  }
  if (seconds < spec.minSeconds || seconds > spec.maxSeconds) reasons.push(`rushes run ${seconds.toFixed(2)} s; they must total ${spec.minSeconds}-${spec.maxSeconds} s`);
  const index = log.clips.length ? indexRushes(log.clips) : null;
  const conforms = [];
  for (const film of spec.cuts) {
    const matches = index ? conform(index, thumbnails(film), thresholds) : [];
    const unmatched = matches.filter((match) => match.file === null);
    if (unmatched.length) reasons.push(`${film}: ${unmatched.length} frames are not in the rushes, first at frame ${unmatched[0].frame}`);
    conforms.push({ film, matches, unmatched: unmatched.length });
  }
  return { passed: reasons.length === 0, reasons, seconds, clips: log.clips.length, cameras: log.cameras, conforms };
}

/** Runs of consecutive cut frames taken from consecutive frames of one clip. */
export function conformRuns(matches) {
  const out = [];
  for (const match of matches) {
    const last = out.at(-1);
    if (last && match.file !== null && last.file === match.file && match.frame === last.to + 1 && match.clipFrame === last.clipTo + 1) {
      last.to = match.frame;
      last.clipTo = match.clipFrame;
    } else {
      out.push({ from: match.frame, to: match.frame, file: match.file, clipFrom: match.clipFrame, clipTo: match.clipFrame });
    }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const contract = JSON.parse(readFileSync("fixtures/contract.json", "utf8"));
  const result = checkRushes(contract);
  console.log(`Rushes log ${contract.rushes.log} sha256 ${sha256(contract.rushes.log)}; compare with the first turn's reply.`);
  for (const film of contract.rushes.anchors ?? []) console.log(`${film} sha256 ${sha256(film)}; compare with the turn that made it.`);
  for (const { film, matches } of result.conforms) {
    const list = conformRuns(matches).map((run) => `${run.from}-${run.to} ${run.file ? `${run.file} ${run.clipFrom}-${run.clipTo}` : "not in rushes"}`);
    console.log(`${film} conform: ${list.join("; ")}`);
  }
  if (!result.passed) {
    console.error(`FAIL: rushes: ${result.reasons.join("; ")}`);
    process.exit(1);
  }
  console.log(`PASS: ${result.clips} clips from ${result.cameras} logged camera positions, ${result.seconds.toFixed(2)} s, each one take, logged hashes match, and every frame of ${contract.rushes.cuts.join(" and ")} is a rushes frame.`);
}
