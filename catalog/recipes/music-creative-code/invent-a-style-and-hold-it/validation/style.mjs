// STYLE.md check, run from the delivery root with fixtures mounted: node validation/style.mjs
// The style needs a name as its first line (`# Name`) and exactly the contract's number of
// numbered rules, 1 to N in order. Whether the style is new, and whether every frame obeys
// its rules, is left to tasting; the hardest moment's time and note are checked by film.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {style}=JSON.parse(readFileSync('fixtures/contract.json','utf8'));
let text;
try{text=readFileSync(style.file,'utf8').replace(/^\uFEFF/u,'');}catch{assert.fail(style.file+' missing');}
const lines=text.split(/\r?\n/u),first=lines.find(l=>l.trim());
const name=/^#\s+(\S.*)$/u.exec(first??'')?.[1]?.trim();
assert(name,style.file+' must begin with the style\'s name as "# Name"');
const rules=lines.map(l=>/^\s*(\d+)[.)]\s+(\S.*)$/u.exec(l)).filter(Boolean);
assert.equal(rules.length,style.rules,style.file+' must hold exactly '+style.rules+' numbered rules; found '+rules.length);
rules.forEach((m,i)=>assert.equal(Number(m[1]),i+1,'Rules are numbered 1 to '+style.rules+' in order'));
console.log('PASS: '+style.file+' names "'+name+'" and states '+style.rules+' numbered rules. Whether the style is new and whether every frame obeys it require human review.');
