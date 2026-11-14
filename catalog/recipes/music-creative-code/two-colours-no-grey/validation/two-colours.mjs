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
// between the two colours (one frame either side is allowed), so the player
// cannot be a different film. Frames are chosen from the hash of the film,
// player and evidence: fixed per Dish, unknown until all three are final.
// Chromium is driven over --remote-debugging-pipe, so the check needs nothing
// beyond Node, Chromium and FFmpeg, and runs offline. A failure of that
// equipment exits 75 so Kitchen records a validator error, not a chef fault.
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
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".mp4": "video/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8" };

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

/**
 * Kitchen's own equipment failed (the browser, the pipe to it, the decoder, or a wait
 * that a busy host could also explain). That says nothing about the delivery, so the
 * check exits EQUIPMENT_FAILURE and Kitchen records a validator error, never a chef fault.
 */
export const EQUIPMENT_FAILURE = 75;
export class EquipmentError extends Error {}

/** Serve the delivery root on loopback, GET only, nothing outside it. */
function serve(root) {
  const server = createServer((request, response) => {
    let file = null, info = null;
    try {
      file = path.join(root, path.normalize(decodeURIComponent(request.url.split("?")[0])));
      info = statSync(file);
    } catch { info = null; }
    if (request.method !== "GET" || !file?.startsWith(root + path.sep) || !info?.isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "content-length": info.size });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Chromium over --remote-debugging-pipe: requests on fd 3, replies on fd 4, NUL-separated JSON. */
function launch(chrome, profile) {
  const child = spawn(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--force-color-profile=srgb", "--hide-scrollbars", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions",
    "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
    `--user-data-dir=${profile}`, "--remote-debugging-pipe", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let stderr = "", buffered = "", nextId = 0, broken = null;
  const pending = new Map(), listeners = new Set();
  const fail = (message) => {
    broken ??= new EquipmentError(message);
    for (const { reject } of pending.values()) reject(broken);
    pending.clear();
  };
  child.on("error", (error) => fail(`Chromium could not start: ${error.message}`));
  child.stdio[3]?.on("error", (error) => fail(`pipe to Chromium failed: ${error.message}`));
  child.stdio[4]?.on("error", (error) => fail(`pipe from Chromium failed: ${error.message}`));
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  child.stdio[4].setEncoding("utf8");
  child.stdio[4].on("data", (chunk) => {
    buffered += chunk;
    let end;
    while ((end = buffered.indexOf("\0")) >= 0) {
      let message;
      try { message = JSON.parse(buffered.slice(0, end)); } catch { fail("Chromium sent an unreadable message"); return; }
      buffered = buffered.slice(end + 1);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new EquipmentError(`Chromium refused a request: ${message.error.message} ${message.error.data ?? ""}`.trim()));
        else resolve(message.result);
      } else for (const listener of listeners) listener(message);
    }
  });
  const exited = new Promise((resolve) => child.on("close", resolve));
  exited.then(() => fail(`Chromium exited: ${stderr.trim().split("\n").slice(-3).join(" | ")}`));
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (broken) { reject(broken); return; }
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
  const waitFor = (predicate, label, ms) => {
    let listener, timer;
    const promise = new Promise((resolve, reject) => {
      timer = setTimeout(() => { listeners.delete(listener); reject(new EquipmentError(`timed out after ${ms / 1000} s waiting for ${label}`)); }, ms);
      listener = (message) => { if (predicate(message)) { clearTimeout(timer); listeners.delete(listener); resolve(message); } };
      listeners.add(listener);
    });
    return { promise, cancel: () => { clearTimeout(timer); listeners.delete(listener); } };
  };
  return { send, waitFor, listeners, close: async () => { child.kill("SIGKILL"); await exited; } };
}

// A busy host can stall any of these waits, so running out of time is Kitchen's, not the player's.
const WAIT = 60000;
const withTimeout = (promise, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new EquipmentError(`${label} took longer than ${WAIT / 1000} s`)), WAIT); })]).finally(() => clearTimeout(timer));
};

/**
 * Screenshot the player at each frame and hand each image to `inspect` as it is taken.
 * Returns the player's uncaught errors, which are reported but do not fail the check.
 */
