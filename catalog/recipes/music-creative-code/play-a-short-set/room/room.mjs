#!/usr/bin/env node
// The music room: a live set played in steps on Strudel, with no audio.
// Each `play` commits the next step of the set, appends it to the recording
// and prints what just sounded as numbers. See README.md beside this file.
//
// This program links the Strudel engine in strudel/ and is licensed with it
// under AGPL-3.0-or-later; see LICENSE and NOTICE.md.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The world. Every model plays in exactly this room; changing a value here makes a different room. */
export const ROOM = Object.freeze({
  id: "music-room",
  version: 1,
  steps: 12,
  cyclesPerStep: 8,
  cps: Object.freeze({ initial: 0.5, min: 0.25, max: 1 }),
  maxEventsPerStep: 2048,
  maxCodeBytes: 8192,
  sounds: Object.freeze(["sine", "sin", "triangle", "tri", "square", "sqr", "sawtooth", "saw", "supersaw", "pulse", "sbd", "white", "pink", "brown", "crackle"]),
});

const ENGINE_FILES = ["strudel.mjs", "superdough.js", "worklets.js"];
const RESTS = new Set(["-", "~", "_"]);
// Noise and the synth kick are heard as unpitched unless the pattern gives them a note.
// superdough plays an oscillator that has no note at MIDI 36.
const UNPITCHED = new Set(["white", "pink", "brown", "crackle", "sbd"]);
const defaultNote = (sound) => (UNPITCHED.has(sound) ? null : 36);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const round = (value, digits = 6) => Number(value.toFixed(digits));

/** JSON with sorted keys and no whitespace: the bytes every hash in the recording is taken over. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** A play the room refuses. It is recorded and does not use a step. */
export class Refusal extends Error {}

/** Where a room mounted at `roomDirectory` keeps its files. The stage is the directory above it. */
export function roomPaths(roomDirectory) {
  const stage = path.resolve(roomDirectory, "..");
  return {
    room: roomDirectory,
    engine: path.join(roomDirectory, "strudel"),
    template: path.join(roomDirectory, "player.html"),
    stage,
    recording: path.join(stage, "recording.json"),
    player: path.join(stage, "index.html"),
    worklets: path.join(stage, "worklets.js"),
    journal: path.join(stage, ".room", "journal"),
    lock: path.join(stage, ".room", "lock"),
  };
}

/** The room as a recording names it: its rules and the exact engine bytes it evaluated with. */
export function roomHeader(paths) {
  const manifest = JSON.parse(readFileSync(path.join(paths.engine, "manifest.json"), "utf8"));
  const version = (name) => manifest.packages.find((item) => item.name === name && item.path === `node_modules/${name}`)?.version;
  return {
    ...JSON.parse(JSON.stringify(ROOM)),
    engine: {
      strudel: version("@strudel/core"),
      superdough: version("superdough"),
      license: manifest.license,
      sha256: Object.fromEntries(ENGINE_FILES.map((name) => [name, sha256(readFileSync(path.join(paths.engine, name)))])),
    },
  };
}

function quietConsole() {
  const saved = {};
  for (const name of ["log", "info", "warn", "error", "debug"]) { saved[name] = console[name]; console[name] = () => {}; }
  return () => Object.assign(console, saved);
}

// A small seeded generator, so a pattern that calls Math.random sounds the same when the step is evaluated again.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export async function loadEngine(paths) {
  const restore = quietConsole();
  try {
    const { core, mini, tonal, transpiler } = await import(path.join(paths.engine, "strudel.mjs"));
    await core.evalScope(core, mini, tonal);
    return { core, transpiler };
  } finally { restore(); }
}

