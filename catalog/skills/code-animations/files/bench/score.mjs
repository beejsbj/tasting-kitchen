// node bench/score.mjs <work-dir> [--brief bench/briefs/NN.md]
// The bench meter. Runs the repo's own gates on one finished work and turns them into a 0-100 number, so runs by
// different AI tools on the same brief can be compared. It measures the floor (the gates), not taste or accuracy:
// the accuracy checklist in a brief is judged by a person from the review sheets. Always exits 0: a meter, not a gate.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../harness/lib.mjs';

// ====================================================================================================
// Weights (sum 100). WHY: the review gate weighs most because it is the only one that forces the tool to look at
// its own frames and answer in writing; lint is next because it catches what phones show badly (tiny or cut text,
// collisions, freezes, sound off the pops). verify and audio are table stakes: any film following the contract
// passes them. STORYBOARD and duration are cheap process checks, so they weigh least.
// ====================================================================================================
const W = {
  verify16: 10, verify9: 10,  // determinism in both delivered formats
  audio: 10,                  // exact length + identical twice
  lintNoFail: 20,             // lint --all-formats with 0 FAIL
  lintWarns: 10,              // full points at 0 WARN, minus WARN_COST per WARN, floor 0
  review16: 15, review9: 15,  // review --check OK for a REVIEW.md of each format
  storyboard: 5,              // STORYBOARD.md exists in the work folder
  duration: 5,                // film length inside the brief's "Duration: a-b s" range
};
const WARN_COST = 2;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // the gates run from the repo root
const a = parseArgs(process.argv.slice(2));
if (!a._[0]) { console.log('usage: node bench/score.mjs <work-dir> [--brief bench/briefs/NN.md]'); process.exit(0); }
const work = path.resolve(a._[0]), html = path.join(work, 'index.html');
const run = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'harness', script), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
};
const rel = p => { const r = path.relative(ROOT, p); return r.startsWith('..') ? p : r; };   // short paths inside the repo
const lastLine = s => s.trim().split('\n').filter(Boolean).at(-1) || '(no output)';
const rows = [];   // [gate, PASS/FAIL, points, max, evidence]
const add = (gate, pass, pts, max, ev) => rows.push([gate, pass ? 'PASS' : 'FAIL', pts, max, ev]);
const hasHtml = fs.existsSync(html);

// verify + audio: pass = exit 0
for (const [k, f] of [['verify16', '16x9'], ['verify9', '9x16']]) {
  const r = hasHtml ? run('verify.mjs', [html, '--format', f]) : { ok: false, out: 'index.html missing' };
  add(`verify ${f}`, r.ok, r.ok ? W[k] : 0, W[k], lastLine(r.out));
}
const au = hasHtml ? run('audio.mjs', [html, '--twice', '--out', path.join('out', 'bench-score.wav')]) : { ok: false, out: 'index.html missing' };
add('audio --twice', au.ok, au.ok ? W.audio : 0, W.audio, au.out.includes('twice:') ? lastLine(au.out.split('\n').filter(l => /twice|FAIL/.test(l)).join('\n')) : lastLine(au.out));

// lint: parse the JSON, count FAIL and WARN checks across both formats
const lintJson = path.join(work, 'score-lint.json');
let lint = null, duration = null;
if (hasHtml) { if (fs.existsSync(lintJson)) fs.rmSync(lintJson); run('lint.mjs', [html, '--all-formats', '--json', lintJson]); }
if (fs.existsSync(lintJson)) lint = JSON.parse(fs.readFileSync(lintJson, 'utf8')).results;
const count = s => lint ? lint.reduce((n, r) => n + r.checks.filter(c => c.status === s).length, 0) : null;
const nFail = count('FAIL'), nWarn = count('WARN');
const failIds = lint ? lint.flatMap(r => r.checks.filter(c => c.status === 'FAIL').map(c => `${r.format} ${c.id}`)) : [];
const warnIds = lint ? lint.flatMap(r => r.checks.filter(c => c.status === 'WARN').map(c => `${r.format} ${c.id}`)) : [];
add('lint 0 FAIL', nFail === 0, nFail === 0 ? W.lintNoFail : 0, W.lintNoFail, lint ? `${nFail} FAIL${failIds.length ? ': ' + failIds.join(', ') : ''}` : 'lint did not run');
const warnPts = lint ? Math.max(0, W.lintWarns - WARN_COST * nWarn) : 0;
add('lint WARN', lint && nWarn === 0, warnPts, W.lintWarns, lint ? `${nWarn} WARN${warnIds.length ? ': ' + warnIds.join(', ') : ''}` : 'lint did not run');
if (lint) duration = lint[0].duration;

