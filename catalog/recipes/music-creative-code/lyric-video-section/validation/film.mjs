import assert from 'node:assert/strict';
import {readFileSync, statSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const contract=JSON.parse(readFileSync('fixtures/contract.json','utf8'));
const lyrics=JSON.parse(readFileSync(contract.lyricsFixture,'utf8'));
const words=lyrics.lines.flatMap(line=>line.words);
const run=(argv,label)=>{const r=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',timeout:180000,maxBuffer:4194304});assert.equal(r.status,0,label+': '+(r.stderr||r.error?.message));return r;};
for (const p of ['index.html','film.mp4','player.html','contact.png','README.md','evidence.json']) {
  assert(statSync(p).isFile() && statSync(p).size>0,p+' missing or empty');
}
assert.equal(readFileSync('index.html','utf8'),readFileSync('fixtures/player.html','utf8'),'Use supplied player unchanged');
assert(statSync('source').isDirectory() && readdirSync('source').length>0,'Preserve rebuild source');
assert.equal(readFileSync('contact.png').subarray(0,8).toString('hex'),'89504e470d0a1a0a','PNG contact sheet');
const evidence=JSON.parse(readFileSync('evidence.json','utf8'));
assert(Array.isArray(evidence.words),'evidence.words array');
assert.equal(evidence.words.length,words.length,'One evidence entry per supplied word');
for(const [i,word] of words.entries()){
 const e=evidence.words[i];
 assert.equal(e.w,word.w,'Word order preserved at '+i);
 assert(Number.isFinite(e.shownAt),'shownAt for '+word.w);
 // A revision is allowed only when it is recorded with its reason; silent drift fails.
 if(Math.abs(e.shownAt-word.start)>0.05) assert(typeof e.revision==='string' && e.revision.trim(),'Unrecorded timing revision for '+word.w+' at index '+i);
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
const decode=run(['ffmpeg','-v','error','-xerror','-i','film.mp4','-f','null','-'],'full decode');
assert.equal(decode.stderr.trim(),'','Full decode reported errors: '+decode.stderr.trim().slice(0,400));
const ebur=spawnSync('ffmpeg',['-v','info','-i','film.mp4','-vn','-af','ebur128=peak=true','-f','null','-'],{encoding:'utf8',timeout:120000,maxBuffer:8388608});
assert.equal(ebur.status,0,'loudness measurement');
const peak=ebur.stderr.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
assert(peak!==undefined,'ebur128 summary missing');
assert(Number(peak)<=-0.1,'True peak '+peak+' dBTP clips; the supplied master must not be driven into clipping');
console.log('PASS: delivery, encoding, complete decode, true peak '+peak+' dBTP, and per-word evidence shape with recorded revisions. Whether the picture matches the sung words, how it looks in motion and how it sounds require human review; audio identity with the supplied excerpt is checked separately.');
