#!/usr/bin/env node
// Prove in a real browser that a music room Dish plays inside the gallery's sandboxed
// iframe with no network: play the hand-written sample sets through the room, serve the
// result as /dishes/ is served in production, and measure the sound the player makes.
// usage: node scripts/verify-music-room-browser.mjs [--chrome] [--screenshots DIR]
//        node scripts/verify-music-room-browser.mjs --full NAME   also play one sample set from start to finish, in real time
//        node scripts/verify-music-room-browser.mjs --serve       keep serving, to listen by hand
// CHROME_PATH names a browser binary; --chrome uses the installed Google Chrome.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { ROOM } from "../catalog/recipes/music-creative-code/play-a-short-set/room/room.mjs";
import { mountRoom, playSample, room } from "../catalog/recipes/music-creative-code/play-a-short-set/stage.mjs";

const root = path.resolve(import.meta.dirname, "..");
const flags = process.argv.slice(2);
const flagValue = (name) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
const SAMPLES = ["tide", "night-bus"];
const ARTIFACT = ["index.html", "recording.json", "worklets.js"];

// The sandbox the gallery gives a web Dish, read from the component that renders it.
const pane = await readFile(path.join(root, "src/components/ArtifactPane.tsx"), "utf8");
const sandbox = pane.match(/<iframe src=\{artifactUrl\(dish\)\}[^>]*\bsandbox="([^"]*)"/u)?.[1];
assert.equal(sandbox, "allow-scripts allow-forms", "ArtifactPane's iframe sandbox changed; this check must follow it");
// The headers every host puts on /dishes/, read from the deployment config.
const vercel = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
const dishHeaders = vercel.headers.find((rule) => rule.source === "/dishes/:path*").headers;

const site = await mkdtemp(path.join(os.tmpdir(), "music-room-browser-"));
const recordings = {};
for (const name of SAMPLES) {
  const stage = path.join(site, "stages", name);
  await mkdir(stage, { recursive: true });
  await mountRoom(stage);
  await playSample(stage, name);
  const checked = room(stage, "check");
  assert.equal(checked.status, 0, `the room's own check passes for ${name}: ${checked.stdout}`);
  const artifact = path.join(site, "dishes", name, "artifact");
  await mkdir(artifact, { recursive: true });
  for (const file of ARTIFACT) await cp(path.join(stage, file), path.join(artifact, file));
  recordings[name] = JSON.parse(await readFile(path.join(stage, "recording.json"), "utf8"));
  // The gallery page stands in as a plain host with exactly its iframe.
  await writeFile(path.join(site, `${name}.html`), `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{margin:0}iframe{display:block;width:100vw;height:100vh;border:0}</style><iframe id="dish" title="${name}" src="dishes/${name}/artifact/index.html" sandbox="${sandbox}"></iframe>\n`);
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };
function serve({ hostingHeaders }) {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    server.served.push(pathname);
    try {
      const body = await readFile(path.join(site, path.normalize(pathname)));
      response.setHeader("content-type", TYPES[path.extname(pathname)] ?? "application/octet-stream");
      if (hostingHeaders && pathname.startsWith("/dishes/")) for (const { key, value } of dishHeaders) response.setHeader(key, value);
      response.end(body);
    } catch { response.statusCode = 404; response.end("not found"); }
  });
  server.served = [];
  return new Promise((resolve) => { server.listen(0, "127.0.0.1", () => resolve(server)); });
}