// review --check. The Definition of done writes REVIEW.md under out/review-<fmt>/, a tool may put it in the work
// folder instead, so accept any REVIEW.md whose film header points at this work; one per format must pass.
const found = [];
const walk = d => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name);
  if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') walk(p); else if (e.name === 'REVIEW.md') found.push(p); } };
walk(work); walk(path.join(ROOT, 'out'));
const reviews = found.map(p => {
  const md = fs.readFileSync(p, 'utf8'), film = (md.match(/<!-- film: (.+?) -->/) || [])[1];
  const fmt = (md.match(/^# Review: .*\((\w+)\)/m) || [])[1];
  return { p, fmt, film: film && path.resolve(path.dirname(p), film) };
}).filter(r => r.film === html);
if (a.brief && !fs.existsSync(a.brief)) { console.log(`brief not found: ${a.brief}`); process.exit(0); }
// a brief with an accuracy checklist makes it mandatory in REVIEW.md: every item verdicted correct, with a citation
const checklist = a.brief && /^## Accuracy checklist/im.test(fs.readFileSync(a.brief, 'utf8')) ? ['--checklist', path.resolve(a.brief)] : [];
for (const [k, f] of [['review16', '16x9'], ['review9', '9x16']]) {
  const mine = reviews.filter(r => r.fmt === f);
  const res = mine.map(r => ({ r, c: run('review.mjs', ['--check', r.p, ...checklist]) }));
  const ok = res.find(x => x.c.ok);
  const ev = !mine.length ? `no REVIEW.md for ${f} found` : `${rel((ok || res[0]).r.p)}: ${lastLine((ok || res[0]).c.out)}`;
  add(`review --check ${f}`, !!ok, ok ? W[k] : 0, W[k], ev);
}

// STORYBOARD + duration range from the brief
const sb = fs.existsSync(path.join(work, 'STORYBOARD.md'));
add('STORYBOARD.md', sb, sb ? W.storyboard : 0, W.storyboard, sb ? 'present' : 'missing');
let range = null;
if (a.brief) { const m = fs.readFileSync(a.brief, 'utf8').match(/Duration:\**\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s/i); if (m) range = [+m[1], +m[2]]; }
const inRange = range && duration != null && duration >= range[0] && duration <= range[1];
add('duration in brief range', !!inRange, inRange ? W.duration : 0, W.duration,
  `${duration ?? '?'} s vs ${range ? range.join('-') + ' s' : 'no --brief range'}`);

// ====================================================================================================
// Report
// ====================================================================================================
const total = rows.reduce((n, r) => n + r[2], 0);
console.log(`\nbench score  ${rel(work)}${a.brief ? '  (brief ' + a.brief + ')' : ''}`);
console.log('| gate | status | points | evidence |\n|---|---|---|---|');
for (const [g, s, p, m, ev] of rows) console.log(`| ${g} | ${s} | ${p}/${m} | ${String(ev).replace(/\|/g, '/')} |`);
console.log(`| **total** | | **${total}/100** | lint ${nFail ?? '?'} FAIL, ${nWarn ?? '?'} WARN |`);
fs.writeFileSync(path.join(work, 'score.json'), JSON.stringify({
  work, brief: a.brief || null, total, duration, range, lint: { fail: nFail, warn: nWarn, failIds, warnIds },
  gates: rows.map(([gate, status, points, max, evidence]) => ({ gate, status, points, max, evidence })),
}, null, 2));
console.log(`wrote ${path.join(work, 'score.json')}`);
process.exit(0);
