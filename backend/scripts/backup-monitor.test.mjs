import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { evaluateMonitor, runMonitor } from './backup-monitor.mjs';
const nowMs=100*86400000;
const observer=generateKeyPairSync('ed25519');
const observerPublicKey=observer.publicKey.export({type:'spki',format:'pem'});
const observerFingerprint=createHash('sha256').update(observer.publicKey.export({type:'spki',format:'der'})).digest('hex');
const writerFingerprint='a'.repeat(64), recoveryFingerprint='b'.repeat(64);
const base={version:1,scope:'production',observedAtMs:nowMs,records:[],receipts:{},
  inventoryComplete:true,failedAttempt:false,scheduleApproved:true,sourceFenceVerified:true,storedBytes:80,budgetBytes:100};
const signed=data=>({data,signature:sign(null,Buffer.from(JSON.stringify(data)),observer.privateKey).toString('base64')});
const input={nowMs,observerPublicKey,observerFingerprint,writerFingerprint,recoveryFingerprint};
test('signed observation reports missing backup and storage pressure, never authorizes schedule',()=>{
  const r=evaluateMonitor({...input,envelope:signed(base)});
  assert.equal(r.scheduleEligible,false);assert.ok(r.issues.includes('verified_backup_missing_or_overdue'));
  assert.ok(r.issues.includes('backup_capacity_warning'));assert.deepEqual(r.retentionReviewCandidates,[]);
  assert.ok(evaluateMonitor({...input,envelope:signed({...base,storedBytes:101})}).issues.includes('backup_capacity_exceeded'));
});
test('rejects tampered, stale and shared-key evidence',()=>{
  const envelope=signed(base);
  assert.throws(()=>evaluateMonitor({...input,envelope:{...envelope,data:{...base,storedBytes:0}}}));
  assert.throws(()=>evaluateMonitor({...input,envelope:signed({...base,observedAtMs:nowMs-7200001})}));
  assert.throws(()=>evaluateMonitor({...input,writerFingerprint:observerFingerprint,envelope}));
});
test('independent monitor alerts on unreadable evidence and refuses disabled execution',async()=>{
  const env={VANTA_BACKUP_MONITOR_ENABLED:'yes',VANTA_BACKUP_ALERTS_ENABLED:'yes',VANTA_BACKUP_ALERT_SENDGRID_KEY:'SG.synthetic',
    VANTA_BACKUP_ALERT_FROM:'backup@example.com',VANTA_BACKUP_ALERT_TO:'owner@example.com'};
  const issues=[];const r=await runMonitor({env,nowMs,read:async()=>{throw Error('private data')},notify:async x=>issues.push(...x.issues)});
  assert.equal(r.healthy,false);assert.deepEqual(issues,['backup_monitor_evidence_invalid']);
  await assert.rejects(runMonitor({env:{},notify:async()=>{throw Error('should not run')}}));
  await assert.rejects(runMonitor({env,read:async()=>{throw Error()},notify:async()=>{throw Error('delivery failure')}}));
});