function plainData(value, label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Refusal(`event value ${label || "(whole)"} is not a finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => plainData(item, `${label}[${index}]`));
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, plainData(item, label ? `${label}.${key}` : key)]));
  }
  throw new Refusal(`event value ${label || "(whole)"} is not plain data`);
}

function soundOf(value) {
  const sound = String(value.s ?? "triangle");
  return (value.bank ? `${value.bank}_${sound}` : sound).toLowerCase();
}

function pitchOf(core, value, sound) {
  const octave = typeof value.octave === "number" ? value.octave : 0;
  if (typeof value.freq === "number" && value.freq > 0) return core.freqToMidi(value.freq * 2 ** octave);
  const note = value.note || defaultNote(sound);
  if (note === null) return null;
  return (typeof note === "string" ? core.noteToMidi(note) : Number(note)) + 12 * octave;
}

/**
 * Evaluate one step: the pattern code, at the tempo the set arrived with, over
 * this step's cycles. Returns the tempo the code left and every event that
 * starts inside the step, or throws a Refusal.
 */
export async function perform(engine, { code, cps, step }) {
  const { core, transpiler } = engine;
  const from = (step - 1) * ROOM.cyclesPerStep;
  const to = step * ROOM.cyclesPerStep;
  const restore = quietConsole();
  const random = Math.random;
  Math.random = seededRandom(step);
  try {
    let failure = null;
    const { evaluate, scheduler } = core.repl({ defaultOutput: () => {}, getTime: () => 0, transpiler, onEvalError: (error) => { failure = error; } });
    scheduler.setCps(cps);
    const pattern = await evaluate(code, false);
    if (failure) throw failure;
    const tempo = Number(scheduler.cps);
    if (!Number.isFinite(tempo) || tempo < ROOM.cps.min || tempo > ROOM.cps.max) throw new Refusal(`cps ${tempo} is outside this room's ${ROOM.cps.min} to ${ROOM.cps.max}`);
    const events = [];
    for (let cycle = from; cycle < to; cycle += 1) {
      for (const hap of pattern.queryArc(cycle, cycle + 1, { _cps: tempo })) {
        if (!hap.hasOnset()) continue;
        hap.ensureObjectValue();
        const value = plainData(hap.value, "");
        const sound = soundOf(value);
        if (RESTS.has(sound)) continue;
        if (!ROOM.sounds.includes(sound)) throw new Refusal(`sound "${sound}" is not in this room`);
        pitchOf(core, value, sound);
        events.push([hap.whole.begin.valueOf(), hap.whole.end.valueOf(), value]);
        if (events.length > ROOM.maxEventsPerStep) throw new Refusal(`more than ${ROOM.maxEventsPerStep} events in one step`);
      }
    }
    events.sort((a, b) => a[0] - b[0]);
    return { cps: tempo, events };
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal(String(error?.message ?? error).split("\n")[0].slice(0, 500));
  } finally {
    Math.random = random;
    restore();
  }
}

/** What a step sounded like, as numbers. This is the printout and the `heard` field of the recording. */
export function hear(core, { step, cps, cycles, seconds, events }) {
  const bars = [];
  const pitches = [];
  const controls = {};
  const lengths = [];
  // Voices are listed in the order their sounds first enter the step, the same in every bar.
  const order = [...new Set(events.map(([, , value]) => soundOf(value)))];
  for (let cycle = cycles[0]; cycle < cycles[1]; cycle += 1) {
    const voices = new Map(order.map((sound) => [sound, { s: sound, onsets: [], notes: [] }]));
    for (const [begin, end, value] of events) {
      if (begin < cycle || begin >= cycle + 1) continue;
      const sound = soundOf(value);
      const voice = voices.get(sound);
      const pitch = pitchOf(core, value, sound);
      voice.onsets.push(round(begin - cycle, 4));
      voice.notes.push(pitch === null ? null : round(pitch, 2));
      if (pitch !== null) pitches.push(pitch);
      lengths.push(end - begin);
      for (const [key, item] of Object.entries(value)) {
        if (key === "s" || key === "note" || key === "freq") continue;
        if (typeof item === "number") controls[key] = controls[key] ? [Math.min(controls[key][0], item), Math.max(controls[key][1], item)] : [item, item];
      }
    }
    const heard = [...voices.values()].filter((voice) => voice.onsets.length).map((voice) => (voice.notes.every((note) => note === null) ? { s: voice.s, onsets: voice.onsets } : voice));
    const same = bars.find((bar) => bar.voices && canonical(bar.voices) === canonical(heard));
    bars.push(same && heard.length ? { cycle, sameAs: same.cycle } : { cycle, voices: heard });
  }
  const perCycle = Array.from({ length: cycles[1] - cycles[0] }, (_, index) => events.filter(([begin]) => Math.floor(begin) === cycles[0] + index).length);
  return {
    step,
    steps: ROOM.steps,
    remaining: ROOM.steps - step,
    cycles,
    cps: round(cps),
    seconds,
    events: events.length,
    perCycle,
    perSecond: round(events.length / (seconds[1] - seconds[0]), 3),
    pitch: pitches.length ? { low: round(Math.min(...pitches), 2), high: round(Math.max(...pitches), 2), mean: round(pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length, 2), classes: [...new Set(pitches.map((pitch) => ((Math.round(pitch) % 12) + 12) % 12))].sort((a, b) => a - b) } : null,
    lengths: lengths.length ? [round(Math.min(...lengths), 4), round(Math.max(...lengths), 4)] : null,
    controls: Object.fromEntries(Object.keys(controls).sort().map((key) => [key, controls[key].map((item) => round(item, 4))])),
    bars,
  };
}

