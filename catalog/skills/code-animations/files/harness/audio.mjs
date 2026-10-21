// node audio.mjs <work.html> [--twice] [--tol 1] [--out out/x.wav]
// Renders the score alone (seconds, no video), checks exact length, and with --twice proves determinism.
import fs from 'node:fs'; import crypto from 'node:crypto';
import { openWork, parseArgs, ensureDir } from './lib.mjs';
const a = parseArgs(process.argv.slice(2));
const { browser, page, meta, errors } = await openWork(a._[0], a.format || '16x9');
const get = () => page.evaluate(async () => await __anim.renderAudio());
const b1 = Buffer.from(await get(), 'base64');
const out = a.out || 'out/score.wav'; ensureDir('out'); fs.writeFileSync(out, b1);
const samples = (b1.length - 44) / 4, secs = samples / 48000;
let fail = 0;
console.log(`wrote ${out}: ${secs.toFixed(4)}s (expected ${meta.duration}s)`); if (Math.abs(secs - meta.duration) > 1e-3) { fail++; console.log('FAIL length'); }
if (a.twice) {
  const b2 = Buffer.from(await get(), 'base64');
  const h = b => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
  let diff = 0, maxd = 0; for (let i = 44; i < b1.length; i += 2) { const d = Math.abs(b1.readInt16LE(i) - b2.readInt16LE(i)); if (d) { diff++; maxd = Math.max(maxd, d); } }
  const tol = Number(a.tol ?? 1); // Chrome's Web Audio can differ by 1 LSB (16-bit) between runs; inaudible
  console.log(h(b1) === h(b2) ? 'twice: identical' : `twice: ${diff} samples differ, max ${maxd} LSB (tolerance ${tol})`); if (maxd > tol) { fail++; console.log('FAIL audio determinism'); }
}
await browser.close(); if (errors.length) { console.log(errors.join('\n')); fail++; }
process.exit(fail ? 1 : 0);
