import { createHash, createPublicKey, verify } from 'node:crypto';
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assessOperations, alertConfig, sendBackupAlert } from './backup-operations.mjs';
import { readOnlyR2Audit } from './backup-remote-audit.mjs';
const check=(v,m='Invalid backup monitor evidence')=>{if(!v)throw Error(m)};
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const hour=3600000;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const maxEvidenceBytes=2*1024*1024;
// The observer key must be held outside the backup writer. The observer signs
// only independently checked journal/inventory evidence, never user content.
// A missing or stale snapshot is a failure, not a successful cron execution.
export function verifyObservation({envelope,observerPublicKey,observerFingerprint,writerFingerprint,recoveryFingerprint,nowMs}){
  check(safe(nowMs)&&[observerFingerprint,writerFingerprint,recoveryFingerprint].every(sha)&&
    new Set([observerFingerprint,writerFingerprint,recoveryFingerprint]).size===3);
  const key=createPublicKey(observerPublicKey);
  check(key.asymmetricKeyType==='ed25519'&&createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex')===observerFingerprint);
  check(envelope&&Object.keys(envelope).length===2&&typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature));
  const data=envelope.data;
  check(data&&data.version===1&&data.scope==='production'&&safe(data.observedAtMs)&&data.observedAtMs<=nowMs&&nowMs-data.observedAtMs<=2*hour);
  check(verify(null,Buffer.from(JSON.stringify(data)),key,Buffer.from(envelope.signature,'base64')));
  return data;
}
export function evaluateMonitor({nowMs,envelope,observerPublicKey,observerFingerprint,writerFingerprint,recoveryPublicKey,recoveryFingerprint}){
  const data=verifyObservation({envelope,observerPublicKey,observerFingerprint,writerFingerprint,recoveryFingerprint,nowMs});
  const result=assessOperations({nowMs,records:data.records,receipts:data.receipts,publicKey:recoveryPublicKey,
    expectedFingerprint:recoveryFingerprint,writerFingerprint,inventoryComplete:data.inventoryComplete,
    failedAttempt:data.failedAttempt,scheduleApproved:data.scheduleApproved,sourceFenceVerified:data.sourceFenceVerified});
  check(safe(data.storedBytes)&&safe(data.budgetBytes)&&data.budgetBytes>0&&data.budgetBytes<=8000000000);
  const issues=[...result.issues];
  if(data.storedBytes>=data.budgetBytes)issues.push('backup_capacity_exceeded');
  else if(BigInt(data.storedBytes)*100n>=BigInt(data.budgetBytes)*80n)issues.push('backup_capacity_warning');
  return {...result,healthy:issues.length===0,scheduleEligible:result.scheduleEligible&&issues.length===0,issues,
    retentionReviewCandidates:issues.length===0?result.retentionReviewCandidates:[]};
}
async function readEvidence(path){
  check(typeof path==='string'&&path.startsWith('/run/vanta-backup-monitor/'),'Dedicated evidence mount required');
  const s=await lstat(path);check(s.isFile()&&s.size>0&&s.size<=maxEvidenceBytes&&(s.mode&0o022)===0);
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const b=Buffer.alloc(maxEvidenceBytes+1);
    let n=0;
    while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}
    check(n>0&&n<=maxEvidenceBytes&&n===s.size);
    return JSON.parse(b.subarray(0,n).toString('utf8'));
  }finally{await fd.close();}
}
export async function runMonitor({env,read=readEvidence,nowMs=Date.now(),notify=sendBackupAlert,remoteAudit=readOnlyR2Audit}){
  // No production database, R2 write credentials or age identity is required.
  // No activation from ordinary app startup. Separate monitor service only.
  check(env.VANTA_BACKUP_MONITOR_ENABLED==='yes','Backup monitor not enabled');
  const config=alertConfig(env);
  check(config,'Backup monitor requires alert configuration');
  let result;
  try{
    const envelope=await read(env.VANTA_BACKUP_MONITOR_EVIDENCE_PATH);
    const args={nowMs,envelope,observerPublicKey:env.VANTA_BACKUP_OBSERVER_PUBLIC_KEY,observerFingerprint:env.VANTA_BACKUP_OBSERVER_FINGERPRINT,
      writerFingerprint:env.VANTA_BACKUP_SIGNING_PUBLIC_FINGERPRINT,recoveryPublicKey:env.VANTA_BACKUP_RECOVERY_PUBLIC_KEY,
      recoveryFingerprint:env.VANTA_BACKUP_RECOVERY_FINGERPRINT};
    const observation=verifyObservation(args);
    result=evaluateMonitor(args);
    try{
      const live=await remoteAudit({env,records:observation.records});
      check(live.inventoryComplete===true&&safe(live.storedBytes));
      const issues=new Set(result.issues);
      if(live.storedBytes>=observation.budgetBytes)issues.add('backup_capacity_exceeded');
      else if(BigInt(live.storedBytes)*100n>=BigInt(observation.budgetBytes)*80n)issues.add('backup_capacity_warning');
      result={...result,healthy:issues.size===0,scheduleEligible:result.scheduleEligible&&issues.size===0,
        issues:[...issues],retentionReviewCandidates:issues.size===0?result.retentionReviewCandidates:[]};
    }catch{
      result={...result,healthy:false,scheduleEligible:false,issues:[...new Set([...result.issues,'backup_remote_inventory_invalid'])],retentionReviewCandidates:[]};
    }
  }catch{result={healthy:false,scheduleEligible:false,issues:['backup_monitor_evidence_invalid'],retentionReviewCandidates:[]};}
  if(!result.healthy)await notify({config,issues:result.issues});
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const result=await runMonitor({env:process.env});
    console.log('[VANTA BACKUP MONITOR] '+JSON.stringify({healthy:result.healthy,issues:result.issues}));
    if(!result.healthy)process.exitCode=1;
  }catch{console.error('[VANTA BACKUP MONITOR] execution_or_alert_failed');process.exitCode=1;}
}