if (flags.includes("--serve")) {
  const server = await serve({ hostingHeaders: true });
  console.log(`Serving the sample sets inside the gallery's sandbox (${sandbox}) with the /dishes/ headers:`);
  for (const name of SAMPLES) console.log(`  http://127.0.0.1:${server.address().port}/${name}.html`);
  console.log("Ctrl-C to stop.");
  await new Promise(() => {});
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const report = { browser: null, sandbox, runs: [] };
const browser = await chromium.launch({
  headless: true,
  // Only this machine resolves: a reference to any other host cannot be fetched, whatever asks for it.
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
  ...(flags.includes("--chrome") ? { channel: "chrome" } : {}),
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
report.browser = `${flags.includes("--chrome") ? "Google Chrome" : "Chromium"} ${browser.version()}`;

async function listen(name, { hostingHeaders, whole = false }) {
  const server = await serve({ hostingHeaders });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const requests = [];
  const problems = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  try {
    await page.goto(`${origin}/${name}.html`, { waitUntil: "load" });
    assert.equal(await page.locator("#dish").getAttribute("sandbox"), sandbox);
    const frame = page.frames().find((candidate) => candidate.url().includes(`/dishes/${name}/`));
    assert.ok(frame, "the Dish frame loaded");
    // No allow-same-origin: the document's origin is opaque, as it is in the gallery.
    assert.equal(await frame.evaluate(() => self.origin), "null");
    const recording = recordings[name];
    const steps = recording.entries.filter((entry) => entry.kind === "step");
    assert.equal((await frame.evaluate(() => window.roomPlayer.state())).steps, steps.length);

    await frame.locator("#play").click();
    await frame.waitForFunction(() => window.roomPlayer.state().context === "running" && window.roomPlayer.state().scheduled > 0, null, { timeout: 15000 });
    if (whole) {
      // The whole set in real time: every event is scheduled once, and the player stops itself at the end.
      const length = steps.at(-1).seconds[1];
      await frame.waitForFunction(() => { const state = window.roomPlayer.state(); return !state.playing && state.position >= state.total; }, null, { timeout: (length + 30) * 1000, polling: 500 });
      const state = await frame.evaluate(() => window.roomPlayer.state());
      return { name, whole: true, seconds: length, events: state.events, worklets: state.worklets, scheduled: state.scheduled, sounded: state.sounded, failures: state.failures, problems, served: [...new Set(server.served)].sort() };
    }
    const heard = [];
    for (const step of steps) {
      // Jump to each step as a listener would, and measure what comes out for a moment.
      await frame.locator(`#steps button[data-index="${step.step - 1}"]`).click();
      let peak = 0;
      for (let sample = 0; sample < 14; sample += 1) { await sleep(90); peak = Math.max(peak, (await frame.evaluate(() => window.roomPlayer.state())).level); }
      const state = await frame.evaluate(() => window.roomPlayer.state());
      const shown = await frame.locator("#pane").innerText();
      assert.equal(state.step, step.step, `step ${step.step} is shown while it plays`);
      assert.ok(shown.includes(step.code.trim().split("\n")[0]), `step ${step.step} shows its own code`);
      const sounding = step.events.some(([begin]) => (begin - step.cycles[0]) / step.cps < 0.9);
      heard.push({ step: step.step, peak: Number(peak.toFixed(4)), sounding });
    }
    const state = await frame.evaluate(() => window.roomPlayer.state());
    await frame.locator("#play").click();
    await sleep(250);
    const paused = await frame.evaluate(() => window.roomPlayer.state());
    if (flagValue("--screenshots")) { await mkdir(flagValue("--screenshots"), { recursive: true }); await page.screenshot({ path: path.join(flagValue("--screenshots"), `${name}${hostingHeaders ? "" : "-bare"}.png`) }); }
    return { name, hostingHeaders, worklets: state.worklets, context: state.context, scheduled: state.scheduled, sounded: state.sounded, failures: state.failures, heard, paused: paused.playing === false && paused.context === "suspended", requests, served: [...new Set(server.served)].sort(), problems, origin };
  } finally {
    await page.close();
    server.close();
  }
}

try {
  for (const name of SAMPLES) {
    const run = await listen(name, { hostingHeaders: true });
    report.runs.push({ ...run, requests: run.requests.length });
    assert.deepEqual(run.problems, [], `${name}: no page or console errors`);
    assert.ok(run.requests.every((url) => url.startsWith(`${run.origin}/`)), `${name}: every request stays on the page's own host`);
    assert.deepEqual(run.served, [`/${name}.html`, `/dishes/${name}/artifact/index.html`, `/dishes/${name}/artifact/worklets.js`].sort(), `${name}: the page loads itself and its worklets, nothing else`);
    assert.equal(run.worklets, true, `${name}: AudioWorklet processors loaded inside the sandbox`);
    assert.deepEqual(run.failures, [], `${name}: every scheduled event could sound`);
    for (const step of run.heard) if (step.sounding) assert.ok(step.peak > 0.002, `${name} step ${step.step} makes sound (peak ${step.peak})`);
    assert.ok(run.paused, `${name}: pause suspends the audio clock`);
  }
  // Between them the sample sets put every sound of the room through the synth.
  const canonicalName = { sin: "sine", tri: "triangle", sqr: "square", saw: "sawtooth" };
  const sounded = new Set(report.runs.flatMap((run) => run.sounded));
  assert.deepEqual([...sounded].sort(), [...new Set(ROOM.sounds.map((sound) => canonicalName[sound] ?? sound))].sort(), "every sound of the room was scheduled, and none failed");
  if (flagValue("--full")) {
    const full = await listen(flagValue("--full"), { hostingHeaders: true, whole: true });
    report.runs.push(full);
    assert.deepEqual(full.problems, [], "the whole set plays without page or console errors");
    assert.deepEqual(full.failures, [], "every event of the whole set could sound");
    assert.equal(full.scheduled, full.events, "every event of the set was scheduled exactly once");
  }
  // Without the /dishes/ headers the sandboxed page cannot fetch worklets.js (no CORS for an opaque origin).
  // Recorded, not required: it shows what a host that forgets the headers would get.
  const bare = await listen("tide", { hostingHeaders: false });
  report.runs.push({ ...bare, requests: bare.requests.length, problems: bare.problems.length, failures: bare.failures.length });
  console.log(JSON.stringify(report, null, 1));
  console.log("Music room browser check passed.");
} finally {
  await browser.close();
  await rm(site, { recursive: true, force: true });
}
