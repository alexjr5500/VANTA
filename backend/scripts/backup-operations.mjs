import { createHash, createPublicKey, verify } from 'node:crypto';
import { backupHealth, retentionCandidates } from './backup-run-policy.mjs';
import { backupPrefix } from './backup-r2-multipart.mjs';
const check=(v,m='Invalid backup operations evidence')=>{if(!v)throw Error(m)};
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const issueCodes=new Set(['backup_attempt_failed','verified_backup_missing_or_overdue','independent_restore_missing_or_overdue','source_fence_not_verified','schedule_not_approved','retention_inventory_unverified','backup_monitor_evidence_invalid','backup_capacity_warning','backup_capacity_exceeded','backup_remote_inventory_invalid']);
export function productionIdentity(env){
  return env.RAILWAY_PROJECT_ID==='a05242c0-8a26-40b0-a88d-e338e96eec55' &&
    env.RAILWAY_ENVIRONMENT_ID==='4a6d43ce-571f-4d85-8abe-c7c5f19ed920' &&
    env.RAILWAY_SERVICE_ID==='c0231973-3822-4d57-b3d0-a5df671dfacf' &&
    env.RAILWAY_ENVIRONMENT_NAME==='production';
}
// Only a separately pinned recovery verifier can attest an independent restore.
// The writer's key must not be reused. The receipt binds to the exact encrypted marker.
export function verifyRestoreReceipt({receipt,publicKey,expectedFingerprint,writerFingerprint,record,nowMs}){
  check(safe(nowMs)&&hash(expectedFingerprint)&&hash(writerFingerprint)&&expectedFingerprint!==writerFingerprint);
  const key=createPublicKey(publicKey);
  check(key.asymmetricKeyType==='ed25519'&&createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex')===expectedFingerprint);
  check(receipt&&Object.keys(receipt).length===2&&typeof receipt.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(receipt.signature));
  const data=receipt.data;
  check(data&&Object.keys(data).length===7&&data.version===1&&data.scope==='production'&&data.runId===record.runId&&
    data.markerSha256===record.marker.sha256&&safe(data.restoredAtMs)&&data.restoredAtMs>=record.capturedAtMs&&data.restoredAtMs<=nowMs&&
    data.databaseValidated===true&&data.mediaValidated===true);
  check(verify(null,Buffer.from(JSON.stringify(data)),key,Buffer.from(receipt.signature,'base64')),'Restore receipt signature rejected');
  return data.restoredAtMs;
}
// Read-only control-plane decision. Caller must supply a complete trusted inventory
// of durable journal records and independently observed hold/lock evidence.
// A positive result is not a source fence, cron trigger, deletion or billing guarantee.
export function assessOperations({nowMs,records,receipts={},publicKey,expectedFingerprint,writerFingerprint,
  inventoryComplete=false,failedAttempt=false,scheduleApproved=false,sourceFenceVerified=false,retainDays=7,keepAtLeast=2}){
  check(safe(nowMs)&&Array.isArray(records)&&records.length<=10000);
  const ids=new Set();let lastVerifiedTransferMs,lastIndependentRestoreMs;const sets=[];
  let failed=failedAttempt!==false;
  for(const record of records){
    check(record&&record.scope==='production'&&!ids.has(record.runId));
    const prefix=backupPrefix('production',record.runId);ids.add(record.runId);
    check(['pending','failed','transfer_verified'].includes(record.state));
    if(record.state!=='transfer_verified'){failed=true;continue;}
    check(safe(record.capturedAtMs)&&safe(record.verifiedAtMs)&&record.capturedAtMs<=record.verifiedAtMs&&record.verifiedAtMs<=nowMs&&
      record.marker?.key===prefix+'manifest.json.age'&&record.marker.verified===true&&hash(record.marker.sha256)&&safe(record.marker.bytes)&&record.marker.bytes>0);
    // Measure recovery-point age, not time spent uploading the capture.
    lastVerifiedTransferMs=Math.max(lastVerifiedTransferMs??0,record.capturedAtMs);
    let restored=false;
    if(Object.hasOwn(receipts,record.runId)){
      const time=verifyRestoreReceipt({receipt:receipts[record.runId],publicKey,expectedFingerprint,writerFingerprint,record,nowMs});
      lastIndependentRestoreMs=Math.max(lastIndependentRestoreMs??0,time);restored=true;
    }
    sets.push({id:record.runId,createdAtMs:record.capturedAtMs,transferVerified:true,
      independentRestoreVerified:restored,provenanceVerified:restored,legalHold:record.legalHold,retentionLock:record.retentionLock});
  }
  const health=backupHealth({nowMs,lastVerifiedTransferMs,lastIndependentRestoreMs,failedAttempt:failed});
  const issues=[...health.issues];
  if(sourceFenceVerified!==true)issues.push('source_fence_not_verified');
  if(scheduleApproved!==true)issues.push('schedule_not_approved');
  if(inventoryComplete!==true)issues.push('retention_inventory_unverified');
  // Failed or incomplete inventory is never a reason to prune.
  const candidates=inventoryComplete===true&&!failed&&health.healthy&&scheduleApproved===true&&sourceFenceVerified===true?
    retentionCandidates({nowMs,sets,retainDays,keepAtLeast}):[];
  return {healthy:issues.length===0,scheduleEligible:issues.length===0,issues,retentionReviewCandidates:candidates,
    lastVerifiedTransferMs,lastIndependentRestoreMs};
}
const email=s=>typeof s==='string'&&s.length<=254&&/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(s);
// Opt-in transport with dedicated credentials; no arbitrary webhook destination.
export function alertConfig(env){
  if(env.VANTA_BACKUP_ALERTS_ENABLED!=='yes')return null;
  check(typeof env.VANTA_BACKUP_ALERT_SENDGRID_KEY==='string'&&env.VANTA_BACKUP_ALERT_SENDGRID_KEY.startsWith('SG.')&&
    email(env.VANTA_BACKUP_ALERT_FROM)&&email(env.VANTA_BACKUP_ALERT_TO),'Dedicated backup alert configuration required');
  return {apiKey:env.VANTA_BACKUP_ALERT_SENDGRID_KEY,from:env.VANTA_BACKUP_ALERT_FROM,to:env.VANTA_BACKUP_ALERT_TO};
}
export async function sendBackupAlert({config,issues,fetchImpl=fetch}){
  check(config&&Array.isArray(issues)&&issues.length>0&&issues.every(i=>issueCodes.has(i)),'Invalid backup alert');
  try{
    const res=await fetchImpl('https://api.sendgrid.com/v3/mail/send',{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},
      body:JSON.stringify({personalizations:[{to:[{email:config.to}]}],from:{email:config.from},
        subject:'VANTA backup requires attention',content:[{type:'text/plain',value:'Backup control status: '+[...new Set(issues)].join(', ')+'. Review the backup journal before retrying.'}]})});
    check(res.status===202,'Backup alert not accepted');
  }catch{throw Error('Backup alert delivery failed');}
  return true; // Provider accepted the request; this is not proof of inbox delivery.
}
