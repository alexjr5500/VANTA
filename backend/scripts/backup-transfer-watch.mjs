import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { measureR2Inventory } from './backup-operational-adapters.mjs';
import { mediaDayId } from './backup-media-daily.mjs';
import { reviewRetention } from './backup-retention-review.mjs';
import { dailyRunId } from './backup-database-daily.mjs';
import { backupPrefix } from './backup-r2-multipart.mjs';
import { alertConfig, sendBackupAlert } from './backup-operations.mjs';

const kinds=['database.dump.age','media.tar.age','manifest.json.age'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const check=v=>{if(!v)throw Error('Transfer watch inventory invalid');};

// Limited read-only availability watch. No writer journal or signing keys.
// R2 metadata is not trusted recovery evidence; never grants schedule eligibility.
export async function inspectTransfers({client,sdk,baselineRunId,nowMs=Date.now(),budgetBytes=8000000000,watchDatabase=false,watchMedia=false}){
  check(uuid.test(baselineRunId)&&Number.isSafeInteger(nowMs)&&nowMs>0&&Number.isSafeInteger(budgetBytes)&&budgetBytes>0&&budgetBytes<=8000000000);
  const inventory=await measureR2Inventory({client,sdk,bucket:'vanta-backups',maxPages:10,includeObjects:true});
  const sets=new Map(),databaseSets=new Map(),mediaSets=new Map(),reviewSets=[];
  for(const [key,size] of inventory.objects){
    const dbOnly=key.startsWith('production-db/');
    const mediaOnly=key.startsWith('production-media/');
    if(!key.startsWith('production/')&&!(watchDatabase&&dbOnly)&&!(watchMedia&&mediaOnly))continue;
    const [,version,id,kind,...rest]=key.split('/');
    const allowed=dbOnly?['database.dump.age','manifest.json.age']:mediaOnly?['media.tar.age','manifest.json.age']:kinds;
    check(version==='v1'&&uuid.test(id)&&allowed.includes(kind)&&!rest.length&&size>0&&size<=(kind==='manifest.json.age'?65536:dbOnly||mediaOnly?1024**3:10*1024**3));
    const target=dbOnly?databaseSets:mediaOnly?mediaSets:sets;
    if(!target.has(id))target.set(id,new Map());
    target.get(id).set(kind,size);
  }
  check(sets.size<=100&&databaseSets.size<=100&&mediaSets.size<=100&&sets.has(baselineRunId));
  let lastTransferMs=0,lastDatabaseTransferMs=0,lastMediaTransferMs=0;
  const send=cmd=>client.send(cmd,{abortSignal:AbortSignal.timeout(30000)});
  for(const [scope,group,required] of [['production',sets,kinds],['production-db',databaseSets,['database.dump.age','manifest.json.age']],['production-media',mediaSets,['media.tar.age','manifest.json.age']]])for(const [id,files] of group){
    check(files.size===required.length);
    const prefix=backupPrefix(scope,id);
    let marker;
    for(const kind of required){
      const h=await send(new sdk.HeadObjectCommand({Bucket:'vanta-backups',Key:prefix+kind}));
      const at=h.LastModified?.getTime();
      check(h.ContentLength===files.get(kind)&&h.Metadata?.['test-id']===id&&digest.test(h.Metadata?.sha256||'')&&Number.isSafeInteger(at)&&at>0&&at<=nowMs);
      if(kind==='manifest.json.age'){marker=h;reviewSets.push({scope,id,completedAtMs:at});if(scope==='production-media'){check(id===mediaDayId(at)||id===mediaDayId(at-86400000));lastMediaTransferMs=Math.max(lastMediaTransferMs,at);}else if(scope==='production-db'){
        // Capture can finish shortly after UTC midnight; accept previous day's ID.
        check(id===dailyRunId(at)||id===dailyRunId(at-86400000));
        lastDatabaseTransferMs=Math.max(lastDatabaseTransferMs,at);
      }else lastTransferMs=Math.max(lastTransferMs,at);}
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
  if(watchDatabase&&(!lastDatabaseTransferMs||nowMs-lastDatabaseTransferMs>=26*3600000))issues.push('database_backup_missing_or_overdue');
  if(watchMedia&&(!lastMediaTransferMs||nowMs-lastMediaTransferMs>=26*3600000))issues.push('media_backup_missing_or_overdue');
  if(inventory.storedBytes>=budgetBytes)issues.push('backup_capacity_exceeded');
  else if(BigInt(inventory.storedBytes)*100n>=BigInt(budgetBytes)*80n)issues.push('backup_capacity_warning');
  return {scope:'remote_transfer_watch_only',available:issues.length===0,issues,sets:sets.size,storedBytes:inventory.storedBytes,lastTransferMs,...(watchDatabase?{databaseSets:databaseSets.size,lastDatabaseTransferMs}:{}),... (watchMedia?{mediaSets:mediaSets.size,lastMediaTransferMs}:{}),retentionReview:reviewRetention({nowMs,sets:reviewSets}),scheduleEligible:false,independentRestoreVerified:false};
}

export async function runTransferWatch({env,nowMs=Date.now(),notify=sendBackupAlert,inspect=inspectTransfers,makeClient}){
  check(env.VANTA_BACKUP_TRANSFER_WATCH_ENABLED==='yes'&&env.VANTA_BACKUP_R2_BUCKET==='vanta-backups'&&/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/i.test(env.VANTA_BACKUP_R2_ENDPOINT||''));
  check(env.VANTA_BACKUP_MONITOR_R2_ACCESS_KEY_ID&&env.VANTA_BACKUP_MONITOR_R2_SECRET_ACCESS_KEY&&!env.VANTA_BACKUP_R2_ACCESS_KEY_ID&&!env.VANTA_BACKUP_R2_SECRET_ACCESS_KEY&&!env.DATABASE_URL&&!env.VANTA_BACKUP_SIGNING_PRIVATE_KEY&&!env.VANTA_DB_BACKUP_DATABASE_URL&&!env.VANTA_DB_BACKUP_SIGNER_PRIVATE_KEY&&!env.VANTA_DB_BACKUP_R2_ACCESS_KEY_ID&&!env.VANTA_DB_BACKUP_R2_SECRET_ACCESS_KEY&&!env.VANTA_MEDIA_BACKUP_R2_ACCESS_KEY_ID&&!env.VANTA_MEDIA_BACKUP_R2_SECRET_ACCESS_KEY&&!env.VANTA_MEDIA_BACKUP_SIGNER_PRIVATE_KEY);
  const config=alertConfig(env);check(config);
  const build=makeClient??(()=>{
    const require=createRequire(new URL('../backup-runtime/package.json',import.meta.url)),sdk=require('@aws-sdk/client-s3');
    return {sdk,client:new sdk.S3Client({region:'auto',endpoint:env.VANTA_BACKUP_R2_ENDPOINT,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:env.VANTA_BACKUP_MONITOR_R2_ACCESS_KEY_ID,secretAccessKey:env.VANTA_BACKUP_MONITOR_R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'})};
  });
  let result,client;
  try{
    const x=build();client=x.client;
    result=await inspect({client,sdk:x.sdk,baselineRunId:env.VANTA_BACKUP_BASELINE_RUN_ID,nowMs,watchDatabase:env.VANTA_DB_BACKUP_WATCH_ENABLED==='yes',watchMedia:env.VANTA_MEDIA_BACKUP_WATCH_ENABLED==='yes'});
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
