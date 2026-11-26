import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { measureR2Inventory } from './backup-operational-adapters.mjs';
import { backupPrefix, parseBackupManifest } from './backup-r2-multipart.mjs';
const check=(ok)=>{if(!ok)throw Error('Remote backup inventory requires reconciliation')};
const digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
// Independently read the actual bucket. No put/delete, no recovery identity,
// no source data, no metadata-only claim of restored database/media content.
export async function auditRemoteBackupSets({client,sdk,records,bucket='vanta-backups'}){
  check(Array.isArray(records)&&records.length<=10000);
  const observed=await measureR2Inventory({client,sdk,bucket,includeObjects:true});
  const expected=new Map();
  const send=cmd=>client.send(cmd,{abortSignal:AbortSignal.timeout(30000)});
  for(const record of records){
    check(record.scope==='production'&&record.state==='transfer_verified');
    const prefix=backupPrefix('production',record.runId);
    const manifest=parseBackupManifest(Buffer.from(JSON.stringify(record.manifest)),record.runId,'production');
    const marker=record.marker;
    check(marker?.key===prefix+'manifest.json.age'&&marker.verified===true&&digest(marker.sha256)&&
      Number.isSafeInteger(marker.bytes)&&marker.bytes>0&&marker.bytes<=65536);
    for(const artifact of [...manifest.artifacts,marker]){
      check(!expected.has(artifact.key)&&observed.objects.get(artifact.key)===artifact.bytes);
      expected.set(artifact.key,artifact);
      const h=await send(new sdk.HeadObjectCommand({Bucket:bucket,Key:artifact.key}));
      check(h.ContentLength===artifact.bytes&&h.Metadata?.sha256===artifact.sha256&&h.Metadata?.['test-id']===record.runId);
    }
    // Rehash the bounded encrypted commit marker itself; recovery receipts
    // bind this ciphertext to independent verification of both data artifacts.
    const response=await send(new sdk.GetObjectCommand({Bucket:bucket,Key:marker.key}));
    try{
      check(response.ContentLength===marker.bytes);
      const hash=createHash('sha256');let count=0;
      for await(const chunk of response.Body){count+=chunk.length;check(count<=marker.bytes);hash.update(chunk);}
      check(count===marker.bytes&&hash.digest('hex')===marker.sha256);
    }finally{response.Body?.destroy?.();}
  }
  for(const key of observed.objects.keys())if(key.startsWith('production/'))check(expected.has(key));
  return {storedBytes:observed.storedBytes,inventoryAtMs:observed.inventoryAtMs,inventoryComplete:true};
}
export async function readOnlyR2Audit({env,records}){
  check(/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/i.test(env.VANTA_BACKUP_R2_ENDPOINT||'')&&
    env.VANTA_BACKUP_R2_BUCKET==='vanta-backups'&&env.VANTA_BACKUP_MONITOR_R2_ACCESS_KEY_ID&&env.VANTA_BACKUP_MONITOR_R2_SECRET_ACCESS_KEY);
  // Reject accidental use of writer credentials. Provider permissions must
  // independently be limited to bucket-scoped read/list only.
  check(!env.VANTA_BACKUP_R2_ACCESS_KEY_ID&&!env.VANTA_BACKUP_R2_SECRET_ACCESS_KEY);
  const require=createRequire(new URL('../backup-runtime/package.json',import.meta.url));
  const sdk=require('@aws-sdk/client-s3');
  const client=new sdk.S3Client({region:'auto',endpoint:env.VANTA_BACKUP_R2_ENDPOINT,forcePathStyle:true,maxAttempts:1,
    credentials:{accessKeyId:env.VANTA_BACKUP_MONITOR_R2_ACCESS_KEY_ID,secretAccessKey:env.VANTA_BACKUP_MONITOR_R2_SECRET_ACCESS_KEY},
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  try{return await auditRemoteBackupSets({client,sdk,records});}finally{client.destroy();}
}
