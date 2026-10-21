// node verify.mjs <work.html> --format 16x9 [--times a,b,c]
// Determinism gate: cold jumps vs sequential arrival vs repeat seeks must give identical pixels.
import crypto from 'node:crypto';
import { openWork, frameAt, parseArgs } from './lib.mjs';
const a = parseArgs(process.argv.slice(2));
const { browser, page, meta, errors } = await openWork(a._[0], a.format || '16x9');
const D = meta.duration;
let times = a.times ? String(a.times).split(',').map(Number)
  : [0, D * 0.13, D * 0.37, D * 0.5, D * 0.71, D * 0.93, D - 1 / 30];
for (const s of meta.shots) times.push(s.start, Math.max(0, s.start - 1 / 30), s.end - 1 / 30);
times = [...new Set(times.map(t => +t.toFixed(4)))].filter(t => t >= 0 && t < D).sort((x, y) => x - y);
const h = b => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
const seq = {}; for (const t of times) seq[t] = h(await frameAt(page, t));          // forward
let fail = 0;
for (const t of [...times].reverse()) {                                           // backward cold jumps
  const x = h(await frameAt(page, t)); await frameAt(page, D * Math.random()); const y = h(await frameAt(page, t));
  if (x !== seq[t] || y !== seq[t]) { fail++; console.log(`FAIL t=${t}: ${seq[t]} vs ${x} vs ${y}`); }
}
await browser.close();
if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); fail++; }
console.log(fail ? `verify: ${fail} FAIL` : `verify: OK (${times.length} times, identical pixels on forward, backward and cold jumps)`);
process.exit(fail ? 1 : 0);
