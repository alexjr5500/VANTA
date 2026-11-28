import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign,randomUUID} from 'node:crypto';
import {assessOperations,alertConfig,sendBackupAlert} from './backup-operations.mjs';
const nowMs=100*86400000;
const pair=generateKeyPairSync('ed25519'), publicKey=pair.publicKey.export({type:'spki',format:'pem'});
const expectedFingerprint=createHash('sha256').update(pair.publicKey.export({type:'spki',format:'der'})).digest('hex');
const writerFingerprint='f'.repeat(64);
const make=days=>{
  const runId=randomUUID(), capturedAtMs=nowMs-days*86400000;
  const record={scope:'production',runId,state:'transfer_verified',capturedAtMs,verifiedAtMs:capturedAtMs,
    marker:{key:'production/v1/'+runId+'/manifest.json.age',verified:true,sha256:'a'.repeat(64),bytes:100},legalHold:false,retentionLock:false};
  const data={version:1,scope:'production',runId,markerSha256:record.marker.sha256,restoredAtMs:nowMs,databaseValidated:true,mediaValidated:true};
  return {record,receipt:{data,signature:sign(null,Buffer.from(JSON.stringify(data)),pair.privateKey).toString('base64')}};
};
const inputs=(items)=>({nowMs,records:items.map(x=>x.record),receipts:Object.fromEntries(items.map(x=>[x.record.runId,x.receipt])),
  publicKey,expectedFingerprint,writerFingerprint,inventoryComplete:true,scheduleApproved:true,sourceFenceVerified:true});
test('requires independent signed receipts; protects two restored sets and unknown holds',()=>{
  const items=[make(0),make(8),make(9),make(10)];items[3].record.legalHold=undefined;
  const input=inputs(items), result=assessOperations(input);
  assert.equal(result.scheduleEligible,true);
  assert.deepEqual(result.retentionReviewCandidates,[items[2].record.runId]);
  assert.equal(assessOperations({...input,sourceFenceVerified:false}).scheduleEligible,false);
  assert.deepEqual(assessOperations({...input,inventoryComplete:false}).retentionReviewCandidates,[]);
  assert.equal(assessOperations({...input,receipts:{}}).healthy,false);
  assert.deepEqual(assessOperations({...input,failedAttempt:true}).retentionReviewCandidates,[]);
  assert.throws(()=>assessOperations({...input,writerFingerprint:expectedFingerprint}));
  assert.throws(()=>assessOperations({...input,receipts:{...input.receipts,[items[0].record.runId]:{...items[0].receipt,data:{...items[0].receipt.data,markerSha256:'b'.repeat(64)}}}}));
});
test('pending attempt and missing backup prevent scheduling',()=>{
  const item=make(0),input=inputs([item]);
  assert.equal(assessOperations({...input,records:[]}).scheduleEligible,false);
  assert.equal(assessOperations({...input,records:[item.record,{scope:'production',runId:randomUUID(),state:'pending'}]}).scheduleEligible,false);
});
test('alerts use bounded fixed endpoint, redacted issue codes and provider acceptance',async()=>{
  assert.equal(alertConfig({}),null);
  assert.throws(()=>alertConfig({VANTA_BACKUP_ALERTS_ENABLED:'yes'}));
  const config=alertConfig({VANTA_BACKUP_ALERTS_ENABLED:'yes',VANTA_BACKUP_ALERT_SENDGRID_KEY:'SG.synthetic',VANTA_BACKUP_ALERT_FROM:'backup@example.com',VANTA_BACKUP_ALERT_TO:'owner@example.com'});
  let calls=0;
  assert.equal(await sendBackupAlert({config,issues:['backup_attempt_failed'],fetchImpl:async(url,opts)=>{
    calls++;assert.equal(url,'https://api.sendgrid.com/v3/mail/send');assert.equal(opts.redirect,'error');
    assert.ok(!opts.body.includes(config.apiKey));return {status:202};
  }}),true);
  assert.equal(calls,1);
  await assert.rejects(sendBackupAlert({config,issues:['backup_attempt_failed'],fetchImpl:async()=>{throw Error('secret provider detail')}}),/^Error: Backup alert delivery failed$/);
  await assert.rejects(sendBackupAlert({config,issues:['raw secret error'],fetchImpl:async()=>{calls++;}}));
  assert.equal(calls,1);
});