/** One whole step as the recording holds it: where it sits in the set, what the code played and what was heard. */
export async function takeStep(engine, { code, cps, step, seconds }) {
  const performed = await perform(engine, { code, cps, step });
  const cycles = [(step - 1) * ROOM.cyclesPerStep, step * ROOM.cyclesPerStep];
  const span = [round(seconds), round(seconds + ROOM.cyclesPerStep / performed.cps)];
  return { cps: performed.cps, cycles, seconds: span, events: performed.events, heard: hear(engine.core, { step, cps: performed.cps, cycles, seconds: span, events: performed.events }) };
}

/** The printout: valid JSON, one line per bar voice. */
export function printout(heard) {
  const { bars, ...summary } = heard;
  const lines = Object.entries(summary).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  const barLines = bars.map((bar) => {
    if (bar.sameAs !== undefined || bar.voices.length === 0) return `  ${JSON.stringify(bar)}`;
    return `  {"cycle": ${bar.cycle}, "voices": [\n${bar.voices.map((voice) => `   ${JSON.stringify(voice)}`).join(",\n")}]}`;
  });
  return `{\n${lines.join("\n")}\n "bars": [\n${barLines.join(",\n")}\n ]\n}`;
}

export function emptyRecording(header) {
  const genesis = sha256(canonical({ room: header }));
  return { schemaVersion: 1, room: header, genesis, entries: [], head: genesis, complete: false };
}

function seal(entry) {
  return { ...entry, hash: sha256(canonical(entry)) };
}

function readJournal(paths) {
  return existsSync(paths.journal) ? readFileSync(paths.journal, "utf8").split("\n").filter(Boolean) : [];
}

/** The recording as the room left it, or a fresh one. Refuses a recording that is not this room's own. */
export function loadRecording(paths, header) {
  const journal = readJournal(paths);
  if (!existsSync(paths.recording)) {
    if (journal.length) throw new Refusal("recording.json is missing, but this room has already been played");
    return emptyRecording(header);
  }
  let recording;
  try { recording = JSON.parse(readFileSync(paths.recording, "utf8")); } catch { throw new Refusal("recording.json is not the room's recording"); }
  const hashes = Array.isArray(recording?.entries) ? recording.entries.map((entry) => entry?.hash) : null;
  if (!hashes || canonical(recording.room) !== canonical(header) || canonical(hashes) !== canonical(journal)) throw new Refusal("recording.json is not the room's recording");
  return recording;
}

