// Film delivery check, generalised from the animation drafts' film.mjs: the same
// checks on every film the contract lists (`films`, default film.mp4) and the
// files it lists (`files`). Contract beats with windows are checked as before;
// without them, evidence.beats are the model's own pointers to the moments a
// taster should see, each inside the film.
// Run from the delivery root: node validation/film.mjs
import assert from 'node:assert/strict';
import {readFileSync, statSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const contract=JSON.parse(readFileSync('fixtures/contract.json','utf8'));
const films=contract.films??['film.mp4'];
const files=contract.files??['index.html','film.mp4','player.html','contact.png','README.md','evidence.json'];
const run=(argv,label)=>{const r=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',timeout:120000,maxBuffer:4194304});assert.equal(r.status,0,label+': '+(r.stderr||r.error?.message));return r;};
for (const p of new Set([...files,...films])) {
  assert(statSync(p).isFile() && statSync(p).size>0,p+' missing or empty');
}
if(files.includes('index.html')) assert.equal(readFileSync('index.html','utf8'),readFileSync('fixtures/player.html','utf8'),'Use supplied player unchanged');
assert(statSync('source').isDirectory() && readdirSync('source').length>0,'Preserve rebuild source');
assert.equal(readFileSync('contact.png').subarray(0,8).toString('hex'),'89504e470d0a1a0a','PNG contact sheet');
const evidence=JSON.parse(readFileSync('evidence.json','utf8'));
assert(Array.isArray(evidence.beats),'evidence.beats array');
if(contract.beats){
 for(const beat of contract.beats){
  const items=evidence.beats.filter(b=>b.id===beat.id);
  assert.equal(items.length,1,'One evidence time for '+beat.id);
  assert(Number.isFinite(items[0].time) && items[0].time>=beat.start && items[0].time<=beat.end,'Beat window: '+beat.id);
 }
}else{
 assert(evidence.beats.length>0,'Point to at least one moment in evidence.beats');
 assert.equal(new Set(evidence.beats.map(b=>b.id)).size,evidence.beats.length,'evidence.beats ids are unique');
 for(const b of evidence.beats){assert(typeof b.id==='string' && b.id.trim(),'Beat id');assert(Number.isFinite(b.time) && b.time>=0 && b.time<contract.duration,'Beat time inside the film: '+b.id);}
}
assert(Array.isArray(evidence.checks) && evidence.checks.length>0,'Record checks actually attempted');
for(const c of evidence.checks){assert(typeof c.name==='string' && c.name.trim());assert(['passed','failed','not-run'].includes(c.result));assert(typeof c.detail==='string' && c.detail.trim());}
const measured=[];
for(const film of films){
 const probe=run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',film],'ffprobe '+film);
 const p=JSON.parse(probe.stdout),v=p.streams.find(s=>s.codec_type==='video'),a=p.streams.find(s=>s.codec_type==='audio');
 assert(v && a,film+': video and soundtrack required');
 assert.equal(v.codec_name,'h264');assert.equal(a.codec_name,'aac');
 assert.equal(v.width,contract.width);assert.equal(v.height,contract.height);
 const [n,d]=v.avg_frame_rate.split('/').map(Number);assert.equal(n/d,contract.fps);
 assert.equal(Number(v.nb_frames),contract.frames,film+' frame count');
 assert(Math.abs(Number(v.duration)-contract.duration)<0.05,film+' video duration');
 assert(Math.abs(Number(a.duration)-contract.duration)<0.1,film+' audio duration');
 assert(Math.abs(Number(p.format.duration)-contract.duration)<0.1,film+' container duration');
 // Complete decode: a file that probes correctly can still fail partway through.
 const decode=run(['ffmpeg','-v','error','-xerror','-i',film,'-f','null','-'],'full decode '+film);
 assert.equal(decode.stderr.trim(),'',film+': full decode reported errors: '+decode.stderr.trim().slice(0,400));
 // Loudness is reported for the review; clipping is a renderer defect and fails.
 const ebur=spawnSync('ffmpeg',['-v','info','-i',film,'-vn','-af','ebur128=peak=true','-f','null','-'],{encoding:'utf8',timeout:120000,maxBuffer:8388608});
 assert.equal(ebur.status,0,'loudness measurement '+film);
 const integrated=ebur.stderr.match(/I:\s+(-?[\d.]+) LUFS/)?.[1], peak=ebur.stderr.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
 assert(integrated!==undefined && peak!==undefined,film+': ebur128 summary missing');
 assert(Number(peak)<=-0.1,film+': true peak '+peak+' dBTP clips; keep it at or below -0.1 dBTP');
 measured.push(film+' true peak '+peak+' dBTP, integrated loudness '+integrated+' LUFS');
}
if(contract.stateFixture){
 const states=JSON.parse(readFileSync(contract.stateFixture,'utf8'));
 const {stateAt}=await import(pathToFileURL(resolve('source/state.mjs')));
 assert.equal(typeof stateAt,'function','Export stateAt(t)');
 const times=[0,...states.flatMap(s=>[s.t,Math.min(s.t+0.001,contract.duration-0.001)]),...states.slice(1).map(s=>s.t-0.001),contract.duration-0.001].reverse();
 for(const t of times){const expected={...states.findLast(s=>s.t<=t)};delete expected.t;assert.deepEqual(stateAt(t),expected,'Queue state at '+t);}
}
console.log('PASS: delivery, encoding, complete decode, '+measured.join('; ')+', beat-report shape and any supplied state contract. Beat times and check claims are self-reports; visual accuracy, motion, listening, originality and connection of state to the visible film require independent review.');
