import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { chromePath, hasFfmpeg, makeDelivery, runCheck } from "../../../../tests/support/film-delivery.mjs";
import { blockAgreement, colourCensus, sampleFrames } from "./validation/two-colours.mjs";

const recipeDir = import.meta.dirname;
const contract = {
  width: 160, height: 200, fps: 24, duration: 2, frames: 48,
  twoColours: { samples: 12, agreementFrames: 3, minDistance: 48, block: 10, maxMeanDifference: 0.06, maxFarShare: 0.03 },
};
const INK = "#1b1f3a", PAPER = "#f2c14e";
const evidence = { colours: [INK, PAPER], checks: [{ name: "test", result: "passed", detail: "test delivery" }] };

// A two-colour picture with depth cues, fine dither and fast motion: a pure function of
// pixel and time, shared by the player (in the browser) and the film (encoded here).
const PICTURE = `function picture(x, y, t) {
  const band = Math.floor((y + t * 90) / 16) % 2;
  const dither = (x + y) % 2 === 0;
  const near = y > 120 ? band : (y > 60 ? (dither ? band : 1 - band) : ((x >> 2) + (y >> 2)) % 2);
  const cx = Math.floor((t * 300) % 200) - 20, cy = 90;
  const inBox = x >= cx && x < cx + 36 && y >= cy && y < cy + 30;
  return inBox ? 1 - near : near;
}`;
const picture = new Function(`${PICTURE}; return picture;`)();
const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

function player({ extra = "" } = {}) {
  return `<!doctype html><meta charset="utf-8"><title>test</title>
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id="c" width="${contract.width}" height="${contract.height}"></canvas>
<script>
${PICTURE}
const ctx = document.getElementById('c').getContext('2d');
const A = ${JSON.stringify(rgb(INK))}, B = ${JSON.stringify(rgb(PAPER))};
window.seek = (t) => {
  const image = ctx.createImageData(${contract.width}, ${contract.height});
  for (let y = 0; y < ${contract.height}; y++) for (let x = 0; x < ${contract.width}; x++) {
    const c = picture(x, y, t) ? B : A, i = (y * ${contract.width} + x) * 4;
    image.data[i] = c[0]; image.data[i + 1] = c[1]; image.data[i + 2] = c[2]; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  ${extra}
};
window.ready = Promise.resolve().then(() => window.seek(0));
</script>`;
}

function filmVideo(offset = 0) {
  const [a, b] = [rgb(INK), rgb(PAPER)];
  return (frame) => {
    const buffer = Buffer.alloc(contract.width * contract.height * 3);
    for (let y = 0; y < contract.height; y++) for (let x = 0; x < contract.width; x++) buffer.set(picture(x, y, frame / contract.fps + offset) ? b : a, (y * contract.width + x) * 3);
    return buffer;
  };
}

test("sampled frames are spread across the film and fixed by its hash", () => {
  const seed = createHash("sha256").update("film").digest();
  const frames = sampleFrames(seed, 576, 48);
  assert.equal(frames.length, 48);
  frames.forEach((frame, i) => assert(frame >= i * 12 && frame < (i + 1) * 12, `frame ${frame} sits in stratum ${i}`));
  assert.deepEqual(sampleFrames(seed, 576, 48), frames);
  assert.notDeepEqual(sampleFrames(createHash("sha256").update("another film").digest(), 576, 48), frames);
});

test("a census counts every distinct colour", () => {
  const data = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255]);
  const census = colourCensus({ width: 2, data });
  assert.equal(census.size, 3);
  assert.deepEqual(census.get(0x808080), { count: 1, x: 1, y: 1 });
});

test("block agreement accepts a smeared dither and refuses a different picture", () => {
  const width = 20, height = 20, a = 0x000000, b = 0xffffff;
  const player = new Uint8Array(width * height * 4), same = new Uint8Array(width * height * 3), other = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const on = ((i % width) + Math.floor(i / width)) % 2 === 0;
    player.set(on ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4);
    same.set([128, 128, 128], i * 3); // the dither, averaged by an encoder
    other.set((i % width) < 10 ? [0, 0, 0] : [255, 255, 255], i * 3);
  }
  assert(blockAgreement(player, same, width, height, [a, b]).meanDifference < 0.01);
  assert.equal(blockAgreement(player, other, width, height, [a, b]).farShare, 1);
});

const skip = (!hasFfmpeg && "ffmpeg is not installed") || (!chromePath && "no Chromium-family browser found (set CHROME_PATH)");
const check = (root) => runCheck(root, "validation/two-colours.mjs", { CHROME_PATH: chromePath });

test("a two-colour player whose film agrees passes", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence, video: filmVideo(), files: { "player.html": player() } });
  const film = runCheck(root, "validation/film.mjs");
  assert(film.passed, film.output);
  const result = check(root);
  assert(result.passed, result.output);
  assert.match(result.output, /PASS: 12 player frames hold exactly #1b1f3a and #f2c14e/u);
});

test("a third colour fails", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence, video: filmVideo(), files: { "player.html": player({ extra: "ctx.fillStyle = '#e4572e'; ctx.fillRect(4, 4, 3, 3);" }) } });
  const result = check(root);
  assert(!result.passed);
  assert.match(result.output, /has 9 pixel\(s\) of #e4572e, first at \(4, 4\)/u);
});

test("an anti-aliased edge fails", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence, video: filmVideo(), files: { "player.html": player({ extra: `ctx.fillStyle = '${INK}'; ctx.beginPath(); ctx.arc(80.3, 40.7, 17.2, 0, Math.PI * 2); ctx.fill();` }) } });
  const result = check(root);
  assert(!result.passed);
  assert.match(result.output, /pixel\(s\) of #[0-9a-f]{6}.*only #1b1f3a and #f2c14e may appear/u);
});

test("a film that is not the player's film fails", { skip }, async (t) => {
  const root = await makeDelivery(t, recipeDir, { contract, evidence, video: filmVideo(0.5), files: { "player.html": player() } });
  const result = check(root);
  assert(!result.passed);
  assert.match(result.output, /film\.mp4 frame \d+ .* does not match player\.html/u);
});

test("undeclared, missing or too-similar colours fail", { skip }, async (t) => {
  const wrong = await makeDelivery(t, recipeDir, { contract, evidence: { ...evidence, colours: [INK, "#ffffff"] }, video: filmVideo(), files: { "player.html": player() } });
  assert.match(check(wrong).output, /#f2c14e, first at .*only #1b1f3a and #ffffff may appear/u);
  const close = await makeDelivery(t, recipeDir, { contract, evidence: { ...evidence, colours: [INK, "#202540"] }, video: filmVideo(), files: { "player.html": player() } });
  assert.match(check(close).output, /must be at least 48 apart/u);
  const none = await makeDelivery(t, recipeDir, { contract, evidence: { checks: evidence.checks }, video: filmVideo(), files: { "player.html": player() } });
  assert.match(check(none).output, /evidence\.colours must name the two colours/u);
});
