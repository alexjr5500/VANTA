import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {auditRemoteBackupSets} from './backup-remote-audit.mjs';
const runId=randomUUID(),prefix='production/v1/'+runId+'/',body=Buffer.from('synthetic encrypted marker');
const sha256=createHash('sha256').update(body).digest('hex');
const artifacts=['database.dump.age','media.tar.age'].map(kind=>({key:prefix+kind,bytes:100,sha256}));
const marker={key:prefix+'manifest.json.age',bytes:body.length,sha256,verified:true};
const record={scope:'production',state:'transfer_verified',runId,manifest:{version:1,runId,artifacts},marker};
const all=[...artifacts,marker];
const sdk=Object.fromEntries(['ListObjectsV2','ListMultipartUploads','HeadObject','GetObject'].map(n=>[n+'Command',class{constructor(input){this.name=n;this.input=input;}}]));
function fixture({objects=all,corrupt=false,badHead=false,incomplete=false}={}){
  return {send:async c=>{
    if(c.name==='ListObjectsV2')return {Contents:objects.map(a=>({Key:a.key,Size:a.bytes})),IsTruncated:false};
    if(c.name==='ListMultipartUploads')return {Uploads:incomplete?[{Key:'x'}]:[],IsTruncated:false};
    const a=all.find(x=>x.key===c.input.Key);
    if(c.name==='HeadObject')return {ContentLength:a.bytes,Metadata:{sha256:badHead?'bad':a.sha256,'test-id':runId}};
    if(c.name==='GetObject')return {ContentLength:a.bytes,Body:Readable.from([corrupt?Buffer.alloc(body.length):body])};
    throw Error('unexpected remote operation');
  }};
}
test('read-only inventory matches all three objects and hashes the encrypted marker',async()=>{
  const r=await auditRemoteBackupSets({client:fixture(),sdk,records:[record]});
  assert.equal(r.inventoryComplete,true);assert.equal(r.storedBytes,200+body.length);
});
test('fails closed on missing, orphaned, incomplete, mismatched or corrupted data',async()=>{
  for(const opts of [{objects:all.slice(1)},{objects:[...all,{key:prefix+'unexpected',bytes:1}]},{incomplete:true},{badHead:true},{corrupt:true}]){
    await assert.rejects(auditRemoteBackupSets({client:fixture(opts),sdk,records:[record]}));
  }
  await assert.rejects(auditRemoteBackupSets({client:fixture(),sdk,records:[]}));
});
