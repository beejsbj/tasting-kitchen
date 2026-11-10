#!/usr/bin/env node
// Gallery playback check, run inside the film toolchain image with no network.
// Serves <root> on loopback with the artifact headers from vercel.json (the
// rules nginx and the Vite servers mirror), embeds the Dish in the gallery's
// sandboxed iframe, plays the supplied index.html's film muted and opens the
// live player.html in the same sandbox.
// usage: node playback.mjs <root> <dish url path> <contract.json> <evidence dir>
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const [root, dishPath, contractFile, evidenceDir] = process.argv.slice(2);
const kitchen = process.env.KITCHEN_ROOT ?? "/kitchen";
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? `${kitchen}/node_modules/playwright-core/index.mjs`);
const contract = JSON.parse(readFileSync(contractFile, "utf8"));
const vercel = JSON.parse(readFileSync(path.join(kitchen, "vercel.json"), "utf8"));
const artifactHeaders = vercel.headers.find((rule) => rule.source === "/dishes/:path*").headers;
const TYPES = { ".html": "text/html; charset=utf-8", ".mp4": "video/mp4", ".png": "image/png", ".json": "application/json", ".md": "text/markdown", ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/plain" };

const gallery = `<!doctype html><meta charset="utf-8"><title>gallery playback</title>
<style>body{margin:0;background:#111}iframe{border:0;width:640px;height:1000px}</style>
<iframe id="pane" src="${dishPath}artifact/index.html" sandbox="allow-scripts allow-forms" title="Dish"></iframe>`;

const server = createServer((request, response) => {
  const url = decodeURIComponent(request.url.split("?")[0]);
  if (url === "/gallery.html") { response.writeHead(200, { "content-type": TYPES[".html"] }); response.end(gallery); return; }
  const file = path.join(root, path.normalize(url));
  if (!file.startsWith(path.resolve(root) + path.sep)) { response.writeHead(403); response.end(); return; }
  let info;
  try { info = statSync(file); } catch { response.writeHead(404); response.end(); return; }
  if (!info.isFile()) { response.writeHead(404); response.end(); return; }
  const headers = { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "accept-ranges": "bytes" };
  if (url.includes("/dishes/")) for (const { key, value } of artifactHeaders) headers[key] = value;
  const range = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${info.size}`, "content-length": end - start + 1 });
    createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...headers, "content-length": info.size });
  createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 640, height: 1000 } });
const problems = [];
page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) problems.push(`console: ${message.text()}`); });
// Every failed request is named; the browser's own favicon probe is not the Dish's.
page.on("response", (response) => { if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) problems.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
await page.goto(`${origin}/gallery.html`);
const pane = await (await page.waitForSelector("#pane")).contentFrame();
await pane.waitForSelector("video");
const film = await pane.evaluate(async () => {
  const video = document.querySelector("video");
  if (video.readyState < 1) await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error(`media error ${video.error?.code}`)); setTimeout(() => reject(new Error("no metadata in 20 s")), 20000); });
  video.muted = true;
  await video.play();
  const begin = performance.now();
  while (video.currentTime < 1.5 && performance.now() - begin < 20000) await new Promise((resolve) => setTimeout(resolve, 100));
  video.pause();
  return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, currentTime: video.currentTime, error: video.error?.code ?? null, origin: String(window.origin) };
});
await page.screenshot({ path: path.join(evidenceDir, "gallery-playback.png") });

// The live player opens in the same sandbox and answers seek(t) once ready.
await pane.goto(`${origin}${dishPath}artifact/player.html`);
const live = await pane.evaluate(async (duration) => {
  await window.ready;
  if (typeof window.seek !== "function") return { seek: false };
  window.seek(duration / 2);
  return { seek: true, origin: String(window.origin) };
}, contract.duration);
await page.screenshot({ path: path.join(evidenceDir, "live-player.png") });
await browser.close();
server.close();

const checks = [
  ["film decodes in the gallery sandbox", film.error === null && film.width === contract.width && film.height === contract.height, `${film.width}x${film.height}, error ${film.error}`],
  ["film duration", Math.abs(film.duration - contract.duration) < 0.1, `${film.duration.toFixed(3)} s`],
  ["film plays", film.currentTime >= 1.5, `advanced to ${film.currentTime.toFixed(2)} s`],
  ["artifact origin is opaque", film.origin === "null", `window.origin ${film.origin}`],
  ["live player seeks", live.seek === true, "window.ready resolved and window.seek ran"],
  ["no page errors", problems.length === 0, problems.join("; ") || "none"],
].map(([name, passed, detail]) => ({ name, passed, detail }));
writeFileSync(path.join(evidenceDir, "playback.json"), `${JSON.stringify({ checks, film, live }, null, 2)}\n`);
for (const check of checks) console.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
process.exit(checks.every((check) => check.passed) ? 0 : 1);
