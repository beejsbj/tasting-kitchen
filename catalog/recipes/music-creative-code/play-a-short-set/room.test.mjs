import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanPublicTree, scanWebArtifactNetwork } from "../../../../lib/taste/files.mjs";
import { canonical, ROOM } from "./room/room.mjs";
import { mountRoom, playPattern, playSample, recipeDirectory, room, sampleSteps } from "./stage.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function stage(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "music-room-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mountRoom(directory);
  return directory;
}
const recordingOf = async (directory) => JSON.parse(await readFile(path.join(directory, "recording.json"), "utf8"));
const failed = (checked) => checked.json.checks.filter((check) => !check.passed).map((check) => check.id);

// Rewrite a recording the way a careful forger would: every hash and the journal made consistent again.
async function reseal(directory, recording) {
  let head = sha256(canonical({ room: recording.room }));
  recording.genesis = head;
  for (const entry of recording.entries) {
    entry.prev = head;
    delete entry.hash;
    entry.hash = sha256(canonical(entry));
    head = entry.hash;
  }
  recording.head = head;
  await writeFile(path.join(directory, "recording.json"), `${JSON.stringify(recording)}\n`);
  await writeFile(path.join(directory, ".room/journal"), recording.entries.map((entry) => `${entry.hash}\n`).join(""));
}

test("the Recipe mounts the whole room and gates on the room's own check", async () => {
  const recipe = JSON.parse(await readFile(path.join(recipeDirectory, "recipe.json"), "utf8"));
  assert.equal(recipe.status, "draft", "the benchmark shape awaits the owner's acceptance");
  const mounted = new Map(recipe.setup.fixtures.map((fixture) => [fixture.path, fixture]));
  for (const file of await readdir(path.join(recipeDirectory, "room"))) assert.ok(mounted.has(`room/${file}`), `room/${file} is mounted`);
  for (const file of await readdir(path.join(recipeDirectory, "fixtures/upstream/strudel"))) assert.ok(mounted.has(`fixtures/upstream/strudel/${file}`), `strudel/${file} is mounted`);
  // Everything the room is made of is supplied read-only: an edit breaks the output contract.
  for (const fixture of recipe.setup.fixtures) assert.equal(fixture.editable, false, fixture.id);
  assert.deepEqual(recipe.validation.checks.find((check) => check.id === "room-recording").argv, ["node", "room/room.mjs", "check"]);
  assert.deepEqual(recipe.output.include, ["index.html", "recording.json", "worklets.js"]);
});

test("the vendored engine is the bytes its manifest pins, with its licence beside it", async () => {
  const upstream = path.join(recipeDirectory, "fixtures/upstream/strudel");
  const manifest = JSON.parse(await readFile(path.join(upstream, "manifest.json"), "utf8"));
  for (const [name, pinned] of Object.entries(manifest.outputs)) {
    const bytes = await readFile(path.join(upstream, name));
    assert.equal(sha256(bytes), pinned.sha256, `${name} moved: run node scripts/vendor-music-room.mjs`);
    assert.equal(bytes.length, pinned.bytes);
  }
  assert.deepEqual(Object.keys(manifest.outputs).sort(), ["strudel.mjs", "superdough.js", "worklets.js"]);
  assert.equal(manifest.license, "AGPL-3.0-or-later");
  assert.match(await readFile(path.join(upstream, "LICENSE"), "utf8"), /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/u);
  for (const item of manifest.packages) {
    assert.match(item.sha512, /^[a-f0-9]{128}$/u, `${item.name} is pinned by sha512`);
    assert.ok(item.license, `${item.name} names a licence`);
  }
  const notices = await readFile(path.join(upstream, "THIRD-PARTY-NOTICES.md"), "utf8");
  for (const item of manifest.packages.filter((candidate) => candidate.bundled)) assert.ok(notices.includes(`${item.name} ${item.version}`), `${item.name} has its notice`);
  const pinned = (name) => manifest.packages.find((item) => item.path === `node_modules/${name}`).version;
  assert.deepEqual([pinned("@strudel/core"), pinned("@strudel/mini"), pinned("@strudel/tonal"), pinned("@strudel/transpiler"), pinned("superdough")], ["1.2.6", "1.2.6", "1.2.6", "1.2.6", "1.3.0"]);
});

