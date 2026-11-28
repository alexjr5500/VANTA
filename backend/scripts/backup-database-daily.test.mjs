import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,createHash } from 'node:crypto';
import { dailyRunId,signDatabaseMarker,verifyDatabaseMarker,runDailyDatabase,databaseConfig } from './backup-database-daily.mjs';
import { backupPrefix,verifiedBackupSet } from './backup-r2-multipart.mjs';
const nowMs=1800000000000,id=dailyRunId(nowMs),prefix=backupPrefix('production-db',id),sha='a'.repeat(64),artifact={key:prefix+'database.dump.age',bytes:200,sha256:sha,verified:true};
test('deterministic UTC day, separated namespace, and disabled default',()=>{
 assert.equal(dailyRunId(nowMs+1000),id);assert.notEqual(dailyRunId(nowMs+86400000),id);assert.match(prefix,/^production-db\/v1\//);
 assert.throws(()=>databaseConfig({}));assert.throws(()=>verifiedBackupSet(artifact,{...artifact,key:prefix+'media.tar.age'},id,'production-db'));
});
test('signed database-only marker rejects altered media claim, wrong run or key',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const fingerprint=createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex');
 const bytes=signDatabaseMarker({artifact,runId:id,capturedAtMs:nowMs,privateKey:privateKey.export({format:'pem',type:'pkcs8'})});
 const params={bytes,publicKey:publicKey.export({format:'pem',type:'spki'}),fingerprint,runId:id};
 assert.equal(verifyDatabaseMarker(params).mediaIncluded,false);
 const e=JSON.parse(bytes);e.data.mediaIncluded=true;assert.throws(()=>verifyDatabaseMarker({...params,bytes:Buffer.from(JSON.stringify(e))}));assert.throws(()=>verifyDatabaseMarker({...params,runId:dailyRunId(nowMs+86400000)}));assert.throws(()=>verifyDatabaseMarker({...params,fingerprint:sha}));
});
function fixture({orphan=false,fail=false,previous=null,over=false,unresolved=false}={}){
 const events=[],objects=new Map(orphan?[[prefix+'database.dump.age',200]]:previous?[[prefix+'database.dump.age',200],[prefix+'manifest.json.age',300]]:[]);
 const args={nowMs,limit:1024**2,budget:8000000000,adapters:{
 acquire:async()=>({healthy:async()=>true,release:async()=>events.push('release')}),
 inventory:async()=>({inventoryComplete:true,incompleteUploadBytes:0,storedBytes:over?8000000000:200,scratchFreeBytes:1024**3,unresolvedAttempt:unresolved,objects}),
 previous:async()=>previous,begin:async()=>events.push('begin'),capture:async()=>{events.push('capture');return {path:'db',bytes:200}},
 upload:async(kind)=>{events.push(kind);if(fail)throw Error('secret');return kind==='database.dump.age'?artifact:{key:prefix+kind,sha256:sha,bytes:300,verified:true}},
 marker:async()=>{events.push('sign');return 'marker'},record:async()=>events.push('record'),fail:async(_,p)=>events.push('failed:'+p)
 }};
 return {args,events};
}
test('database capture publishes marker last and never asserts full restore',async()=>{const {args,events}=fixture();const r=await runDailyDatabase(args);assert.equal(r.databaseOnly,true);assert.equal(r.independentRestoreVerified,false);assert.deepEqual(events,['begin','capture','database.dump.age','sign','manifest.json.age','record','release']);});
test('same-day verified attempt skips, orphan/capacity/unfinished attempt block before capture',async()=>{const x=fixture({previous:{runId:id,state:'transfer_verified'}});assert.equal((await runDailyDatabase(x.args)).skipped,true);assert.deepEqual(x.events,['release']);for(const opts of [{orphan:true},{over:true},{unresolved:true}]){const f=fixture(opts);await assert.rejects(runDailyDatabase(f.args));assert.deepEqual(f.events,['release']);}});
test('failed transfer journals failure and does not publish marker',async()=>{const {args,events}=fixture({fail:true});await assert.rejects(runDailyDatabase(args),/failed at upload/);assert.deepEqual(events,['begin','capture','database.dump.age','failed:upload','release']);});
