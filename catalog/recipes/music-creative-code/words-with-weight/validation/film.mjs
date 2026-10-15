import assert from 'node:assert/strict';
import {readFileSync, statSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const contract=JSON.parse(readFileSync('fixtures/contract.json','utf8'));
const run=(argv,label)=>{const r=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',timeout:120000,maxBuffer:4194304});assert.equal(r.status,0,label+': '+(r.stderr||r.error?.message));return r;};
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
const probe=run(['ffprobe','-v','error','-show_streams','-show_format','-of','json','film.mp4'],'ffprobe');
const p=JSON.parse(probe.stdout),v=p.streams.find(s=>s.codec_type==='video'),a=p.streams.find(s=>s.codec_type==='audio');
assert(v && a,'Video and soundtrack required');
assert.equal(v.codec_name,'h264');assert.equal(a.codec_name,'aac');
assert.equal(v.width,contract.width);assert.equal(v.height,contract.height);
const [n,d]=v.avg_frame_rate.split('/').map(Number);assert.equal(n/d,contract.fps);
assert.equal(Number(v.nb_frames),contract.frames);
assert(Math.abs(Number(v.duration)-contract.duration)<0.05,'Video duration');
assert(Math.abs(Number(a.duration)-contract.duration)<0.1,'Audio duration');
assert(Math.abs(Number(p.format.duration)-contract.duration)<0.1,'Container duration');
// Complete decode: a file that probes correctly can still fail partway through.
const decode=run(['ffmpeg','-v','error','-xerror','-i','film.mp4','-f','null','-'],'full decode');
assert.equal(decode.stderr.trim(),'','Full decode reported errors: '+decode.stderr.trim().slice(0,400));
// Loudness is reported for the review; clipping is a renderer defect and fails.
const ebur=spawnSync('ffmpeg',['-v','info','-i','film.mp4','-vn','-af','ebur128=peak=true','-f','null','-'],{encoding:'utf8',timeout:120000,maxBuffer:8388608});
assert.equal(ebur.status,0,'loudness measurement');
const integrated=ebur.stderr.match(/I:\s+(-?[\d.]+) LUFS/)?.[1], peak=ebur.stderr.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
assert(integrated!==undefined && peak!==undefined,'ebur128 summary missing');
assert(Number(peak)<=-0.1,'True peak '+peak+' dBTP clips; keep it at or below -0.1 dBTP');
if(contract.stateFixture){
 const states=JSON.parse(readFileSync(contract.stateFixture,'utf8'));
 const {stateAt}=await import(pathToFileURL(resolve('source/state.mjs')));
 assert.equal(typeof stateAt,'function','Export stateAt(t)');
 const times=[0,...states.flatMap(s=>[s.t,Math.min(s.t+0.001,contract.duration-0.001)]),...states.slice(1).map(s=>s.t-0.001),contract.duration-0.001].reverse();
 for(const t of times){const {t:_,...expected}=states.findLast(s=>s.t<=t);assert.deepEqual(stateAt(t),expected,'Queue state at '+t);}
}
console.log('PASS: delivery, encoding, complete decode, true peak '+peak+' dBTP, integrated loudness '+integrated+' LUFS, beat-report shape and any supplied state contract. Beat times and check claims are self-reports; visual accuracy, motion, listening, originality and connection of state to the visible film require independent review.');
