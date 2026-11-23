// Styleframes check, run from the delivery root with fixtures mounted: node validation/styleframes.mjs
// Part one: three PNG styleframes and three H.264 motion tests at the contract's format, and
// a rationale within its word limit. Part two (once film.mp4 exists): the styleframe
// taken is named. That the styleframes are unchanged since part one, three real directions,
// and that the film follows the one taken is left to tasting.
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const {styleframes:s}=JSON.parse(readFileSync('fixtures/contract.json','utf8'));
const run=(argv,label)=>{const r=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',timeout:120000,maxBuffer:4194304});assert.equal(r.status,0,label+': '+(r.stderr||r.error?.message));return r;};
const exists=p=>{try{return statSync(p).isFile()&&statSync(p).size>0;}catch{return false;}};
for(const id of s.ids){
 const png=s.directory+'/'+id+'.png',mp4=s.directory+'/'+id+'.mp4';
 assert(exists(png),png+' missing or empty');assert(exists(mp4),mp4+' missing or empty');
 const head=readFileSync(png).subarray(0,24);
 assert.equal(head.subarray(0,8).toString('hex'),'89504e470d0a1a0a',png+' is not a PNG');
 assert.equal(head.readUInt32BE(16),s.width,png+' width');assert.equal(head.readUInt32BE(20),s.height,png+' height');
 const still=run(['ffmpeg','-v','error','-xerror','-i',png,'-f','null','-'],'decode '+png);
 assert.equal(still.stderr.trim(),'',png+' decode reported errors');
 const v=JSON.parse(run(['ffprobe','-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=codec_name,width,height,avg_frame_rate,nb_read_frames','-of','json',mp4],'ffprobe '+mp4).stdout).streams[0];
 assert(v,mp4+' has no video');
 assert.equal(v.codec_name,'h264',mp4+' codec');assert.equal(v.width,s.width,mp4+' width');assert.equal(v.height,s.height,mp4+' height');
 const [n,d]=v.avg_frame_rate.split('/').map(Number);assert.equal(n/d,s.fps,mp4+' frame rate');
 assert.equal(Number(v.nb_read_frames),s.frames,mp4+' frame count');
 const decode=run(['ffmpeg','-v','error','-xerror','-i',mp4,'-f','null','-'],'decode '+mp4);
 assert.equal(decode.stderr.trim(),'',mp4+' decode reported errors');
}
assert(exists(s.notes),s.notes+' missing or empty');
const words=readFileSync(s.notes,'utf8').split(/\s+/u).filter(w=>/[\p{L}\p{N}]/u.test(w)).length;
assert(words<=s.maxNoteWords,s.notes+' is '+words+' words; keep it within '+s.maxNoteWords);
// Part two has begun once the film exists; evidence.json may already be there from part one.
let part='one';
if(exists('film.mp4')){
 part='two';
 const evidence=JSON.parse(readFileSync('evidence.json','utf8'));
 assert(s.ids.includes(evidence.chosen),'evidence.chosen must be one of '+s.ids.join(', '));
}
console.log('PASS: '+s.ids.length+' styleframes and motion tests at '+s.width+'x'+s.height+', rationale '+words+' words'+(part==='two'?', styleframe taken named':'')+'. Whether the three are distinct directions and unchanged since part one requires human review.');
