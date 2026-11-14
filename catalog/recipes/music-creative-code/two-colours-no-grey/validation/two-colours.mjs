#!/usr/bin/env node
// Two-colour check, run from the delivery root with fixtures mounted:
//   node validation/two-colours.mjs
// H.264 smears colours, so the exact two-colour rule is judged on the live
// player: Chromium (CHROME_PATH, the image's /usr/bin/chromium by default)
// opens player.html?capture on loopback at the film's size and device scale 1,
// seeks to sampled frames and screenshots them. Every sampled pixel must be
// one of the two colours declared in evidence.json, and both must appear.
// The film must then agree with the player: on a few of those frames, every
// block of the decoded MP4 must sit where the player's block sits on the line
// between the two colours, so the player cannot be a different film.
// Frames are chosen from the film's own hash: fixed per Dish, unknown before it.
// Chromium is driven over --remote-debugging-pipe, so the check needs nothing
// beyond Node, Chromium and FFmpeg, and runs offline.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

const HEX = /^#[0-9a-f]{6}$/u;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".wasm": "application/wasm", ".mp4": "video/mp4" };

/** One frame from each of `count` equal strata, its place inside the stratum drawn from the seed. */
export function sampleFrames(seed, frames, count) {
  const picked = [];
  for (let i = 0; i < Math.min(count, frames); i++) {
    const start = Math.floor((i * frames) / count), end = Math.floor(((i + 1) * frames) / count);
    const draw = createHash("sha256").update(seed).update(`:${i}`).digest().readUInt32BE(0);
    picked.push(start + (draw % Math.max(1, end - start)));
  }
  return picked;
}

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG (what Chromium's screenshots are) to RGBA. */
export function decodePng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "not a PNG");
  let offset = 8, width, height, depth, type, interlace;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), name = buffer.toString("latin1", offset + 4, offset + 8), data = buffer.subarray(offset + 8, offset + 8 + length);
    if (name === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === "IDAT") idat.push(data);
    else if (name === "IEND") break;
    offset += 12 + length;
  }
  assert(depth === 8 && (type === 2 || type === 6) && interlace === 0, `unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const channels = type === 6 ? 4 : 3, stride = width * channels, raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride), row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = (line[x] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      out[target] = row[x * channels]; out[target + 1] = row[x * channels + 1]; out[target + 2] = row[x * channels + 2]; out[target + 3] = channels === 4 ? row[x * channels + 3] : 255;
    }
    [previous, row] = [row, previous];
  }
  return { width, height, data: out };
}

const hexOf = (key) => `#${key.toString(16).padStart(6, "0")}`;
const keyOf = (hex) => Number.parseInt(hex.slice(1), 16);
const rgbOf = (key) => [(key >> 16) & 255, (key >> 8) & 255, key & 255];

/** Distinct opaque colours in an RGBA image, with counts and the first place each appears. */
export function colourCensus({ width, data }) {
  const census = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const entry = census.get(key);
    if (entry) entry.count++;
    else census.set(key, { count: 1, x: (i / 4) % width, y: Math.floor(i / 4 / width) });
  }
  return census;
}

/**
 * Block agreement between a player frame (RGBA, exactly the two colours) and a
 * decoded film frame (RGB24). Each pixel becomes its position on the line from
 * colour A (0) to colour B (1); block means survive H.264 and 4:2:0 chroma, so
 * a fine two-colour dither and its smeared encode still agree.
 */
export function blockAgreement(player, film, width, height, [a, b], block = 10) {
  const [ar, ag, ab] = rgbOf(a), [br, bg, bb] = rgbOf(b);
  const dr = br - ar, dg = bg - ag, db = bb - ab, norm = dr * dr + dg * dg + db * db;
  const along = (r, g, bl) => Math.min(1, Math.max(0, ((r - ar) * dr + (g - ag) * dg + (bl - ab) * db) / norm));
  let total = 0, far = 0, blocks = 0, worst = 0;
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      let sumPlayer = 0, sumFilm = 0, n = 0;
      for (let y = by; y < Math.min(height, by + block); y++) {
        for (let x = bx; x < Math.min(width, bx + block); x++) {
          const p = (y * width + x) * 4, f = (y * width + x) * 3;
          sumPlayer += along(player[p], player[p + 1], player[p + 2]);
          sumFilm += along(film[f], film[f + 1], film[f + 2]);
          n++;
        }
      }
      const difference = Math.abs(sumPlayer - sumFilm) / n;
      total += difference; blocks++; worst = Math.max(worst, difference);
      if (difference > 0.25) far++;
    }
  }
  return { meanDifference: total / blocks, farShare: far / blocks, worst };
}

