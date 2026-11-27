import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {lstat,readdir,realpath,mkdir,mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {captureEncryptedArtifact} from './backup-bounded-capture.mjs';
import {openBackupJournal,measureR2Inventory,measureScratchFreeBytes} from './backup-operational-adapters.mjs';
import {backupPrefix,uploadEncryptedArtifact} from './backup-r2-multipart.mjs';
import {alertConfig,sendBackupAlert,productionIdentity} from './backup-operations.mjs';
const check=(v,m='Media backup guard failed')=>{if(!v)throw Error(m)};
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const root='/data/uploads',markerLimit=65536,reserve=256*1024**2;
const fp=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');
export function mediaDayId(now){
  check(Number.isSafeInteger(now)&&now>0);
  const h=createHash('sha256').update('vanta-production-media-v1:'+Math.floor(now/86400000)).digest('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
}
// A bounded observation of regular local files. Never follow links or include
// transient chunk/transcode work. No claim of DB/Cloudinary consistency.
export async function inventoryMedia(directory,{limit,deadline=Date.now()+60000}){
  const top=await lstat(directory);
  check(top.isDirectory()&&await realpath(directory)===directory);
  const hash=createHash('sha256'),names=[];let bytes=0;
  async function walk(dir,rel){
    for(const name of (await readdir(dir)).sort()){
      check(Date.now()<deadline&&names.length<50000&&name.length<=255&&!/[\x00-\x1f\x7f\\]/.test(name));
      if(!rel&&['.chunks','.media-temp'].includes(name))continue;
      const path=join(dir,name),r=rel?rel+'/'+name:name,s=await lstat(path);
      check(s.dev===top.dev&&(s.isDirectory()||s.isFile())&&(!s.isFile()||s.nlink===1),'Unsupported media entry');
      check(Buffer.byteLength(r)<4096);
      names.push(r);
      bytes+=s.isFile()?s.size:0;check(Number.isSafeInteger(bytes)&&bytes<=limit);
      hash.update(JSON.stringify([r,s.ino,s.mode,s.size,s.mtimeMs,s.ctimeMs])+'\n');
      if(s.isDirectory())await walk(path,r);
    }
  }
  await walk(directory,'');
  return {names,bytes,digest:hash.digest('hex')};
}
export async function captureStableMedia({directory,scratch,limit,recipient,producerEnv,capture=captureEncryptedArtifact}){
  const before=await inventoryMedia(directory,{limit});
  const list=join(scratch,'entries.nul'),output=join(scratch,'media.tar.age');
  await writeFile(list,Buffer.from(before.names.map(n=>'./'+n+'\0').join('')),{flag:'wx',mode:0o600});
  const result=await capture({producer:'tar',args:['--one-file-system','--no-recursion','-C',directory,'--null','--verbatim-files-from','-T',list,'-cf','-'],producerEnv,recipient,output,maxBytes:limit,timeoutMs:300000});
  const after=await inventoryMedia(directory,{limit});
  check(before.digest===after.digest,'Source changed during capture; no upload');
  return {path:output,bytes:result.bytes,sourceEntries:before.names.length,sourceBytes:before.bytes,inventoryDigest:before.digest};
}
export function mediaConfig(env){
  check(productionIdentity(env)&&env.VANTA_MEDIA_BACKUP_ENABLED==='yes'&&env.VANTA_MEDIA_BACKUP_OWNER_APPROVED==='yes'&&env.UPLOAD_STORAGE_DIR===root);
  check(/^[a-f0-9]{40}$/.test(env.VANTA_MEDIA_BACKUP_EXPECTED_SHA||'')&&env.RAILWAY_GIT_COMMIT_SHA===env.VANTA_MEDIA_BACKUP_EXPECTED_SHA);
  check(env.VANTA_BACKUP_R2_BUCKET==='vanta-backups'&&/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/i.test(env.VANTA_BACKUP_R2_ENDPOINT||'')&&env.VANTA_MEDIA_BACKUP_R2_ACCESS_KEY_ID&&env.VANTA_MEDIA_BACKUP_R2_SECRET_ACCESS_KEY);
  check(/^age1[0-9a-z]{58}$/.test(env.VANTA_BACKUP_AGE_RECIPIENT||'')&&hex(env.VANTA_MEDIA_BACKUP_SIGNER_FINGERPRINT)&&env.VANTA_MEDIA_BACKUP_SIGNER_PRIVATE_KEY);
  const limit=Number(env.VANTA_MEDIA_BACKUP_LIMIT_BYTES),budget=Number(env.VANTA_MEDIA_BACKUP_BUDGET_BYTES);
  check(Number.isSafeInteger(limit)&&limit>=1024**2&&limit<=1024**3&&Number.isSafeInteger(budget)&&budget>=limit+markerLimit&&budget<=8000000000);
  return {limit,budget};
}
export async function runMediaDay({now,limit,budget,adapters}){
  const runId=mediaDayId(now),prefix=backupPrefix('production-media',runId);
  let lock,started=false,phase='lock';
  try{
    lock=await adapters.acquire();check(lock&&await lock.healthy());
    phase='inventory';const i=await adapters.inventory(),previous=await adapters.previous();
    check(i.inventoryComplete===true&&i.incompleteUploadBytes===0&&i.objects instanceof Map&&!i.unresolvedAttempt);
    if(previous?.runId===runId&&previous.state==='transfer_verified'){
      check(i.objects.has(prefix+'media.tar.age')&&i.objects.has(prefix+'manifest.json.age'));
      return {runId,skipped:true,mediaOnly:true};
    }
    check(Number.isSafeInteger(i.storedBytes)&&i.storedBytes>=0&&i.storedBytes+limit+markerLimit<=budget&&i.scratchFreeBytes>=limit+markerLimit+reserve);
    check(![...i.objects.keys()].some(k=>k.startsWith(prefix)));
    // Capture before journaling remote intent: concurrent source churn may
    // safely retry, since no upload or marker has been attempted.
    phase='capture';const f=await adapters.capture(limit);
    check(f&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=limit&&hex(f.inventoryDigest)&&await lock.healthy());
    phase='journal';await adapters.begin(runId);started=true;
    phase='upload';const artifact=await adapters.upload('media.tar.age',f.path,limit);
    check(artifact?.verified===true&&artifact.key===prefix+'media.tar.age'&&artifact.bytes===f.bytes&&hex(artifact.sha256)&&await lock.healthy());
    phase='marker';const file=await adapters.marker({runId,capturedAtMs:now,artifact,source:f});
    check(await lock.healthy());
    const marker=await adapters.upload('manifest.json.age',file,markerLimit);
    check(marker?.verified===true&&marker.key===prefix+'manifest.json.age'&&hex(marker.sha256)&&await lock.healthy());
    phase='record';await adapters.record({runId,capturedAtMs:now,marker,artifact});
    return {runId,mediaOnly:true,transferVerified:true,independentRestoreVerified:false,synchronizedDatabase:false};
  }catch{if(started)await adapters.fail(runId,phase).catch(()=>{});throw Error('Media-only backup failed at '+phase);}
  finally{if(lock)await lock.release();}
}
async function main(env){
  const {limit,budget}=mediaConfig(env),notification=alertConfig(env);check(notification);
  check((await readFile('/proc/self/mountinfo','utf8')).split('\n').some(x=>x.split(' ')[4]==='/data')&&await realpath(root)===root);
  const key=createPrivateKey(env.VANTA_MEDIA_BACKUP_SIGNER_PRIVATE_KEY);check(key.asymmetricKeyType==='ed25519'&&fp(createPublicKey(key))===env.VANTA_MEDIA_BACKUP_SIGNER_FINGERPRINT);
  const control='/data/.vanta-media-backup-control';await mkdir(control,{mode:0o700,recursive:true});check(await realpath(control)===control);
  const journal=await openBackupJournal(control),scratch=await mkdtemp(join(tmpdir(),'vanta-media-only-'));
  const require=createRequire(new URL('../backup-runtime/package.json',import.meta.url)),sdk=require('@aws-sdk/client-s3');
  const depLock=JSON.parse(await readFile(new URL('../backup-runtime/package-lock.json',import.meta.url),'utf8'));
  check(depLock.packages?.['node_modules/@aws-sdk/client-s3']?.version==='3.1178.0');
  const s3=new sdk.S3Client({region:'auto',endpoint:env.VANTA_BACKUP_R2_ENDPOINT,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:env.VANTA_MEDIA_BACKUP_R2_ACCESS_KEY_ID,secretAccessKey:env.VANTA_MEDIA_BACKUP_R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const now=Date.now(),runId=mediaDayId(now),producerEnv={PATH:env.PATH,HOME:scratch};
  try{
    const result=await runMediaDay({now,limit,budget,adapters:{
      acquire:()=>journal.acquireExclusiveWriter(),previous:()=>journal.readCurrent(),
      inventory:async()=>({...await measureR2Inventory({client:s3,sdk,bucket:'vanta-backups',includeObjects:true}),scratchFreeBytes:await measureScratchFreeBytes(scratch),unresolvedAttempt:await journal.unresolvedAttempt()}),
      capture:maxBytes=>captureStableMedia({directory:root,scratch,limit:maxBytes,recipient:env.VANTA_BACKUP_AGE_RECIPIENT,producerEnv}),
      begin:id=>journal.beginAttempt({scope:'production',runId:id}),
      upload:(kind,file,maxBytes)=>uploadEncryptedArtifact({client:s3,sdk,bucket:'vanta-backups',scope:'production-media',runId,kind,file,maxBytes}),
      marker:async({runId,capturedAtMs,artifact,source})=>{
        const data={version:1,scope:'production-media',runId,capturedAtMs,media:{key:artifact.key,bytes:artifact.bytes,sha256:artifact.sha256},source:{entries:source.sourceEntries,bytes:source.sourceBytes,inventoryDigest:source.inventoryDigest},databaseIncluded:false,cloudinaryIncluded:false};
        const bytes=Buffer.from(JSON.stringify({data,signer:fp(createPublicKey(key)),signature:sign(null,Buffer.from(JSON.stringify(data)),key).toString('base64')})+'\n');
        const output=join(scratch,'manifest.json.age');
        execFileSync('bash',[new URL('./backup-age-encrypt.sh',import.meta.url).pathname,output],{input:bytes,env:{...producerEnv,VANTA_BACKUP_AGE_RECIPIENT:env.VANTA_BACKUP_AGE_RECIPIENT},timeout:15000,stdio:['pipe','ignore','ignore']});
        check((await stat(output)).size<=markerLimit);return output;
      },
      record:({runId,capturedAtMs,marker,artifact})=>journal.recordVerifiedTransfer({scope:'production',runId,capturedAtMs,marker,manifest:{version:1,runId,mediaOnly:true,artifact}}),
      fail:(runId,phase)=>journal.recordFailure({scope:'production',runId,phase})
    }});
    console.log('[VANTA MEDIA ONLY] '+JSON.stringify(result));
  }finally{s3.destroy();await rm(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const timer=setTimeout(()=>{console.error('[VANTA MEDIA ONLY] deadline; reconcile before retry');process.exit(1);},900000);
  try{await main(process.env);}catch{console.error('[VANTA MEDIA ONLY] failed');process.exitCode=1;
    if(productionIdentity(process.env)&&process.env.VANTA_MEDIA_BACKUP_ENABLED==='yes')try{await sendBackupAlert({config:alertConfig(process.env),issues:['media_backup_missing_or_overdue']});}catch{console.error('[VANTA MEDIA ONLY] alert_failed');}
  }finally{clearTimeout(timer);}
}
