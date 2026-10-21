// node shoot.mjs <work.html> --format 9x16 --times 1,2.5 | --range a:b:step  --out out/stills
// Native-canvas PNG stills at exact times (for hardest-frame-first and defect close-ups).
import fs from 'node:fs'; import path from 'node:path';
import { openWork, frameAt, parseArgs, ensureDir } from './lib.mjs';
const a = parseArgs(process.argv.slice(2));
const dir = ensureDir(a.out || 'out/stills');
const { browser, page, meta } = await openWork(a._[0], a.format || '16x9');
let times = [];
if (a.times) times = String(a.times).split(',').map(Number);
else { const [s, e, st] = String(a.range || `0:${meta.duration}:1`).split(':').map(Number); for (let t = s; t < e - 1e-9; t += st) times.push(+t.toFixed(4)); }
for (const t of times) { const f = path.join(dir, `${a.format || '16x9'}-t${t.toFixed(2)}.png`); fs.writeFileSync(f, await frameAt(page, t)); console.log(f); }
await browser.close();
