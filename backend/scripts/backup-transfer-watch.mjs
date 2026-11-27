import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { measureR2Inventory } from './backup-operational-adapters.mjs';
import { backupPrefix } from './backup-r2-multipart.mjs';
import { alertConfig, sendBackupAlert } from './backup-operations.mjs';

const kinds=['database.dump.age','media.tar.age','manifest.json.age'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const check=v=>{if(!v)throw Error('Transfer watch inventory invalid');};

// Limited read-only availability watch. No writer journal or signing keys.
// R2 metadata is not trusted recovery evidence; never grants schedule eligibility.
export async function inspectTransfers({client,sdk,baselineRunId,nowMs=Date.now(),budgetBytes=8000000000}){
  check(uuid.test(baselineRunId)&&Number.isSafeInteger(nowMs)&&nowMs>0&&Number.isSafeInteger(budgetBytes)&&budgetBytes>0&&budgetBytes<=8000000000);
  const inventory=await measureR2Inventory({client,sdk,bucket:'vanta-backups',maxPages:10,includeObjects:true});
  const sets=new Map();
  for(const [key,size] of inventory.objects){
    if(!key.startsWith('production/'))continue;
    const [,version,id,kind,...rest]=key.split('/');
    check(version==='v1'&&uuid.test(id)&&kinds.includes(kind)&&!rest.length&&size>0&&size<=(kind==='manifest.json.age'?65536:10*1024**3));
    if(!sets.has(id))sets.set(id,new Map());
    sets.get(id).set(kind,size);
  }
  check(sets.size<=100&&sets.has(baselineRunId));
  let lastTransferMs=0;
  const send=cmd=>client.send(cmd,{abortSignal:AbortSignal.timeout(30000)});
  for(const [id,files] of sets){
    check(files.size===kinds.length);
    const prefix=backupPrefix('production',id);
    let marker;
    for(const kind of kinds){
      const h=await send(new sdk.HeadObjectCommand({Bucket:'vanta-backups',Key:prefix+kind}));
      const at=h.LastModified?.getTime();
      check(h.ContentLength===files.get(kind)&&h.Metadata?.['test-id']===id&&digest.test(h.Metadata?.sha256||'')&&Number.isSafeInteger(at)&&at>0&&at<=nowMs);
      if(kind==='manifest.json.age'){marker=h;lastTransferMs=Math.max(lastTransferMs,at);}
    }
    const response=await send(new sdk.GetObjectCommand({Bucket:'vanta-backups',Key:prefix+'manifest.json.age'}));
    try{
      check(response.ContentLength===marker.ContentLength&&response.Metadata?.sha256===marker.Metadata.sha256&&response.Metadata?.['test-id']===id);
      const hash=createHash('sha256');let count=0;
      for await(const chunk of response.Body){count+=chunk.length;check(count<=marker.ContentLength);hash.update(chunk);}
      check(count===marker.ContentLength&&hash.digest('hex')===marker.Metadata.sha256);
    }finally{response.Body?.destroy?.();}
  }
  const issues=[];
  // Transfer completion age is only a proxy, not authenticated capture freshness.
  if(nowMs-lastTransferMs>=26*3600000)issues.push('verified_backup_missing_or_overdue');
  if(inventory.storedBytes>=budgetBytes)issues.push('backup_capacity_exceeded');
  else if(BigInt(inventory.storedBytes)*100n>=BigInt(budgetBytes)*80n)issues.push('backup_capacity_warning');
  return {scope:'remote_transfer_watch_only',available:issues.length===0,issues,sets:sets.size,storedBytes:inventory.storedBytes,lastTransferMs,scheduleEligible:false,independentRestoreVerified:false};
}

export async function runTransferWatch({env,nowMs=Date.now(),notify=sendBackupAlert,inspect=inspectTransfers,makeClient}){
  check(env.VANTA_BACKUP_TRANSFER_WATCH_ENABLED==='yes'&&env.VANTA_BACKUP_R2_BUCKET==='vanta-backups'&&/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/i.test(env.VANTA_BACKUP_R2_ENDPOINT||''));
  check(env.VANTA_BACKUP_MONITOR_R2_ACCESS_KEY_ID&&env.VANTA_BACKUP_MONITOR_R2_SECRET_ACCESS_KEY&&!env.VANTA_BACKUP_R2_ACCESS_KEY_ID&&!env.VANTA_BACKUP_R2_SECRET_ACCESS_KEY&&!env.DATABASE_URL&&!env.VANTA_BACKUP_SIGNING_PRIVATE_KEY);
  const config=alertConfig(env);check(config);
  const build=makeClient??(()=>{
    const require=createRequire(new URL('../backup-runtime/package.json',import.meta.url)),sdk=require('@aws-sdk/client-s3');
    return {sdk,client:new sdk.S3Client({region:'auto',endpoint:env.VANTA_BACKUP_R2_ENDPOINT,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:env.VANTA_BACKUP_MONITOR_R2_ACCESS_KEY_ID,secretAccessKey:env.VANTA_BACKUP_MONITOR_R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'})};
  });
  let result,client;
  try{
    const x=build();client=x.client;
    result=await inspect({client,sdk:x.sdk,baselineRunId:env.VANTA_BACKUP_BASELINE_RUN_ID,nowMs});
  }catch{result={scope:'remote_transfer_watch_only',available:false,issues:['backup_remote_inventory_invalid'],scheduleEligible:false,independentRestoreVerified:false};}
  finally{client?.destroy();}
  if(!result.available)await notify({config,issues:result.issues});
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  // Hard upper bound even if a provider response stream stalls.
  const timer=setTimeout(()=>{console.error('[VANTA TRANSFER WATCH] deadline');process.exit(1);},240000);
  try{
    const result=await runTransferWatch({env:process.env});
    console.log('[VANTA TRANSFER WATCH] '+JSON.stringify(result));
    if(!result.available)process.exitCode=1;
  }catch{console.error('[VANTA TRANSFER WATCH] configuration_or_alert_failed');process.exitCode=1;}
  finally{clearTimeout(timer);}
}