test("playing a step prints what sounded as numbers and records exactly that", async (t) => {
  const directory = await stage(t);
  const played = await playPattern(directory, "01", 'note("c3 e3").s("sine").gain(0.5)\n');
  assert.equal(played.status, 0, played.stderr);
  const heard = played.json;
  assert.deepEqual({ step: heard.step, steps: heard.steps, remaining: heard.remaining, cycles: heard.cycles, cps: heard.cps, seconds: heard.seconds }, { step: 1, steps: 12, remaining: 11, cycles: [0, 8], cps: 0.5, seconds: [0, 16] });
  assert.equal(heard.events, 16);
  assert.deepEqual(heard.perCycle, [2, 2, 2, 2, 2, 2, 2, 2]);
  assert.equal(heard.perSecond, 1);
  assert.deepEqual(heard.pitch, { low: 48, high: 52, mean: 50, classes: [0, 4] });
  assert.deepEqual(heard.lengths, [0.5, 0.5]);
  assert.deepEqual(heard.controls, { gain: [0.5, 0.5] });
  assert.deepEqual(heard.bars[0], { cycle: 0, voices: [{ s: "sine", onsets: [0, 0.5], notes: [48, 52] }] });
  assert.deepEqual(heard.bars[1], { cycle: 1, sameAs: 0 });
  // The printout is numbers only: no word of advice or judgement in it.
  assert.doesNotMatch(played.stdout, /good|better|try|should|consider|great|nice/iu);

  const recording = await recordingOf(directory);
  const [entry] = recording.entries;
  assert.deepEqual(entry.heard, heard, "the recording keeps the printout the model was given");
  assert.equal(entry.code, 'note("c3 e3").s("sine").gain(0.5)\n');
  assert.deepEqual(entry.events[1], [0.5, 1, { note: "e3", s: "sine", gain: 0.5 }]);
  assert.equal(recording.head, entry.hash);
  assert.equal(recording.complete, false);
  assert.deepEqual(room(directory, "heard").json, heard);
  assert.deepEqual(room(directory, "status").json, { steps: 12, played: 1, remaining: 11, next: { step: 2, cycles: [8, 16] }, cps: 0.5, seconds: 16, refused: 0, complete: false });
});

test("the crib in the room's README is true of the engine that is mounted", async (t) => {
  const directory = await stage(t);
  const readme = await readFile(path.join(recipeDirectory, "room/README.md"), "utf8");
  // The example plays as written.
  const example = readme.match(/```js\n([\s\S]*?)```/u)[1];
  const played = await playPattern(directory, "01", example);
  assert.equal(played.status, 0, played.stdout);
  assert.deepEqual(played.json.bars[0].voices.map((voice) => voice.s), ["sawtooth", "sbd", "triangle", "white"]);
  assert.equal(played.json.cps, 0.5);
  // Every function and signal it names exists, as a global or as a pattern method.
  const names = readme.match(/Pattern functions include (.*?)\. The engine/u)[1].match(/`[a-zA-Z]+`/gu).map((name) => name.slice(1, -1));
  assert.ok(names.length > 30);
  const probe = `for (const name of ${JSON.stringify(names).replaceAll('"', "'")}) if (globalThis[name] === undefined && typeof silence[name] !== 'function') throw new Error('missing ' + name);\nsilence\n`;
  const probed = await playPattern(directory, "02", probe);
  assert.equal(probed.status, 0, probed.stdout);
  // Each piece of mini-notation it lists parses and sounds.
  const mini = await playPattern(directory, "03", 'note("[c3 e3] <g3 a3> c4*2 d4/2 ~ [e3,g3] f3(3,8) g3? a3@3 b3!3").s("sine")\n');
  assert.equal(mini.status, 0, mini.stdout);
  // The sounds it lists are the room's sounds.
  for (const sound of ROOM.sounds) assert.ok(readme.includes(`\`${sound}\``), `${sound} is listed`);
});

test("unpitched sounds are heard without a pitch, and an oscillator with no note at superdough's default", async (t) => {
  const directory = await stage(t);
  const heard = (await playPattern(directory, "01", 'stack(s("sbd*2"), s("white*4").decay(0.05), s("sawtooth"))\n')).json;
  assert.deepEqual(heard.bars[0].voices, [{ s: "sbd", onsets: [0, 0.5] }, { s: "white", onsets: [0, 0.25, 0.5, 0.75] }, { s: "sawtooth", onsets: [0], notes: [36] }]);
  assert.deepEqual(heard.pitch, { low: 36, high: 36, mean: 36, classes: [0] });
});

test("cycle time and tempo run on across steps, as in a live session", async (t) => {
  const directory = await stage(t);
  const first = (await playPattern(directory, "01", 'setcps(1)\nnote("<c3 e3 g3>").s("triangle")\n')).json;
  assert.deepEqual([first.cps, first.seconds], [1, [0, 8]]);
  // Step 2 sets no tempo and keeps the one it inherited; cycle 8 is the third of every three.
  const second = (await playPattern(directory, "02", 'note("<c3 e3 g3>").s("triangle")\n')).json;
  assert.deepEqual([second.cps, second.cycles, second.seconds], [1, [8, 16], [8, 16]]);
  assert.deepEqual(second.bars.slice(0, 3).map((bar) => bar.voices[0].notes), [[55], [48], [52]]);
  const third = (await playPattern(directory, "03", "setcpm(15)\nsilence\n")).json;
  assert.deepEqual([third.cps, third.seconds, third.events, third.pitch], [0.25, [16, 48], 0, null]);
});