/** Serve the delivery root on loopback, GET only, nothing outside it. */
function serve(root) {
  const server = createServer((request, response) => {
    const url = decodeURIComponent(request.url.split("?")[0]);
    const file = path.join(root, path.normalize(url));
    let info;
    try { info = statSync(file); } catch { info = null; }
    if (request.method !== "GET" || !file.startsWith(root + path.sep) || !info?.isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": info.size });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Chromium over --remote-debugging-pipe: requests on fd 3, replies on fd 4, NUL-separated JSON. */
function launch(chrome, profile) {
  const child = spawn(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--force-color-profile=srgb", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-extensions", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
    `--user-data-dir=${profile}`, "--remote-debugging-pipe", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let stderr = "", buffered = "", nextId = 0;
  const pending = new Map(), listeners = new Set();
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  child.stdio[4].on("data", (chunk) => {
    buffered += chunk;
    let end;
    while ((end = buffered.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} ${message.error.data ?? ""}`.trim()));
        else resolve(message.result);
      } else for (const listener of listeners) listener(message);
    }
  });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  exited.then(() => { for (const { reject } of pending.values()) reject(new Error(`Chromium exited: ${stderr.trim().split("\n").slice(-3).join(" | ")}`)); pending.clear(); });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
  const waitFor = (predicate, label, ms = 30000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`timed out waiting for ${label}`)); }, ms);
    const listener = (message) => { if (predicate(message)) { clearTimeout(timer); listeners.delete(listener); resolve(message); } };
    listeners.add(listener);
  });
  return { send, waitFor, listeners, close: async () => { child.kill("SIGKILL"); await exited; } };
}

const withTimeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} took longer than ${ms / 1000} s`)), ms).unref())]);

/** Screenshot the player at each frame; returns decoded RGBA frames keyed by frame number. */
async function capturePlayer({ root, chrome, width, height, fps, frames }) {
  const server = await serve(root);
  const profile = mkdtempSync(path.join(tmpdir(), "two-colours-"));
  const browser = launch(chrome, profile);
  const problems = [];
  try {
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => browser.send(method, params, sessionId);
    browser.listeners.add((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown") problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.waitFor((message) => message.sessionId === sessionId && message.method === "Page.loadEventFired", "player.html to load");
    const navigated = await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/player.html?capture` });
    assert(!navigated.errorText, `player.html did not load: ${navigated.errorText}`);
    await loaded;
    const evaluate = async (expression, label) => {
      const { result, exceptionDetails } = await withTimeout(send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), 30000, label);
      assert(!exceptionDetails, `${label} threw: ${exceptionDetails?.exception?.description ?? exceptionDetails?.text}`);
      return result.value;
    };
    const shape = await evaluate("(async () => { const ready = window.ready; const thenable = !!ready && typeof ready.then === 'function'; if (thenable) await ready; return { thenable, seek: typeof window.seek, scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] }; })()", "window.ready");
    assert(shape.thenable, "player.html must expose window.ready, a promise that resolves when it can draw");
    assert.equal(shape.seek, "function", "player.html must expose window.seek(t)");
    const captured = new Map();
    for (const frame of frames) {
      await evaluate(`(async () => { await window.seek(${frame / fps}); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()`, `seek to frame ${frame}`);
      const { data } = await withTimeout(send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } }), 30000, `screenshot of frame ${frame}`);
      const image = decodePng(Buffer.from(data, "base64"));
      assert(image.width === width && image.height === height, `screenshot of frame ${frame} is ${image.width}x${image.height}, not ${width}x${height}`);
      captured.set(frame, image);
    }
    assert.equal(problems.length, 0, `player.html threw: ${problems.slice(0, 3).join(" | ")}`);
    return captured;
  } finally {
    await browser.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

/** Decode the given film frames as RGB24, in frame order. */
function filmFrames(file, frames, width, height) {
  const select = frames.map((frame) => `eq(n\\,${frame})`).join("+");
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select='${select}'`, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: frames.length * width * height * 3 + 1024, timeout: 120000 });
  assert.equal(result.status, 0, `film frame decode: ${String(result.stderr).trim().slice(0, 400)}`);
  const size = width * height * 3;
  assert.equal(result.stdout.length, size * frames.length, `film.mp4 gave ${result.stdout.length / size} of ${frames.length} requested frames`);
  return new Map(frames.map((frame, i) => [frame, result.stdout.subarray(i * size, (i + 1) * size)]));
}

export async function checkTwoColours({ root = process.cwd(), chrome = process.env.CHROME_PATH ?? "/usr/bin/chromium" } = {}) {
  const contract = JSON.parse(readFileSync(path.join(root, "fixtures/contract.json"), "utf8"));
  const rule = contract.twoColours;
  const { width, height, fps } = contract;
  const evidence = JSON.parse(readFileSync(path.join(root, "evidence.json"), "utf8"));
  assert(Array.isArray(evidence.colours) && evidence.colours.length === 2 && evidence.colours.every((hex) => typeof hex === "string" && HEX.test(hex.toLowerCase())), "evidence.colours must name the two colours as [\"#rrggbb\", \"#rrggbb\"]");
  const declared = evidence.colours.map((hex) => keyOf(hex.toLowerCase()));
  assert.notEqual(declared[0], declared[1], "the two declared colours are the same colour");
  const [a, b] = declared.map(rgbOf), distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert(distance >= rule.minDistance, `the two colours are ${distance.toFixed(1)} apart in RGB; they must be at least ${rule.minDistance} apart`);

  const film = path.join(root, "film.mp4");
  const seed = createHash("sha256").update(readFileSync(film)).digest();
  const sampled = sampleFrames(seed, contract.frames, rule.samples);
  const captured = await capturePlayer({ root, chrome, width, height, fps, frames: sampled });
  const seen = new Set();
  for (const [frame, image] of captured) {
    for (const [key, { count, x, y }] of colourCensus(image)) {
      assert(declared.includes(key), `frame ${frame} (${(frame / fps).toFixed(3)} s) has ${count} pixel(s) of ${hexOf(key)}, first at (${x}, ${y}); only ${evidence.colours.join(" and ")} may appear`);
      seen.add(key);
    }
  }
  assert.equal(seen.size, 2, `only ${[...seen].map(hexOf).join(", ")} appeared in ${sampled.length} sampled frames; both declared colours must appear`);

  const agreementFrames = Array.from({ length: Math.min(rule.agreementFrames, sampled.length) }, (_, i) => sampled[Math.floor(((i + 0.5) * sampled.length) / rule.agreementFrames)]);
  const decoded = filmFrames(film, agreementFrames, width, height);
  const agreement = [];
  for (const frame of agreementFrames) {
    const measured = blockAgreement(captured.get(frame).data, decoded.get(frame), width, height, declared, rule.block);
    agreement.push({ frame, ...measured });
    assert(measured.meanDifference <= rule.maxMeanDifference && measured.farShare <= rule.maxFarShare,
      `film.mp4 frame ${frame} (${(frame / fps).toFixed(3)} s) does not match player.html: mean block difference ${measured.meanDifference.toFixed(3)} (limit ${rule.maxMeanDifference}), ${(100 * measured.farShare).toFixed(1)}% of blocks far apart (limit ${100 * rule.maxFarShare}%)`);
  }
  return { colours: evidence.colours, sampled, agreement };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const watchdog = setTimeout(() => { console.error("two-colours check took longer than 15 minutes"); process.exit(1); }, 15 * 60 * 1000);
  try {
    const result = await checkTwoColours();
    const worst = Math.max(...result.agreement.map((entry) => entry.meanDifference));
    console.log(`PASS: ${result.sampled.length} player frames hold exactly ${result.colours.join(" and ")}; ${result.agreement.length} film frames agree with the player (worst mean block difference ${worst.toFixed(3)}). Unsampled frames, depth, light, texture and motion are left to tasting.`);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
  }
}
