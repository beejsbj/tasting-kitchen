import assert from 'node:assert/strict';
import {readFileSync, statSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for (const p of ['index.html','film.mp4','player.html','contact.png','README.md']) {
  assert(statSync(p).isFile() && statSync(p).size > 0, p + ' missing or empty');
}
assert.equal(readFileSync('index.html','utf8'),readFileSync('fixtures/player.html','utf8'),'Use the supplied video player unchanged');
assert(statSync('source').isDirectory() && readdirSync('source').length > 0,'Preserve rebuild source');
assert.equal(readFileSync('contact.png').subarray(0,8).toString('hex'),'89504e470d0a1a0a','PNG contact sheet required');
const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json','film.mp4'],{encoding:'utf8',timeout:30000,maxBuffer:1048576});
assert.equal(probe.status,0,probe.stderr || probe.error?.message);
const p=JSON.parse(probe.stdout), v=p.streams.find(s=>s.codec_type==='video'), a=p.streams.find(s=>s.codec_type==='audio');
assert(v && a,'Video and synthesized soundtrack required');
assert.equal(v.codec_name,'h264'); assert.equal(a.codec_name,'aac');
assert.equal(v.width,1080); assert.equal(v.height,1920);
const [n,d]=v.avg_frame_rate.split('/').map(Number); assert.equal(n/d,24);
assert.equal(Number(v.nb_frames),576);
assert(Math.abs(Number(v.duration)-24)<0.05,'Video duration');
assert(Math.abs(Number(a.duration)-24)<0.1,'Audio duration');
assert(Math.abs(Number(p.format.duration)-24)<0.1,'Container duration');
console.log('PASS: player, files, encoded format, frame count and duration. Visual quality, code-only authorship, full decode and listening require separate evidence.');