test("a pattern the room cannot play is refused, recorded, and uses no step", async (t) => {
  const directory = await stage(t);
  const refusals = [
    ['note("c e g".fast(2)\n', /Unexpected token/u],
    ['s("bd hh")\n', /sound "bd" is not in this room/u],
    ['note("c3").s("sine").bank("tr909")\n', /sound "tr909_sine" is not in this room/u],
    ['"c e g"\n', /expected hap\.value to be an object/u],
    ['note("h3").s("sine")\n', /not a note: "h3"/u],
    ['setcps(3)\ns("sine")\n', /cps 3 is outside this room's 0\.25 to 1/u],
    ['s("sine*512")\n', /more than 2048 events in one step/u],
    [`// ${"x".repeat(ROOM.maxCodeBytes)}\ns("sine")\n`, /this room takes at most 8192/u],
  ];
  for (const [index, [code, reason]] of refusals.entries()) {
    const played = await playPattern(directory, `bad-${index}`, code);
    assert.equal(played.status, 1, code);
    assert.equal(played.json.refused, true);
    assert.match(played.json.error, reason);
    assert.deepEqual([played.json.step, played.json.remaining], [1, 12]);
  }
  const recording = await recordingOf(directory);
  assert.deepEqual(recording.entries.map((entry) => entry.kind), refusals.map(() => "refused"));
  assert.equal(recording.entries[0].code, refusals[0][0], "the refused code is kept");
  assert.ok(Buffer.byteLength(recording.entries.at(-1).code) <= ROOM.maxCodeBytes, "oversized code is kept only up to the limit");
  assert.equal((await playPattern(directory, "01", 's("sine")\n')).json.step, 1, "the first accepted pattern is still step 1");
  assert.equal(room(directory, "status").json.refused, refusals.length);
  // A missing file is a usage error, not a play: nothing is recorded.
  assert.equal(room(directory, "play", "patterns/none.js").status, 2);
  assert.equal((await recordingOf(directory)).entries.length, refusals.length + 1);
});

test("a whole sample set passes the room's check, and the room then takes no more", async (t) => {
  const directory = await stage(t);
  const printouts = await playSample(directory, "tide");
  assert.equal(printouts.length, ROOM.steps);
  const recording = await recordingOf(directory);
  assert.equal(recording.complete, true);
  const steps = recording.entries.filter((entry) => entry.kind === "step");
  assert.deepEqual(steps.map((entry) => entry.cycles), Array.from({ length: 12 }, (_, index) => [index * 8, index * 8 + 8]));
  for (const [index, entry] of steps.entries()) assert.equal(entry.seconds[0], index === 0 ? 0 : steps[index - 1].seconds[1], "steps follow one another without a gap");
  assert.deepEqual([steps[0].cps, steps[11].cps], [0.4, 1 / 3], "the set changes tempo where its code says so");

  const checked = room(directory, "check");
  assert.equal(checked.status, 0, checked.stdout);
  assert.deepEqual(checked.json.checks.map((check) => check.id), ["well-formed", "this-room", "chain", "journal", "steps", "clock", "evaluates", "player"]);
  assert.equal(checked.json.passed, true);

  const more = await playPattern(directory, "13", 's("sine")\n');
  assert.equal(more.status, 1);
  assert.match(more.json.error, /the set is complete: all 12 steps are played/u);
  assert.equal((await recordingOf(directory)).entries.length, 12, "nothing is recorded after the set ends");
  assert.equal(room(directory, "status").json.next, null);

  // What the room leaves is what a Dish publishes: it passes Kitchen's own publication scans.
  const artifact = await mkdtemp(path.join(os.tmpdir(), "music-room-artifact-"));
  t.after(() => rm(artifact, { recursive: true, force: true }));
  for (const file of ["index.html", "recording.json", "worklets.js"]) await writeFile(path.join(artifact, file), await readFile(path.join(directory, file)));
  assert.equal((await scanPublicTree(artifact)).passed, true);
  assert.equal((await scanWebArtifactNetwork(artifact)).passed, true);
  const page = await readFile(path.join(artifact, "index.html"), "utf8");
  assert.doesNotMatch(page, /\beval\(|new Function\(/u, "the page needs no eval, which the Dish content policy refuses");
});

test("patterns that use chance play the same when the check evaluates them again", async (t) => {
  const directory = await stage(t);
  const chance = 'note("c3*8").s("sine").degradeBy(0.5).gain(rand.range(0.2, 0.8)).pan(Math.random())\n';
  const first = (await playPattern(directory, "01", chance)).json;
  const second = (await playPattern(directory, "02", chance)).json;
  assert.ok(first.events > 0 && first.events < 64, "chance removed some events");
  assert.notDeepEqual(first.perCycle, second.perCycle, "the same code sounds different in later cycles");
  assert.deepEqual(failed(room(directory, "check")), ["steps"], "only the unfinished set fails; both steps evaluate to what was recorded");
});

test("a played step cannot be taken back: the room remembers every play", async (t) => {
  const directory = await stage(t);
  await playPattern(directory, "01", 's("sine")\n');
  await playPattern(directory, "02", 's("triangle")\n');
  const original = await readFile(path.join(directory, "recording.json"));

  // Starting over by deleting the recording.
  await rm(path.join(directory, "recording.json"));
  const restarted = await playPattern(directory, "01-again", 's("square")\n');
  assert.equal(restarted.status, 1);
  assert.match(restarted.json.error, /recording\.json is missing, but this room has already been played/u);
  assert.deepEqual(failed(room(directory, "check")), ["well-formed"]);

  // Dropping the last step from the recording.
  const shortened = JSON.parse(original);
  shortened.entries.pop();
  shortened.head = shortened.entries[0].hash;
  await writeFile(path.join(directory, "recording.json"), `${JSON.stringify(shortened)}\n`);
  assert.match((await playPattern(directory, "02-again", 's("square")\n')).json.error, /recording\.json is not the room's recording/u);
  assert.ok(failed(room(directory, "check")).includes("journal"));

  await writeFile(path.join(directory, "recording.json"), original);
  assert.equal((await playPattern(directory, "03", 's("square")\n')).json.step, 3, "the untouched recording plays on");
});

test("the check tells a recording the room made from one that was written or edited by hand", async (t) => {
  const directory = await stage(t);
  await playSample(directory, "night-bus");
  assert.equal(room(directory, "check").status, 0);
  const pristine = { recording: await readFile(path.join(directory, "recording.json")), journal: await readFile(path.join(directory, ".room/journal")), page: await readFile(path.join(directory, "index.html")) };
  const restore = async () => { await writeFile(path.join(directory, "recording.json"), pristine.recording); await writeFile(path.join(directory, ".room/journal"), pristine.journal); await writeFile(path.join(directory, "index.html"), pristine.page); };

  // An edited step, hashes left as they were.
  const edited = JSON.parse(pristine.recording);
  edited.entries[3].code = 's("sine")\n';
  await writeFile(path.join(directory, "recording.json"), `${JSON.stringify(edited)}\n`);
  assert.deepEqual(failed(room(directory, "check")).slice(0, 1), ["chain"]);

  // The same edit with every hash and the journal recomputed: the code no longer plays the recorded events.
  await reseal(directory, edited);
  const forged = room(directory, "check");
  assert.equal(forged.status, 1);
  assert.ok(failed(forged).includes("evaluates"));
  assert.match(forged.json.checks.find((check) => check.id === "evaluates").detail, /step 4 events differs from what the code plays/u);

  // Events edited to flatter the set, resealed: they are not what the code plays.
  const louder = JSON.parse(pristine.recording);
  louder.entries[0].events[0][2].gain = 1;
  await reseal(directory, louder);
  assert.ok(failed(room(directory, "check")).includes("evaluates"));

  // A recording that claims other rules.
  const otherRoom = JSON.parse(pristine.recording);
  otherRoom.room.steps = 2;
  await reseal(directory, otherRoom);
  assert.ok(failed(room(directory, "check")).includes("this-room"));

  // A journal with a play the recording does not show.
  await restore();
  await appendFile(path.join(directory, ".room/journal"), `${"0".repeat(64)}\n`);
  assert.deepEqual(failed(room(directory, "check")), ["journal"]);

  // A player page that is not the room's rendering of this recording.
  await restore();
  await writeFile(path.join(directory, "index.html"), pristine.page.toString("utf8").replace("A set in the music room", "A better set"));
  assert.deepEqual(failed(room(directory, "check")), ["player"]);

  // Not a recording at all.
  await restore();
  await writeFile(path.join(directory, "recording.json"), '{"schemaVersion":1,"entries":[]}\n');
  assert.deepEqual(failed(room(directory, "check")), ["well-formed"]);

  await restore();
  assert.equal(room(directory, "check").status, 0, "the room's own files pass again");
});

test("an unfinished set does not pass", async (t) => {
  const directory = await stage(t);
  for (const [index, code] of (await sampleSteps("tide")).slice(0, 5).entries()) await playPattern(directory, `0${index + 1}`, code);
  const checked = room(directory, "check");
  assert.equal(checked.status, 1);
  assert.deepEqual(failed(checked), ["steps"]);
  assert.equal(checked.json.checks.find((check) => check.id === "steps").detail, "5 of 12 steps");
});