/** The player page for a recording: the template with the synth and the recording set into it. */
export function renderPlayer(paths, recording) {
  const template = readFileSync(paths.template, "utf8");
  const audio = readFileSync(path.join(paths.engine, "superdough.js"), "utf8");
  // Inside a script element only "</" and "<!--" can end or confuse the element; JSON also allows two line separators JavaScript does not.
  const inline = (text) => text.replace(/<(?=[!/])/gu, "\\u003c").replace(/[\u{2028}\u{2029}]/gu, (separator) => `\\u${separator.codePointAt(0).toString(16)}`);
  const parts = template.split(/\/\*ROOM_AUDIO\*\/|\/\*ROOM_RECORDING\*\//u);
  if (parts.length !== 3) throw new Error("player.html must hold one ROOM_AUDIO and one ROOM_RECORDING slot, in that order");
  return `${parts[0]}${audio.replace(/<\/script/giu, "<\\/script")}${parts[1]}${inline(JSON.stringify(recording))}${parts[2]}`;
}

function writeAtomic(file, text) {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}

function writeStage(paths, recording) {
  writeAtomic(paths.recording, `${JSON.stringify(recording)}\n`);
  writeAtomic(paths.player, renderPlayer(paths, recording));
  copyFileSync(path.join(paths.engine, "worklets.js"), paths.worklets);
}

function withLock(paths, action) {
  mkdirSync(path.dirname(paths.lock), { recursive: true });
  // A play that died holding the lock must not close the room for good.
  if (existsSync(paths.lock) && Date.now() - statSync(paths.lock).mtimeMs > 120000) rmSync(paths.lock, { force: true });
  let handle;
  try { handle = openSync(paths.lock, "wx"); } catch { throw new Refusal("the room is busy with another play"); }
  return Promise.resolve().then(action).finally(() => { closeSync(handle); rmSync(paths.lock, { force: true }); });
}

function position(recording) {
  const played = recording.entries.filter((entry) => entry.kind === "step");
  const last = played.at(-1);
  return { step: played.length + 1, cps: last?.cps ?? ROOM.cps.initial, seconds: last?.seconds[1] ?? 0, played: played.length };
}

/**
 * Play the next step. Returns { heard } for a committed step or { refused } for
 * a pattern the room would not take; both are appended to the recording.
 */
export async function play(paths, code, { now = () => new Date() } = {}) {
  const header = roomHeader(paths);
  return withLock(paths, async () => {
    const recording = loadRecording(paths, header);
    const { step, cps, seconds } = position(recording);
    if (recording.complete) throw new Refusal(`the set is complete: all ${ROOM.steps} steps are played`);
    const base = { index: recording.entries.length, at: now().toISOString(), prev: recording.head };
    let entry;
    try {
      if (Buffer.byteLength(code) > ROOM.maxCodeBytes) throw new Refusal(`pattern is ${Buffer.byteLength(code)} bytes; this room takes at most ${ROOM.maxCodeBytes}`);
      const taken = await takeStep(await loadEngine(paths), { code, cps, step, seconds });
      entry = seal({ ...base, kind: "step", step, code, ...taken });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      // A refused pattern is part of what happened in the room. Oversized code is kept only up to the limit.
      entry = seal({ ...base, kind: "refused", step, code: Buffer.from(code).subarray(0, ROOM.maxCodeBytes).toString("utf8"), error: error.message });
    }
    const next = { ...recording, entries: [...recording.entries, entry], head: entry.hash, complete: entry.kind === "step" && entry.step === ROOM.steps };
    // The journal is written first: a recording can never hold an entry the room does not remember.
    mkdirSync(path.dirname(paths.journal), { recursive: true });
    appendFileSync(paths.journal, `${entry.hash}\n`);
    writeStage(paths, next);
    return entry.kind === "step" ? { heard: entry.heard } : { refused: { refused: true, error: entry.error, step, remaining: ROOM.steps - step + 1 } };
  });
}

export function status(paths) {
  const recording = loadRecording(paths, roomHeader(paths));
  const { step, cps, seconds, played } = position(recording);
  return {
    steps: ROOM.steps,
    played,
    remaining: ROOM.steps - played,
    next: recording.complete ? null : { step, cycles: [(step - 1) * ROOM.cyclesPerStep, step * ROOM.cyclesPerStep] },
    cps: round(cps),
    seconds: round(seconds),
    refused: recording.entries.filter((entry) => entry.kind === "refused").length,
    complete: recording.complete,
  };
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sameKeys = (value, keys) => isObject(value) && canonical(Object.keys(value).sort()) === canonical([...keys].sort());

/**
 * The acceptance check. Deterministic: the recording is well-formed and whole,
 * its chain and the room's journal agree, every step evaluates again to exactly
 * the recorded events, and the player files are the room's own rendering.
 */
export function check(paths, { reperform = reperformInChild } = {}) {
  const results = [];
  const record = (id, passed, detail) => { results.push({ id, passed, detail }); return passed; };
  const finish = () => ({ passed: results.every((result) => result.passed), checks: results });

  let recording;
  try { recording = JSON.parse(readFileSync(paths.recording, "utf8")); }
  catch { record("well-formed", false, "recording.json is missing or is not JSON"); return finish(); }
  const header = roomHeader(paths);
  const shape = [];
  if (!sameKeys(recording, ["schemaVersion", "room", "genesis", "entries", "head", "complete"])) shape.push("top-level keys");
  else {
    if (recording.schemaVersion !== 1) shape.push("schemaVersion");
    if (!Array.isArray(recording.entries)) shape.push("entries");
    if (typeof recording.complete !== "boolean") shape.push("complete");
  }
  if (shape.length) { record("well-formed", false, `recording.json has the wrong ${shape.join(", ")}`); return finish(); }
  for (const [index, entry] of recording.entries.entries()) {
    const common = ["index", "kind", "step", "at", "prev", "code", "hash"];
    const keys = entry?.kind === "step" ? [...common, "cps", "cycles", "seconds", "events", "heard"] : entry?.kind === "refused" ? [...common, "error"] : null;
    if (!keys || !sameKeys(entry, keys)) { shape.push(`entry ${index}`); continue; }
    if (entry.index !== index || typeof entry.code !== "string" || typeof entry.at !== "string" || Number.isNaN(Date.parse(entry.at))) shape.push(`entry ${index}`);
    else if (entry.kind === "step" && !(Array.isArray(entry.events) && entry.events.every((event) => Array.isArray(event) && event.length === 3 && typeof event[0] === "number" && typeof event[1] === "number" && isObject(event[2])))) shape.push(`entry ${index} events`);
    else if (entry.kind === "refused" && typeof entry.error !== "string") shape.push(`entry ${index}`);
  }
  if (!record("well-formed", shape.length === 0, shape.length ? `malformed: ${shape.slice(0, 5).join(", ")}` : `${recording.entries.length} entries`)) return finish();

  record("this-room", canonical(recording.room) === canonical(header), canonical(recording.room) === canonical(header) ? `${header.id} v${header.version}, Strudel ${header.engine.strudel}` : "the recording names a different room or engine");

  // The chain: each entry is hashed over its own content and the hash before it.
  const broken = [];
  let head = sha256(canonical({ room: recording.room }));
  if (recording.genesis !== head) broken.push("genesis");
  for (const entry of recording.entries) {
    const { hash, ...content } = entry;
    if (entry.prev !== head || hash !== sha256(canonical(content))) { broken.push(`entry ${entry.index}`); break; }
    head = hash;
  }
  if (!broken.length && recording.head !== head) broken.push("head");
  record("chain", broken.length === 0, broken.length ? `the hash chain breaks at ${broken[0]}` : `head ${head.slice(0, 12)}`);

  const journal = readJournal(paths);
  const remembered = canonical(journal) === canonical(recording.entries.map((entry) => entry.hash));
  record("journal", remembered, remembered ? `${journal.length} entries, as the room remembers them` : "the recording is not what the room's journal remembers");

  const steps = recording.entries.filter((entry) => entry.kind === "step");
  const ordered = steps.every((entry, index) => entry.step === index + 1) && recording.entries.every((entry, index) => entry.step === recording.entries.slice(0, index).filter((earlier) => earlier.kind === "step").length + 1);
  const whole = ordered && steps.length === ROOM.steps && recording.complete === true;
  record("steps", whole, whole ? `${ROOM.steps} steps` : `${steps.length} of ${ROOM.steps} steps${ordered ? "" : ", out of order"}`);
  const stamps = recording.entries.map((entry) => Date.parse(entry.at));
  record("clock", stamps.every((stamp, index) => index === 0 || stamp >= stamps[index - 1]), "entries are in the order they were played");

  // Every step is evaluated again, in a process of its own as `play` ran it.
  const differing = [];
  let cps = ROOM.cps.initial;
  let seconds = 0;
  for (const entry of steps) {
    const again = reperform(paths, { code: entry.code, cps, step: entry.step, seconds });
    if (again.error) { differing.push(`step ${entry.step} does not evaluate (${again.error})`); break; }
    const differs = ["cps", "cycles", "seconds", "events", "heard"].find((key) => canonical(entry[key]) !== canonical(again[key]));
    if (differs) { differing.push(`step ${entry.step} ${differs} differs from what the code plays`); break; }
    cps = again.cps;
    seconds = again.seconds[1];
  }
  record("evaluates", differing.length === 0, differing.length ? differing[0] : `${steps.length} steps play exactly what was recorded`);

  let rendered = false;
  try { rendered = readFileSync(paths.player, "utf8") === renderPlayer(paths, recording) && readFileSync(paths.worklets).equals(readFileSync(path.join(paths.engine, "worklets.js"))); } catch { rendered = false; }
  record("player", rendered, rendered ? "index.html and worklets.js are the room's own" : "index.html or worklets.js is not the room's rendering of this recording");
  return finish();
}

function reperformInChild(paths, request) {
  const child = spawnSync(process.execPath, [path.join(paths.room, "room.mjs"), "reperform"], { input: JSON.stringify(request), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  if (child.status !== 0 || child.error) return { error: child.error?.code === "ETIMEDOUT" ? "timed out" : "the room could not evaluate it" };
  return JSON.parse(child.stdout);
}

const USAGE = `usage: node room/room.mjs play <pattern-file>   play the next step of the set
       node room/room.mjs status                the set so far
       node room/room.mjs heard [step]          print a played step's printout again
       node room/room.mjs check                 the acceptance check`;

async function main(argv) {
  const paths = roomPaths(import.meta.dirname);
  const [command, argument, ...rest] = argv;
  if (command === "play" && argument && rest.length === 0) {
    let code;
    try { code = readFileSync(argument, "utf8"); } catch { console.error(`cannot read ${argument}`); return 2; }
    const result = await play(paths, code);
    console.log(result.heard ? printout(result.heard) : JSON.stringify(result.refused, null, 1));
    return result.heard ? 0 : 1;
  }
  if (command === "status" && argument === undefined) { console.log(JSON.stringify(status(paths), null, 1)); return 0; }
  if (command === "heard" && rest.length === 0) {
    const steps = loadRecording(paths, roomHeader(paths)).entries.filter((entry) => entry.kind === "step");
    const entry = argument === undefined ? steps.at(-1) : steps.find((candidate) => String(candidate.step) === argument);
    if (!entry) { console.error(argument === undefined ? "no step has been played" : `step ${argument} has not been played`); return 2; }
    console.log(printout(entry.heard));
    return 0;
  }
  if (command === "check" && argument === undefined) {
    const result = check(paths);
    console.log(JSON.stringify(result, null, 1));
    return result.passed ? 0 : 1;
  }
  if (command === "reperform" && argument === undefined) {
    // Internal to `check`: evaluate one step from stdin exactly as `play` would.
    const request = JSON.parse(readFileSync(0, "utf8"));
    try { console.log(JSON.stringify(await takeStep(await loadEngine(paths), request))); }
    catch (error) {
      if (!(error instanceof Refusal)) throw error;
      console.log(JSON.stringify({ error: error.message }));
    }
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.log(JSON.stringify({ refused: true, error: error.message }, null, 1));
    process.exitCode = 1;
  }
}
