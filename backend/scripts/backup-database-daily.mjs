import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { openBackupJournal, measureR2Inventory, measureScratchFreeBytes } from './backup-operational-adapters.mjs';
import { captureEncryptedArtifact } from './backup-bounded-capture.mjs';
import { uploadEncryptedArtifact, backupPrefix } from './backup-r2-multipart.mjs';
import { alertConfig, sendBackupAlert } from './backup-operations.mjs';

const check=(v,m='Database-only backup guard failed')=>{if(!v)throw Error(m)};
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const fp=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');
const markerLimit=65536, reserve=256*1024**2;
export function dailyRunId(nowMs){
  check(Number.isSafeInteger(nowMs)&&nowMs>0);
  const h=createHash('sha256').update('vanta-production-db-v1:'+Math.floor(nowMs/86400000)).digest('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
}
export function databaseConfig(env){
  check(env.VANTA_DB_BACKUP_ENABLED==='yes'&&env.VANTA_DB_BACKUP_OWNER_APPROVED==='yes');
  check(env.RAILWAY_PROJECT_ID==='a05242c0-8a26-40b0-a88d-e338e96eec55'&&env.RAILWAY_ENVIRONMENT_ID==='4a6d43ce-571f-4d85-8abe-c7c5f19ed920'&&env.RAILWAY_ENVIRONMENT_NAME==='production');
  check(/^[a-f0-9-]{36}$/.test(env.VANTA_DB_BACKUP_EXPECTED_SERVICE_ID||'')&&env.RAILWAY_SERVICE_ID===env.VANTA_DB_BACKUP_EXPECTED_SERVICE_ID&&!['c0231973-3822-4d57-b3d0-a5df671dfacf','d6662e69-4ba9-4572-b0f7-5c7fc89e1b7b','ac69f7d4-06c9-4a22-84c9-2585bae0deff'].includes(env.RAILWAY_SERVICE_ID));
  check(/^[a-f0-9]{40}$/.test(env.VANTA_DB_BACKUP_EXPECTED_SHA||'')&&env.RAILWAY_GIT_COMMIT_SHA===env.VANTA_DB_BACKUP_EXPECTED_SHA);
  check(!env.DATABASE_URL&&!env.VANTA_BACKUP_R2_ACCESS_KEY_ID&&!env.VANTA_BACKUP_R2_SECRET_ACCESS_KEY&&!env.VANTA_BACKUP_SIGNING_PRIVATE_KEY);
  check(/^age1[0-9a-z]{58}$/.test(env.VANTA_BACKUP_AGE_RECIPIENT||'')&&sha(env.VANTA_DB_BACKUP_SIGNER_FINGERPRINT)&&env.VANTA_DB_BACKUP_SIGNER_PRIVATE_KEY);
  check(/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/i.test(env.VANTA_BACKUP_R2_ENDPOINT||'')&&env.VANTA_BACKUP_R2_BUCKET==='vanta-backups'&&env.VANTA_DB_BACKUP_R2_ACCESS_KEY_ID&&env.VANTA_DB_BACKUP_R2_SECRET_ACCESS_KEY);
  const db=new URL(env.VANTA_DB_BACKUP_DATABASE_URL||'');
  check(['postgres:','postgresql:'].includes(db.protocol)&&db.hostname==='postgres.railway.internal'&&(!db.port||db.port==='5432')&&decodeURIComponent(db.username)==='vanta_backup_reader'&&db.password&&/^\/[A-Za-z0-9_-]+$/.test(db.pathname)&&!db.search&&!db.hash);
  const limit=Number(env.VANTA_DB_BACKUP_LIMIT_BYTES), budget=Number(env.VANTA_DB_BACKUP_BUDGET_BYTES);
  check(Number.isSafeInteger(limit)&&limit>=1024*1024&&limit<=1024**3&&Number.isSafeInteger(budget)&&budget>=limit+markerLimit&&budget<=8000000000);
  return {db,limit,budget};
}
export function signDatabaseMarker({artifact,runId,capturedAtMs,privateKey}){
  check(artifact?.verified===true&&artifact.key===backupPrefix('production-db',runId)+'database.dump.age'&&sha(artifact.sha256)&&Number.isSafeInteger(artifact.bytes)&&artifact.bytes>0&&artifact.bytes<=1024**3&&dailyRunId(capturedAtMs)===runId);
  const key=createPrivateKey(privateKey);check(key.asymmetricKeyType==='ed25519');
  const data={version:1,scope:'production-db',runId,capturedAtMs,database:{key:artifact.key,bytes:artifact.bytes,sha256:artifact.sha256},mediaIncluded:false};
  return Buffer.from(JSON.stringify({data,signer:fp(createPublicKey(key)),signature:sign(null,Buffer.from(JSON.stringify(data)),key).toString('base64')})+'\n');
}
export function verifyDatabaseMarker({bytes,publicKey,fingerprint,runId}){
  check(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=16384&&sha(fingerprint));
  const key=createPublicKey(publicKey),e=JSON.parse(bytes.toString('utf8')),d=e.data;
  check(key.asymmetricKeyType==='ed25519'&&fp(key)===fingerprint&&e.signer===fingerprint&&Object.keys(e).length===3&&typeof e.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(e.signature));
  check(d&&Object.keys(d).length===6&&d.version===1&&d.scope==='production-db'&&d.runId===runId&&dailyRunId(d.capturedAtMs)===runId&&d.mediaIncluded===false&&d.database&&Object.keys(d.database).length===3&&d.database.key===backupPrefix('production-db',runId)+'database.dump.age'&&sha(d.database.sha256)&&Number.isSafeInteger(d.database.bytes)&&d.database.bytes>0&&d.database.bytes<=1024**3);
  check(verify(null,Buffer.from(JSON.stringify(d)),key,Buffer.from(e.signature,'base64')));
  return d;
}
// Independent durable journal; never changes full-set journal or recovery evidence.
export async function runDailyDatabase({nowMs,limit,budget,adapters}){
  const runId=dailyRunId(nowMs),prefix=backupPrefix('production-db',runId);
  let lease,started=false,phase='lock';
  try{
    lease=await adapters.acquire();
    check(lease&&await lease.healthy());
    phase='inventory';
    const i=await adapters.inventory();
    check(i.inventoryComplete===true&&i.incompleteUploadBytes===0&&Number.isSafeInteger(i.storedBytes)&&i.storedBytes>=0&&i.storedBytes+limit+markerLimit<=budget&&i.scratchFreeBytes>=limit+markerLimit+reserve&&!i.unresolvedAttempt);
    check(i.objects instanceof Map);
    const previous=await adapters.previous();
    if(previous?.runId===runId&&previous.state==='transfer_verified'){
      check(i.objects.has(prefix+'database.dump.age')&&i.objects.has(prefix+'manifest.json.age'));
      return {runId,skipped:true,databaseOnly:true};
    }
    check(![...i.objects.keys()].some(k=>k.startsWith(prefix)));
    phase='journal';await adapters.begin(runId);started=true;
    phase='capture';const file=await adapters.capture(limit);
    check(file&&Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=limit&&await lease.healthy());
    phase='upload';const artifact=await adapters.upload('database.dump.age',file.path,limit);
    check(artifact?.verified===true&&artifact.key===prefix+'database.dump.age'&&artifact.bytes===file.bytes&&sha(artifact.sha256)&&await lease.healthy());
    phase='marker';const markerFile=await adapters.marker({artifact,runId,capturedAtMs:nowMs});
    check(await lease.healthy());
    const marker=await adapters.upload('manifest.json.age',markerFile,markerLimit);
    check(marker?.verified===true&&marker.key===prefix+'manifest.json.age'&&sha(marker.sha256)&&await lease.healthy());
    phase='record';await adapters.record({runId,capturedAtMs:nowMs,artifact,marker});
    return {runId,databaseOnly:true,transferVerified:true,independentRestoreVerified:false};
  }catch{if(started)await adapters.fail(runId,phase).catch(()=>{});throw Error('Database-only backup failed at '+phase+'; reconcile before retry');}
  finally{if(lease)await lease.release();}
}
async function main(env){
  const cfg=databaseConfig(env),notification=alertConfig(env);check(notification);
  check((await readFile('/proc/self/mountinfo','utf8')).split('\n').some(x=>x.split(' ')[4]==='/backup-control')&&await realpath('/backup-control')==='/backup-control');
  const key=createPrivateKey(env.VANTA_DB_BACKUP_SIGNER_PRIVATE_KEY);
  check(key.asymmetricKeyType==='ed25519'&&fp(createPublicKey(key))===env.VANTA_DB_BACKUP_SIGNER_FINGERPRINT);
  const pathEnv={PATH:env.PATH};
  check(/\(PostgreSQL\) 18\./.test(execFileSync('pg_dump',['--version'],{env:pathEnv,timeout:5000}).toString()));
  const require=createRequire(new URL('../backup-runtime/package.json',import.meta.url)),sdk=require('@aws-sdk/client-s3'),{Client}=require('pg');
  const lock=JSON.parse(await readFile(new URL('../backup-runtime/package-lock.json',import.meta.url),'utf8'));
  check(lock.packages?.['node_modules/@aws-sdk/client-s3']?.version==='3.1178.0'&&lock.packages?.['node_modules/pg']?.version==='8.16.3');
  const db=cfg.db.pathname.slice(1), control='/backup-control/db-only';
  await mkdir(control,{recursive:true,mode:0o700});
  const journal=await openBackupJournal(control),scratch=await mkdtemp(join(tmpdir(),'vanta-db-only-'));
  const s3=new sdk.S3Client({region:'auto',endpoint:env.VANTA_BACKUP_R2_ENDPOINT,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:env.VANTA_DB_BACKUP_R2_ACCESS_KEY_ID,secretAccessKey:env.VANTA_DB_BACKUP_R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const pgEnv={PATH:env.PATH,HOME:scratch,PGHOST:cfg.db.hostname,PGPORT:'5432',PGUSER:'vanta_backup_reader',PGPASSWORD:decodeURIComponent(cfg.db.password),PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c default_transaction_read_only=on'};
  const nowMs=Date.now(),runId=dailyRunId(nowMs);
  try{
    const result=await runDailyDatabase({nowMs,limit:cfg.limit,budget:cfg.budget,adapters:{
      acquire:()=>journal.acquireExclusiveWriter(),previous:()=>journal.readCurrent(),
      inventory:async()=>({...await measureR2Inventory({client:s3,sdk,bucket:'vanta-backups',includeObjects:true}),scratchFreeBytes:await measureScratchFreeBytes(scratch),unresolvedAttempt:await journal.unresolvedAttempt()}),
      begin:id=>journal.beginAttempt({scope:'production',runId:id}),
      capture:async(maxBytes)=>{
        const conn=new Client({connectionString:env.VANTA_DB_BACKUP_DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:10000,options:'-c default_transaction_read_only=on'});
        conn.on('error',()=>{});
        try{
          await conn.connect();
          const q=await conn.query("SELECT current_database() AS db,current_user AS name,current_setting('server_version_num')::int AS version,current_setting('transaction_read_only') AS ro,pg_is_in_recovery() AS standby,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,pg_has_role(current_user,'pg_read_all_data','USAGE') AS reader FROM pg_roles WHERE rolname=current_user");
          const r=q.rows[0];check(r?.db===db&&r.name==='vanta_backup_reader'&&Math.floor(r.version/10000)===18&&r.ro==='on'&&!r.standby&&r.reader&&!r.rolsuper&&!r.rolcreatedb&&!r.rolcreaterole&&!r.rolreplication&&!r.rolbypassrls);
        }finally{await conn.end();}
        const path=join(scratch,'database.dump.age');
        // pg_dump uses a consistent transaction snapshot; no table SHARE fence
        // or media claim. Ordinary DML can continue. DDL may contend briefly.
        return {path,...await captureEncryptedArtifact({producer:'pg_dump',args:['--format=custom','--no-owner','--no-acl','--lock-wait-timeout=5s','--dbname',db],producerEnv:pgEnv,recipient:env.VANTA_BACKUP_AGE_RECIPIENT,output:path,maxBytes,timeoutMs:600000})};
      },
      upload:(kind,file,maxBytes)=>uploadEncryptedArtifact({client:s3,sdk,bucket:'vanta-backups',scope:'production-db',runId,kind,file,maxBytes}),
      marker:async args=>{const output=join(scratch,'manifest.json.age');const bytes=signDatabaseMarker({...args,privateKey:env.VANTA_DB_BACKUP_SIGNER_PRIVATE_KEY});
        execFileSync('bash',['backend/scripts/backup-age-encrypt.sh',output],{input:bytes,env:{PATH:env.PATH,HOME:scratch,VANTA_BACKUP_AGE_RECIPIENT:env.VANTA_BACKUP_AGE_RECIPIENT},timeout:15000,stdio:['pipe','ignore','ignore']});check((await stat(output)).size<=markerLimit);return output;},
      record:({runId,capturedAtMs,artifact,marker})=>journal.recordVerifiedTransfer({scope:'production',runId,capturedAtMs,marker,manifest:{version:1,runId,databaseOnly:true,artifact}}),
      fail:(runId,phase)=>journal.recordFailure({scope:'production',runId,phase})
    }});
    console.log('[VANTA DATABASE ONLY] '+JSON.stringify(result));
  }finally{s3.destroy();await rm(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const timer=setTimeout(()=>{console.error('[VANTA DATABASE ONLY] deadline; reconcile before retry');process.exit(1);},1200000);
  try{await main(process.env);}
  catch{console.error('[VANTA DATABASE ONLY] failed; reconcile before retry');process.exitCode=1;
    if(process.env.VANTA_DB_BACKUP_ENABLED==='yes')try{await sendBackupAlert({config:alertConfig(process.env),issues:['backup_attempt_failed']});}catch{console.error('[VANTA DATABASE ONLY] alert_failed');}
  }finally{clearTimeout(timer);}
}
