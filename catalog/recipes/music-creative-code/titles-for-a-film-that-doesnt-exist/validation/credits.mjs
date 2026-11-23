// Credits check, run from the delivery root with fixtures mounted: node validation/credits.mjs
// evidence.json must give on and off times for the title and every supplied credit, each
// inside the film and on screen for at least the contract's minimum. The times are the
// model's own report: whether each credit is really shown, spelled as given and readable
// is left to tasting.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const contract=JSON.parse(readFileSync('fixtures/contract.json','utf8'));
const {fixture,minSeconds}=contract.credits;
const supplied=JSON.parse(readFileSync(fixture,'utf8'));
const ids=['title',...supplied.credits.map(c=>c.id)];
const evidence=JSON.parse(readFileSync('evidence.json','utf8'));
assert(Array.isArray(evidence.credits),'evidence.credits array');
for(const entry of evidence.credits) assert(ids.includes(entry?.id),'Unknown credit id in evidence: '+JSON.stringify(entry?.id));
for(const id of ids){
 const items=evidence.credits.filter(c=>c.id===id);
 assert.equal(items.length,1,'One on/off entry for '+id);
 const {on,off}=items[0];
 assert(Number.isFinite(on) && Number.isFinite(off) && on>=0 && off<=contract.duration && on<off,'Credit '+id+' needs 0 <= on < off <= '+contract.duration+' s');
 assert(off-on>=minSeconds-1e-9,'Credit '+id+' is on screen '+(off-on).toFixed(2)+' s; it needs at least '+minSeconds+' s');
}
assert(typeof evidence.intent==='string' && evidence.intent.trim(),'evidence.intent: one sentence naming the genre and tone meant');
console.log('PASS: on/off times for the title and '+supplied.credits.length+' credits, each at least '+minSeconds+' s inside the film, and a stated intent. Times are self-reports; that each credit is shown as given and readable requires human review.');
