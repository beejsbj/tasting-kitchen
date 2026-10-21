// node harness/review.mjs <work/index.html> [--format 16x9] [--out out/review] [--checklist brief.md]
// node harness/review.mjs --check out/review/REVIEW.md [--checklist brief.md]
// The review gate. Writes one contact sheet per shot (first frame, 6 evenly spaced frames, last frame, timecode
// burned in), the lint JSON, and REVIEW.md: fixed questions per shot that the reviewer must answer in writing.
// --check exits 1 while any answer is empty or still the placeholder, any score is under 4, lint has a FAIL,
// a shot section is missing, or the film changed after the review was generated. A review can't be skipped silently.
// It also fails a shot whose answers cite no tile of its own sheet (@4.30s), answers copied between shots (the mark
// of a script, not of someone looking), and, with --checklist, any brief checklist item not verdicted correct.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openWork, parseArgs, ensureDir } from './lib.mjs';

const INNER = 6;            // evenly spaced frames inside each shot, plus its first and last frame
const COLS = 4;             // tiles per row on a sheet
const TILE_W = 480;         // tile width in px: 4 tiles make a 1920 px wide sheet in any format
const TODO = 'TODO';        // the placeholder --check rejects
const MIN_SCORE = 4;
const QUESTIONS = [
  'What is being said here, and does the picture show exactly that?',
  'Is it accurate against a reference? Name the reference (file or URL) and compare, item by item: direction of motion (rotation sense, flow and travel direction), relative sizes and proportions of parts, part count, order of steps.',
  'Is any text unreadable at phone size?',
  'Does anything collide, get cut off, or sit static too long?',
  'Is there a cut or empty frame?',
  'Does the sound land on the pops? (see audio-sync in the lint summary below)',
];
const CITE = /@(\d+\.\d\d)s\b/g;   // the one citation format: @ + a tile time exactly as printed on "Tiles at:"
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// The brief's accuracy checklist: the numbered items under a heading that starts "## Accuracy checklist"
function briefChecklist(file) {
  const sec = fs.readFileSync(file, 'utf8').split(/^## /m).find(x => /^Accuracy checklist/i.test(x));
  return sec ? [...sec.matchAll(/^\d+\.\s+(.+?)\s*$/gm)].map(m => m[1]) : [];
}
const cites = (text, tiles) => [...text.matchAll(CITE)].map(m => m[1]).filter(t => tiles.has(t));

// ====================================================================================================
// --check: parse a filled REVIEW.md and fail on anything unanswered, low-scored or stale
// ====================================================================================================
function check(reviewPath, brief) {
  const dir = path.dirname(path.resolve(reviewPath)), md = fs.readFileSync(reviewPath, 'utf8'), errs = [];
  const meta = k => (md.match(new RegExp(`<!-- ${k}: (.+?) -->`)) || [])[1];
  const film = meta('film'), hash = meta('film-sha256'), nShots = Number(meta('shots'));
  if (!film || !hash || !nShots) errs.push('header comments (film, film-sha256, shots) are missing: regenerate with review.mjs');
  else {
    const fp = path.resolve(dir, film);
    if (!fs.existsSync(fp)) errs.push(`film not found: ${fp}`);
    else if (sha256(fp) !== hash) errs.push('the film changed after this review was generated: run review.mjs again and re-answer');
  }
  const sections = md.split(/^## Shot /m).slice(1);
  if (nShots && sections.length !== nShots) errs.push(`${sections.length} shot sections, expected ${nShots}`);
  const allTiles = new Set(), same = new Map();   // same: "question|answer text" -> shots that gave it
  for (const s of sections) {
    const name = s.split('\n')[0].trim();
    const answers = [...s.matchAll(/^\*\*(A|Score|Fixes made):\*\*[ \t]*(.*)$/gm)];
    if (answers.length !== QUESTIONS.length + 2) errs.push(`${name}: ${answers.length} answer lines, expected ${QUESTIONS.length + 2}`);
    answers.forEach(([, k, v], i) => { if (!v.trim() || v.includes(TODO)) errs.push(`${name}: ${k === 'A' ? 'answer ' + (i + 1) : k} is empty or ${TODO}`); });
    // proof the sheet was opened: at least one answer names a tile that is on THIS shot's sheet
    const tiles = new Set(((s.match(/^Tiles at: (.+)$/m) || [])[1] || '').split(',').map(x => x.trim().replace(/s$/, '')).filter(Boolean));
    tiles.forEach(t => allTiles.add(t));
    const texts = answers.filter(([, k]) => k === 'A').map(([, , v]) => v.trim());
    if (!tiles.size) errs.push(`${name}: the "Tiles at:" line is missing: regenerate with review.mjs`);
    else if (!cites(texts.join(' '), tiles).length) errs.push(`${name}: no answer cites a tile of its sheet (write e.g. @${[...tiles][1] || [...tiles][0]}s, a time from its "Tiles at:" line)`);
    texts.forEach((v, q) => { if (v && !v.includes(TODO)) { const k = q + '|' + v; same.set(k, [...(same.get(k) || []), name]); } });
    const score = answers.find(([, k]) => k === 'Score');
    const n = score && Number((score[2].match(/^\s*([1-5])\b/) || [])[1]);
    if (score && !score[2].includes(TODO)) { if (!n) errs.push(`${name}: score must start with a number 1-5`); else if (n < MIN_SCORE) errs.push(`${name}: score ${n} < ${MIN_SCORE}`); }
  }
  for (const [k, names] of same) if (names.length > 1)
    errs.push(`answer ${Number(k.split('|')[0]) + 1} is identical in shots ${names.join(', ')}: open each sheet and write each answer yourself`);

  // accuracy checklist: every item verdicted correct, with a tile citation; with a brief, every brief item present
  const csec = md.split(/^## /m).find(x => /^Accuracy checklist/.test(x)) || '';
  const items = [...csec.matchAll(/^C(\d+)\. (.+?)\r?\n\*\*Verdict:\*\*[ \t]*(.*)$/gm)];
  const nItems = Number(meta('checklist') || 0);
  if (nItems && items.length !== nItems) errs.push(`${items.length} checklist items, expected ${nItems}`);
  if (brief) {
    const want = briefChecklist(brief);
    if (!want.length) errs.push(`no "## Accuracy checklist" numbered list in ${brief}`);
    want.forEach((w, i) => { if (!items.some(([, , txt]) => txt.trim() === w)) errs.push(`checklist item ${i + 1} of the brief is not in REVIEW.md: regenerate with --checklist ${brief}`); });
  }
  for (const [, n, , v] of items) {
    const verdict = ((v.match(/^\s*(correct|wrong|missing)\b/i) || [])[1] || '').toLowerCase();
    if (!v.trim() || v.includes(TODO)) { errs.push(`checklist C${n}: verdict is empty or ${TODO}`); continue; }
    if (!verdict) errs.push(`checklist C${n}: verdict must start with correct, wrong or missing`);
    else if (verdict !== 'correct') errs.push(`checklist C${n}: ${verdict}`);
    if (!cites(v, allTiles).length) errs.push(`checklist C${n}: cites no tile timecode (@4.30s from a "Tiles at:" line)`);
  }
  const lintPath = path.join(dir, 'lint.json');
  if (!fs.existsSync(lintPath)) errs.push(`lint JSON not found: ${lintPath}`);
  else for (const r of JSON.parse(fs.readFileSync(lintPath, 'utf8')).results)
    for (const c of r.checks) if (c.status === 'FAIL') errs.push(`lint ${r.format} ${c.id}: FAIL`);
  for (const e of errs) console.log('FAIL ' + e);
  console.log(errs.length ? `review check: ${errs.length} FAIL` : `review check: OK (${sections.length} shots answered and cited, all >= ${MIN_SCORE}/5, ${items.length ? items.length + ' checklist items correct, ' : ''}0 lint FAIL)`);
  process.exit(errs.length ? 1 : 0);
}

// ====================================================================================================
// Contact sheet for one shot, composed in the page (no image library needed): tiles of the film's own canvas
// ====================================================================================================
async function sheet(page, times, label) {
  const b64 = await page.evaluate((times, label, COLS, TILE_W) => {
    const src = __anim.canvas, th = Math.round(TILE_W * src.height / src.width), rows = Math.ceil(times.length / COLS);
    const cv = document.createElement('canvas'); cv.width = COLS * TILE_W; cv.height = rows * th;
    const x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height);
    times.forEach((t, i) => {
      __anim.seek(t);
      const tx = (i % COLS) * TILE_W, ty = Math.floor(i / COLS) * th;
      x.drawImage(src, tx, ty, TILE_W, th);
      const tc = `${label}  t=${t.toFixed(2)}s`;           // timecode burned into each tile
      x.font = '600 18px Consolas, "DejaVu Sans Mono", monospace';
      x.fillStyle = 'rgba(0,0,0,0.75)'; x.fillRect(tx, ty, x.measureText(tc).width + 16, 28);
      x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(tc, tx + 8, ty + 14);
      x.strokeStyle = '#000'; x.lineWidth = 2; x.strokeRect(tx + 1, ty + 1, TILE_W - 2, th - 2);
    });
    return cv.toDataURL('image/png').split(',')[1];
  }, times, label, COLS, TILE_W);
  return Buffer.from(b64, 'base64');
}

// ====================================================================================================
// Main
// ====================================================================================================
const a = parseArgs(process.argv.slice(2));
if (a.checklist === true) { console.log('review: --checklist needs a brief file, e.g. --checklist bench/briefs/02-derailleur.md'); process.exit(2); }
if (a.check) check(a.check === true ? a._[0] : a.check, a.checklist);
else {
  const html = a._[0];
  if (!html) { console.log('usage: node harness/review.mjs <work/index.html> [--format 16x9] [--out out/review] [--checklist brief.md]\n       node harness/review.mjs --check <out/review/REVIEW.md> [--checklist brief.md]'); process.exit(2); }
  const checklist = a.checklist ? briefChecklist(a.checklist) : [];
  if (a.checklist && !checklist.length) { console.log(`review: no "## Accuracy checklist" numbered list in ${a.checklist}`); process.exit(2); }
  const format = a.format || '16x9', out = ensureDir(path.resolve(a.out || 'out/review')), sheets = ensureDir(path.join(out, 'sheets'));

  // lint first, so its JSON sits next to REVIEW.md; a lint FAIL doesn't stop the sheets, --check catches it
  const lintJs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lint.mjs');
  const lint = spawnSync(process.execPath, [lintJs, html, '--all-formats', '--json', path.join(out, 'lint.json')], { encoding: 'utf8' });
  if (!fs.existsSync(path.join(out, 'lint.json'))) { console.log(lint.stdout + lint.stderr + '\nreview: lint did not write its JSON'); process.exit(2); }
  const lintRes = JSON.parse(fs.readFileSync(path.join(out, 'lint.json'), 'utf8')).results;

  const { browser, page, meta, errors } = await openWork(html, format);
  const fps = await page.evaluate(() => __anim.fps || 30);
  if (!meta.shots.length) { await browser.close(); console.log('review: __anim.shots is empty, nothing to review'); process.exit(2); }
  const shots = [];
  for (const [i, s] of meta.shots.entries()) {
    const last = Math.max(s.start, Math.min(s.end, meta.duration) - 1 / fps);
    const times = [s.start, ...Array.from({ length: INNER }, (_, k) => s.start + (last - s.start) * (k + 1) / (INNER + 1)), last];
    const file = path.join(sheets, `${format}-${String(i + 1).padStart(2, '0')}-${String(s.id).replace(/[^\w-]/g, '_')}.png`);
    fs.writeFileSync(file, await sheet(page, times, s.id));
    shots.push({ ...s, file, times });
    console.log(file);
  }
  await browser.close();

  // REVIEW.md from a fixed template. An existing one is kept as REVIEW.prev.md, never silently overwritten.
  const reviewPath = path.join(out, 'REVIEW.md');
  if (fs.existsSync(reviewPath)) fs.copyFileSync(reviewPath, path.join(out, 'REVIEW.prev.md'));
  const rel = p => path.relative(out, p).split(path.sep).join('/');
  const L = [
    `# Review: ${path.basename(path.dirname(path.resolve(html)))} (${format})`, '',
    `<!-- film: ${rel(path.resolve(html))} -->`, `<!-- film-sha256: ${sha256(html)} -->`, `<!-- shots: ${shots.length} -->`, '',
    'Open every sheet and answer every question in writing, on the line after its label, replacing TODO.',
    'Answers must describe what you SEE. Cite the tiles you looked at as @4.30s, a time from that shot\'s "Tiles at:" line;',
    'every shot needs at least one. Write each answer yourself: answers copied between shots fail the check.',
    'For real-world objects (animals, logos, UI, real systems), compare against a reference image and name it:',
    'direction of motion and relative size are the most-missed errors. Fix what you find, re-run review.mjs, answer again.',
    `Gate: \`node harness/review.mjs --check ${rel(reviewPath)}${a.checklist ? ' --checklist ' + a.checklist : ''}\` must print "review check: OK".`, '',
  ];
  for (const s of shots) {
    L.push(`## Shot ${s.id} (${s.start.toFixed(2)}s - ${s.end.toFixed(2)}s)`, '', `![${s.id}](${rel(s.file)})`, '',
      `Tiles at: ${s.times.map(t => t.toFixed(2) + 's').join(', ')}`, '');
    QUESTIONS.forEach((q, i) => L.push(`${i + 1}. ${q}`, `**A:** ${TODO}`, ''));
    L.push(`${QUESTIONS.length + 1}. Score 1-5 (5 = nothing to fix) and the fixes made.`, `**Score:** ${TODO}`, `**Fixes made:** ${TODO}`, '');
  }
  if (checklist.length) {
    L.push('## Accuracy checklist', '', `<!-- checklist: ${checklist.length} -->`, '',
      `From ${path.basename(a.checklist)}. Each verdict starts with correct, wrong or missing, cites the tile that shows it (@4.30s), then says what you saw.`, '');
    checklist.forEach((it, i) => L.push(`C${i + 1}. ${it}`, `**Verdict:** ${TODO}`, ''));
  }
  L.push('## Lint summary', '', '| format | check | status | evidence |', '|---|---|---|---|');
  for (const r of lintRes) for (const c of r.checks) L.push(`| ${r.format} | ${c.id} | ${c.status} | ${c.summary} |`);
  const nFail = lintRes.reduce((n, r) => n + r.checks.filter(c => c.status === 'FAIL').length, 0);
  L.push('', `Lint FAIL count: ${nFail}`, '', '## Checklist', '', `- [ ] all shots >= ${MIN_SCORE}/5, 0 lint FAIL`, '');
  fs.writeFileSync(reviewPath, L.join('\n'));
  console.log(`${reviewPath}\nreview: ${shots.length} sheets, lint ${nFail} FAIL${errors.length ? ', PAGE ERRORS:\n' + errors.join('\n') : ''}`);
  process.exit(errors.length ? 1 : 0);
}
