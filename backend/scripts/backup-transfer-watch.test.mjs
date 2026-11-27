import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectTransfers,runTransferWatch} from './backup-transfer-watch.mjs';
const id='61f85a7f-7789-4a79-9063-d7351db8fbcd',prefix='production/v1/'+id+'/',now=1800000000000;
const marker=Buffer.from('age-encryption.org/v1\nfixture');
const sha=createHash('sha256').update(marker).digest('hex');
const sdk=Object.fromEntries(['ListObjectsV2Command','ListMultipartUploadsCommand','HeadObjectCommand','GetObjectCommand'].map(k=>[k,class{constructor(input){this.kind=k;this.input=input}}]));
function fixture({missing=false,corrupt=false,stale=false,partial=false,budget=0}={}){
 const entries=[{Key:prefix+'database.dump.age',Size:1000},{Key:prefix+'media.tar.age',Size:2000},{Key:prefix+'manifest.json.age',Size:marker.length}].filter(e=>!missing||!e.Key.endsWith('media.tar.age'));
 if(budget)entries.push({Key:'acceptance/fixture',Size:budget});
 const metadata={'test-id':id,sha256:sha};
 const client={async send(c){
  if(c.kind==='ListObjectsV2Command')return {Contents:entries,IsTruncated:false};
  if(c.kind==='ListMultipartUploadsCommand')return {Uploads:partial?[{Key:'x'}]:[]};
  if(c.kind==='HeadObjectCommand')return {ContentLength:entries.find(e=>e.Key===c.input.Key).Size,Metadata:metadata,LastModified:new Date(now-(stale?27*3600000:1000))};
  if(c.kind==='GetObjectCommand')return {ContentLength:marker.length,Metadata:metadata,Body:[corrupt?Buffer.alloc(marker.length):marker]};
  throw Error('unexpected command');
 }};
 return {client,sdk,baselineRunId:id,nowMs:now};
}
test('complete transfer is availability only, never a recovery receipt or schedule authorization',async()=>{const r=await inspectTransfers(fixture());assert.equal(r.available,true);assert.equal(r.scheduleEligible,false);assert.equal(r.independentRestoreVerified,false);});
test('missing, corrupt, partial and unexpected baseline fail closed',async()=>{for(const opts of [{missing:true},{corrupt:true},{partial:true}])await assert.rejects(inspectTransfers(fixture(opts)));await assert.rejects(inspectTransfers({...fixture(),baselineRunId:'93d60978-f403-4820-a5ce-a5b6df678a8e'}));});
test('overdue and capacity thresholds alert',async()=>{const r=await inspectTransfers(fixture({stale:true,budget:6500000000}));assert.deepEqual(r.issues,['verified_backup_missing_or_overdue','backup_capacity_warning']);});
const env={VANTA_BACKUP_TRANSFER_WATCH_ENABLED:'yes',VANTA_BACKUP_R2_BUCKET:'vanta-backups',VANTA_BACKUP_R2_ENDPOINT:'https://'+('a'.repeat(32))+'.r2.cloudflarestorage.com',VANTA_BACKUP_MONITOR_R2_ACCESS_KEY_ID:'test',VANTA_BACKUP_MONITOR_R2_SECRET_ACCESS_KEY:'test',VANTA_BACKUP_ALERTS_ENABLED:'yes',VANTA_BACKUP_ALERT_SENDGRID_KEY:'SG.fixture',VANTA_BACKUP_ALERT_FROM:'from@example.com',VANTA_BACKUP_ALERT_TO:'to@example.com',VANTA_BACKUP_BASELINE_RUN_ID:id};
test('provider failure sends sanitized alert and releases client; writer/db credentials rejected',async()=>{let sent,destroyed=false;const r=await runTransferWatch({env,inspect:async()=>{throw Error('private')},makeClient:()=>({client:{destroy(){destroyed=true}},sdk}),notify:async x=>{sent=x.issues}});assert.equal(destroyed,true);assert.equal(r.available,false);assert.deepEqual(sent,['backup_remote_inventory_invalid']);await assert.rejects(runTransferWatch({env:{...env,DATABASE_URL:'forbidden'}}));await assert.rejects(runTransferWatch({env:{...env,VANTA_BACKUP_R2_SECRET_ACCESS_KEY:'forbidden'}}));});