async function capturePlayer({ root, chrome, width, height, fps, frames, inspect }) {
  const server = await serve(root);
  const profile = mkdtempSync(path.join(tmpdir(), "two-colours-"));
  const browser = launch(chrome, profile);
  const problems = [];
  try {
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => browser.send(method, params, sessionId);
    browser.listeners.add((message) => {
      if (message.sessionId === sessionId && message.method === "Runtime.exceptionThrown") problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.waitFor((message) => message.sessionId === sessionId && message.method === "Page.loadEventFired", "player.html to load", WAIT);
    const navigated = await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/player.html?capture` });
    if (navigated.errorText) { loaded.cancel(); assert.fail(`player.html did not load: ${navigated.errorText}`); }
    await loaded.promise;
    const evaluate = async (expression, label) => {
      const { result, exceptionDetails } = await withTimeout(send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), label);
      assert(!exceptionDetails, `${label} threw: ${exceptionDetails?.exception?.description ?? exceptionDetails?.text}`);
      return result.value;
    };
    const shape = await evaluate("(async () => { const ready = window.ready; const thenable = !!ready && typeof ready.then === 'function'; if (thenable) await ready; return { thenable, seek: typeof window.seek }; })()", "window.ready");
    assert(shape.thenable, "player.html must expose window.ready, a promise that resolves when it can draw");
    assert.equal(shape.seek, "function", "player.html must expose window.seek(t)");
    for (const frame of frames) {
      await evaluate(`(async () => { await window.seek(${frame / fps}); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()`, `seek to frame ${frame}`);
      const { data } = await withTimeout(send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } }), `screenshot of frame ${frame}`);
      const image = decodePng(Buffer.from(data, "base64"));
      if (image.width !== width || image.height !== height) throw new EquipmentError(`Chromium gave a ${image.width}x${image.height} screenshot of frame ${frame}, not ${width}x${height}`);
      inspect(frame, image);
    }
    return problems;
  } finally {
    await browser.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

/** Decode the given film frames as RGB24, keyed by frame number. */
function filmFrames(file, frames, width, height) {
  const wanted = [...new Set(frames)].sort((x, y) => x - y);
  const select = wanted.map((frame) => `eq(n\\,${frame})`).join("+");
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select='${select}'`, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: wanted.length * width * height * 3 + 1024, timeout: WAIT * 2 });
  if (result.status !== 0) throw new EquipmentError(`film frame decode failed: ${String(result.stderr ?? result.error?.message).trim().slice(0, 400)}`);
  const size = width * height * 3;
  assert.equal(result.stdout.length, size * wanted.length, `film.mp4 gave ${result.stdout.length / size} of ${wanted.length} requested frames`);
  return new Map(wanted.map((frame, i) => [frame, result.stdout.subarray(i * size, (i + 1) * size)]));
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

  // The seed covers every file a delivery could tune against the sample, so no frame is known before all are final.
  const film = path.join(root, "film.mp4");
  const seed = createHash("sha256");
  for (const name of ["film.mp4", "player.html", "evidence.json"]) seed.update(createHash("sha256").update(readFileSync(path.join(root, name))).digest());
  const sampled = sampleFrames(seed.digest(), contract.frames, rule.samples);
  const count = Math.min(rule.agreementFrames, sampled.length);
  const agreementFrames = Array.from({ length: count }, (_, i) => sampled[Math.floor(((i + 0.5) * sampled.length) / count)]);
  const kept = new Map(), seen = new Set();
  const problems = await capturePlayer({ root, chrome, width, height, fps, frames: sampled, inspect: (frame, image) => {
    for (const [key, { count: pixels, x, y }] of colourCensus(image)) {
      assert(declared.includes(key), `frame ${frame} (${(frame / fps).toFixed(3)} s) has ${pixels} pixel(s) of ${hexOf(key)}, first at (${x}, ${y}); only ${evidence.colours.join(" and ")} may appear`);
      seen.add(key);
    }
    if (agreementFrames.includes(frame)) kept.set(frame, image.data);
  } });
  assert.equal(seen.size, 2, `only ${[...seen].map(hexOf).join(", ")} appeared in ${sampled.length} sampled frames; both declared colours must appear`);

  // Film frame n should be the player at n / fps; a capture one frame early or late is a slip, not another film.
  const neighbours = (frame) => [frame - 1, frame, frame + 1].filter((n) => n >= 0 && n < contract.frames);
  const decoded = filmFrames(film, agreementFrames.flatMap(neighbours), width, height);
  const agreement = [];
  for (const frame of agreementFrames) {
    const best = neighbours(frame)
      .map((n) => ({ offset: n - frame, ...blockAgreement(kept.get(frame), decoded.get(n), width, height, declared, rule.block) }))
      .sort((x, y) => x.meanDifference - y.meanDifference)[0];
    agreement.push({ frame, ...best });
    assert(best.meanDifference <= rule.maxMeanDifference && best.farShare <= rule.maxFarShare,
      `film.mp4 frame ${frame} (${(frame / fps).toFixed(3)} s) does not match player.html, even one frame either side: mean block difference ${best.meanDifference.toFixed(3)} (limit ${rule.maxMeanDifference}), ${(100 * best.farShare).toFixed(1)}% of blocks far apart (limit ${100 * rule.maxFarShare}%)`);
  }
  return { colours: evidence.colours, sampled, agreement, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const watchdog = setTimeout(() => { console.error(`ERROR: the two-colours check took longer than 15 minutes (Kitchen equipment, exit ${EQUIPMENT_FAILURE})`); process.exit(EQUIPMENT_FAILURE); }, 15 * 60 * 1000);
  try {
    const result = await checkTwoColours();
    const worst = Math.max(...result.agreement.map((entry) => entry.meanDifference));
    const offset = result.agreement.filter((entry) => entry.offset !== 0).length;
    const notes = [
      offset ? `${offset} of them one frame apart` : "",
      result.problems.length ? `player.html reported ${result.problems.length} uncaught error(s), first: ${String(result.problems[0]).split("\n")[0].slice(0, 200)}` : "",
    ].filter(Boolean).join("; ");
    console.log(`PASS: ${result.sampled.length} player frames hold exactly ${result.colours.join(" and ")}; ${result.agreement.length} film frames agree with the player (worst mean block difference ${worst.toFixed(3)})${notes ? ` (${notes})` : ""}. Unsampled frames, depth, light, texture and motion are left to tasting.`);
  } catch (error) {
    if (error instanceof EquipmentError) {
      console.error(`ERROR: ${error.message} (Kitchen equipment, exit ${EQUIPMENT_FAILURE})`);
      process.exitCode = EQUIPMENT_FAILURE;
    } else {
      console.error(`FAIL: ${error.message}`);
      process.exitCode = 1;
    }
  } finally {
    clearTimeout(watchdog);
  }
}
