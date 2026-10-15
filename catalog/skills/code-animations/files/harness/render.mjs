// node render.mjs <work.html> --format 16x9 --fps 30 --out out/x.mp4 [--from a --to b] [--silent] [--png]
// Seeks every frame (no realtime capture, so no dropped/duplicated frames) and pipes PNGs into ffmpeg.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openWork, frameAt, parseArgs, ensureDir } from './lib.mjs';

const a = parseArgs(process.argv.slice(2));
const html = a._[0]; const format = a.format || '16x9'; const fps = Number(a.fps || 30);
const out = a.out || `out/${path.basename(path.dirname(path.resolve(html)))}-${format}.mp4`;
ensureDir(path.dirname(out));
const { browser, page, meta, errors } = await openWork(html, format);
const from = Number(a.from || 0), to = Math.min(Number(a.to || meta.duration), meta.duration);
const full = from === 0 && to === meta.duration && !a.silent;
const nFrames = Math.round((to - from) * fps);

let wav = null;
if (full) {
  const b64 = await page.evaluate(async () => __anim.renderAudio ? await __anim.renderAudio() : null);
  if (b64) { wav = out.replace(/\.mp4$/, '.wav'); fs.writeFileSync(wav, Buffer.from(b64, 'base64')); }
}
const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
if (wav) args.push('-i', wav);
args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps));
if (wav) args.push('-c:a', 'aac', '-b:a', '192k');
args.push('-movflags', '+faststart', out);
const ff = spawn(process.env.FFMPEG || 'ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
for (let i = 0; i < nFrames; i++) {
  const t = from + i / fps;               // frame i shows time i/fps exactly
  const png = await frameAt(page, t, a.png ? 'image/png' : 'image/jpeg', 0.95);  // JPEG q95 transport is ~4x faster than PNG; --png for lossless
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
  if (i % fps === 0) process.stderr.write(`\rframe ${i}/${nFrames}`);
}
ff.stdin.end();
await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
await browser.close();
console.log(`\nwrote ${out} (${nFrames} frames @ ${fps}fps, ${((Date.now() - t0) / 1000).toFixed(1)}s)${wav ? ' + audio ' + wav : ' (silent)'}`);
if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exit(2); }
