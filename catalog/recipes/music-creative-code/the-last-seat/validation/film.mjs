import assert from 'node:assert/strict';
import {readFileSync, statSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const contract=JSON.parse(readFileSync('fixtures/contract.json','utf8'));
for (const p of ['index.html','film.mp4','player.html','contact.png','README.md','evidence.json']) {
  assert(statSync(p).isFile() && statSync(p).size>0,p+' missing or empty');
}
assert.equal(readFileSync('index.html','utf8'),readFileSync('fixtures/player.html','utf8'),'Use supplied player unchanged');
assert(statSync('source').isDirectory() && readdirSync('source').length>0,'Preserve rebuild source');
assert.equal(readFileSync('contact.png').subarray(0,8).toString('hex'),'89504e470d0a1a0a','PNG contact sheet');
const evidence=JSON.parse(readFileSync('evidence.json','utf8'));
assert(Array.isArray(evidence.beats),'evidence.beats array');
for(const beat of contract.beats){
 const items=evidence.beats.filter(b=>b.id===beat.id);
 assert.equal(items.length,1,'One evidence time for '+beat.id);
 assert(Number.isFinite(items[0].time) && items[0].time>=beat.start && items[0].time<=beat.end,'Beat window: '+beat.id);
}
assert(Array.isArray(evidence.checks) && evidence.checks.length>0,'Record checks actually attempted');
for(const c of evidence.checks){assert(typeof c.name==='string' && c.name.trim());assert(['passed','failed','not-run'].includes(c.result));assert(typeof c.detail==='string' && c.detail.trim());}
const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json','film.mp4'],{encoding:'utf8',timeout:30000,maxBuffer:1048576});
assert.equal(probe.status,0,probe.stderr || probe.error?.message);
const p=JSON.parse(probe.stdout),v=p.streams.find(s=>s.codec_type==='video'),a=p.streams.find(s=>s.codec_type==='audio');
assert(v && a,'Video and soundtrack required');
assert.equal(v.codec_name,'h264');assert.equal(a.codec_name,'aac');
assert.equal(v.width,contract.width);assert.equal(v.height,contract.height);
const [n,d]=v.avg_frame_rate.split('/').map(Number);assert.equal(n/d,contract.fps);
assert.equal(Number(v.nb_frames),contract.frames);
assert(Math.abs(Number(v.duration)-contract.duration)<0.05,'Video duration');
assert(Math.abs(Number(a.duration)-contract.duration)<0.1,'Audio duration');
assert(Math.abs(Number(p.format.duration)-contract.duration)<0.1,'Container duration');
if(contract.stateFixture){
 const states=JSON.parse(readFileSync(contract.stateFixture,'utf8'));
 const {stateAt}=await import(pathToFileURL(resolve('source/state.mjs')));
 assert.equal(typeof stateAt,'function','Export stateAt(t)');
 const times=[0,...states.flatMap(s=>[s.t,Math.min(s.t+0.001,contract.duration-0.001)]),...states.slice(1).map(s=>s.t-0.001),contract.duration-0.001].reverse();
 for(const t of times){const {t:_,...expected}=states.findLast(s=>s.t<=t);assert.deepEqual(stateAt(t),expected,'Queue state at '+t);}
}
console.log('PASS: delivery, encoding, beat-report shape and any supplied state contract. Beat times and check claims are self-reports; visual accuracy, motion, listening, originality, full decode and connection of state to the visible film require independent review.');
