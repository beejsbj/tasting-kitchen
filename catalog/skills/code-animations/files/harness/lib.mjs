// Shared harness helpers: launch headless Chrome, open a work at a given format, drive window.__anim.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FORMATS = {
  '16x9': [1920, 1080],
  '9x16': [1080, 1920],
  '4x5':  [1080, 1350],
  '1x1':  [1080, 1080],
};

export function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) a[k.slice(2)] = true; else { a[k.slice(2)] = n; i++; }
    } else a._.push(k);
  }
  return a;
}

// Default install locations per OS; the CHROME env var always wins.
const CHROME_PATHS = {
  win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
};

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const hit = (CHROME_PATHS[process.platform] || []).find(p => fs.existsSync(p));
  if (!hit) throw new Error('Chrome/Chromium not found. Set CHROME=/path/to/chrome');
  return hit;
}

// preload: optional function run in the page before any of the work's scripts (lint.mjs uses it to instrument text drawing)
export async function openWork(htmlPath, format = '16x9', preload = null) {
  const [w, h] = FORMATS[format] || format.split('x').map(Number);
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
           '--force-color-profile=srgb', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  if (preload) await page.evaluateOnNewDocument(preload);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // pathToFileURL: Windows backslash paths need a proper file:/// URL
  const url = pathToFileURL(path.resolve(htmlPath)).href + `?w=${w}&h=${h}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__anim && window.__anim.ready === true', { timeout: 60000 });
  const meta = await page.evaluate(() => ({ duration: __anim.duration, width: __anim.width, height: __anim.height,
    marks: __anim.marks || [], shots: __anim.shots || [] }));
  if (meta.width !== w || meta.height !== h) throw new Error(`work reports ${meta.width}x${meta.height}, expected ${w}x${h}`);
  return { browser, page, meta, errors, w, h };
}

// Seek to t and return the canvas as a PNG buffer (native canvas pixels, not a viewport screenshot).
export async function frameAt(page, t, type = 'image/png', q = 0.95) {
  const b64 = await page.evaluate((t, type, q) => { __anim.seek(t); return __anim.canvas.toDataURL(type, q).split(',')[1]; }, t, type, q);
  return Buffer.from(b64, 'base64');
}

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }
