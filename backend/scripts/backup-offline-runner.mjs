import { createRequire } from 'node:module';
import { createHash, createPublicKey, createPrivateKey } from 'node:crypto';
import { lstat, readdir, readFile, mkdir, mkdtemp, rm, stat, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { openBackupJournal, measureR2Inventory, measureScratchFreeBytes } from './backup-operational-adapters.mjs';
import { runBackupSet, signBackupManifest } from './backup-orchestrator.mjs';
import { captureEncryptedArtifact } from './backup-bounded-capture.mjs';
import { uploadEncryptedArtifact, backupPrefix } from './backup-r2-multipart.mjs';
import { alertConfig, sendBackupAlert, productionIdentity } from './backup-operations.mjs';
import { verifyDailyPermit, checkDailySlot } from './backup-daily-window.mjs';

const check = (value, reason) => { if (!value) throw Error(reason || 'offline backup guard failed'); };
const fixed = { project:'a05242c0-8a26-40b0-a88d-e338e96eec55', environment:'4a6d43ce-571f-4d85-8abe-c7c5f19ed920',
  service:'c0231973-3822-4d57-b3d0-a5df671dfacf' };
const mediaRoot = '/data', controlName = '.vanta-backup-control', control = join(mediaRoot, controlName);
const positive = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));

export function checkOfflineConfig(env, pid) {
  // Not a general online backup mode. External maintenance fencing must have
  // already stopped ALL other application/worker processes and DB writers.
  const flags = ['VANTA_BACKUP_OFFLINE_CAPTURE','VANTA_BACKUP_ALL_WRITERS_STOPPED',
    'VANTA_BACKUP_RECOVERY_COPIES_VERIFIED','VANTA_BACKUP_RECIPIENT_VERIFIED','VANTA_BACKUP_CREDENTIALS_ROTATED'];
  check(flags.every(k => env[k] === 'yes'), 'Explicit offline approval and recovery prerequisites required');
  check(pid === 1, 'Dedicated maintenance container must run backup as PID 1');
  check(env.RAILWAY_PROJECT_ID === fixed.project && env.RAILWAY_ENVIRONMENT_ID === fixed.environment &&
    env.RAILWAY_SERVICE_ID === fixed.service && env.RAILWAY_ENVIRONMENT_NAME === 'production', 'Incorrect production service');
  check(/^[a-f0-9]{40}$/.test(env.VANTA_BACKUP_EXPECTED_SHA || '') &&
    env.RAILWAY_GIT_COMMIT_SHA === env.VANTA_BACKUP_EXPECTED_SHA, 'Incorrect approved source revision');
  const runId = env.VANTA_BACKUP_APPROVED_RUN_ID;
  backupPrefix('production', runId);
  check(/^age1[0-9a-z]{58}$/.test(env.VANTA_BACKUP_AGE_RECIPIENT || ''), 'Invalid public recovery recipient');
  check(/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/i.test(env.VANTA_BACKUP_R2_ENDPOINT || '') &&
    env.VANTA_BACKUP_R2_BUCKET === 'vanta-backups' &&
    env.VANTA_BACKUP_R2_ACCESS_KEY_ID && env.VANTA_BACKUP_R2_SECRET_ACCESS_KEY, 'Separate production R2 credentials required');
  check(/^[a-f0-9]{64}$/.test(env.VANTA_BACKUP_SIGNING_PUBLIC_FINGERPRINT || '') &&
    env.VANTA_BACKUP_SIGNING_PRIVATE_KEY, 'Independent manifest signer required');
  const db = new URL(env.DATABASE_URL || '');
  check(['postgres:', 'postgresql:'].includes(db.protocol) &&
    /^[a-z0-9-]+\.railway\.internal$/.test(env.VANTA_BACKUP_EXPECTED_DB_HOST || '') &&
    db.hostname === env.VANTA_BACKUP_EXPECTED_DB_HOST && db.username && db.password &&
    /^\/[A-Za-z0-9_-]+$/.test(db.pathname) &&
    [...db.searchParams.keys()].every(k => ['sslmode','connect_timeout','connection_limit','pool_timeout'].includes(k)) &&
    (!db.searchParams.has('sslmode') || ['disable','prefer','require','verify-ca','verify-full'].includes(db.searchParams.get('sslmode'))), 'Unexpected database authority or connection options');
  const values = ['VANTA_BACKUP_DATABASE_LIMIT_BYTES','VANTA_BACKUP_MEDIA_LIMIT_BYTES','VANTA_BACKUP_R2_BUDGET_BYTES'];
  check(values.every(k => positive(env[k])), 'Explicit byte budgets required');
  const [databaseLimitBytes,mediaLimitBytes,budgetBytes] = values.map(k => Number(env[k]));
  check(databaseLimitBytes <= 10*1024**3 && mediaLimitBytes <= 10*1024**3 && budgetBytes <= 8_000_000_000,
    'Backup capacity exceeds approved maximum');
  return { runId, db, databaseLimitBytes, mediaLimitBytes, budgetBytes, manifestLimitBytes:64*1024 };
}

async function mediaInventory() {
  const root = await lstat(mediaRoot);
  check(root.isDirectory() && await realpath(mediaRoot) === mediaRoot, 'Unexpected media root');
  const hash = createHash('sha256'); let entries = 0, bytes = 0;
  async function walk(dir, relative) {
    for (const name of (await readdir(dir)).sort()) {
      if (!relative && name === controlName) continue;
      const path = join(dir,name), rel = relative ? relative + '/' + name : name, s = await lstat(path);
      check(++entries <= 50000 && s.dev === root.dev && (s.isDirectory() || s.isFile()), 'Media inventory limit or unsupported entry');
      bytes += s.isFile() ? s.size : 0;
      check(Number.isSafeInteger(bytes), 'Media size overflow');
      hash.update(JSON.stringify([rel,s.ino,s.mode,s.size,s.mtimeMs,s.ctimeMs])+'\n');
      if(s.isDirectory()) await walk(path,rel);
    }
  }
  await walk(mediaRoot,'');
  return { entries, bytes, digest:hash.digest('hex') };
}

async function main() {
  const env = process.env, cfg = checkOfflineConfig(env, process.pid);
  // Validate opted-in notification transport before any source access.
  alertConfig(env);
  const dailyPermit=env.VANTA_BACKUP_SCHEDULED_CAPTURE==='yes' ? verifyDailyPermit({
    envelope:JSON.parse(env.VANTA_BACKUP_DAILY_PERMIT||'null'),publicKey:env.VANTA_BACKUP_DAILY_APPROVER_PUBLIC_KEY,
    fingerprint:env.VANTA_BACKUP_DAILY_APPROVER_FINGERPRINT,writerFingerprint:env.VANTA_BACKUP_SIGNING_PUBLIC_FINGERPRINT,
    runId:cfg.runId,revision:env.VANTA_BACKUP_EXPECTED_SHA,nowMs:Date.now()}) : null;
  const mountInfo = await readFile('/proc/self/mountinfo','utf8');
  check(mountInfo.split('\n').some(line=>line.split(' ')[4]===mediaRoot),'Existing /data mount required');
  const require = createRequire(new URL('../backup-runtime/package.json',import.meta.url));
  const lock = JSON.parse(await readFile(new URL('../backup-runtime/package-lock.json',import.meta.url),'utf8'));
  check(lock.lockfileVersion === 3 && lock.packages?.['node_modules/@aws-sdk/client-s3']?.version === '3.1178.0' &&
    lock.packages?.['node_modules/pg']?.version === '8.16.3','Verified runtime lockfile required');
  const sdk = require('@aws-sdk/client-s3'), {Client} = require('pg');
  const signer = createPrivateKey(env.VANTA_BACKUP_SIGNING_PRIVATE_KEY);
  const fp = createHash('sha256').update(createPublicKey(signer).export({type:'spki',format:'der'})).digest('hex');
  check(signer.asymmetricKeyType==='ed25519' && fp===env.VANTA_BACKUP_SIGNING_PUBLIC_FINGERPRINT,'Manifest signer mismatch');
  const pathEnv = {PATH:env.PATH};
  check(/\(PostgreSQL\) 18\./.test(execFileSync('pg_dump',['--version'],{env:pathEnv,timeout:5000}).toString()),'PostgreSQL 18 client required');
  // Create only a dedicated protected control directory on the mounted volume.
  try { await mkdir(control,{mode:0o700}); } catch(e) { if(e.code!=='EEXIST') throw e; }
  const journal = await openBackupJournal(control);
  const scratch = await mkdtemp(join(tmpdir(),'vanta-approved-backup-'));
  const client = new sdk.S3Client({region:'auto',endpoint:env.VANTA_BACKUP_R2_ENDPOINT,forcePathStyle:true,maxAttempts:1,
    credentials:{accessKeyId:env.VANTA_BACKUP_R2_ACCESS_KEY_ID,secretAccessKey:env.VANTA_BACKUP_R2_SECRET_ACCESS_KEY},
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const database = cfg.db.pathname.slice(1);
  const pgEnv = {PATH:env.PATH,HOME:scratch,PGHOST:cfg.db.hostname,PGPORT:cfg.db.port||'5432',
    PGUSER:decodeURIComponent(cfg.db.username),PGPASSWORD:decodeURIComponent(cfg.db.password),PGCONNECT_TIMEOUT:'5',
    ...(cfg.db.searchParams.has('sslmode')?{PGSSLMODE:cfg.db.searchParams.get('sslmode')}:{})};
  const recipient = env.VANTA_BACKUP_AGE_RECIPIENT;
  let beforeMedia;
  const upload = (kind,file,maxBytes) => uploadEncryptedArtifact({client,sdk,bucket:'vanta-backups',
    scope:'production',runId:cfg.runId,kind,file,maxBytes});
  try {
    const result=await runBackupSet({scope:'production',runId:cfg.runId,
      policy:{enabled:true,ownerApproved:true,recoveryCopiesVerified:true,recipientVerified:true,credentialsRotated:true,
        dependencyLockVerified:true,databaseLimitBytes:cfg.databaseLimitBytes,mediaLimitBytes:cfg.mediaLimitBytes,
        manifestLimitBytes:cfg.manifestLimitBytes,budgetBytes:cfg.budgetBytes},
      adapters:{
        acquireExclusiveWriter:()=>journal.acquireExclusiveWriter(),
        measureCapacity:async()=>({...await measureR2Inventory({client,sdk,bucket:'vanta-backups'}),
          nowMs:Date.now(),scratchFreeBytes:await measureScratchFreeBytes(scratch),unresolvedAttempt:await journal.unresolvedAttempt()}),
        beginAttempt:async args=>{
          if(dailyPermit)checkDailySlot({permit:dailyPermit,previous:await journal.readCurrent(),nowMs:Date.now()});
          return journal.beginAttempt(args);
        },
        fenceSources:async()=>{
          // External stopped-writer maintenance window is mandatory. Table
          // SHARE locks protect existing relations against ordinary DML/DDL,
          // not all possible privileged clients or sequence activity.
          const conn = new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:10000,keepAlive:true});
          let lost=false, lockedTables; const lockDeadline=Date.now()+60000;
          conn.on('error',()=>{lost=true}); conn.on('end',()=>{lost=true});
          const tableInventory=async()=> (await conn.query("SELECT format('%I.%I',n.nspname,c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1")).rows.map(row=>row.name);
          const healthy=async()=>{
            if(lost)return false;
            try{
              const q=await conn.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()");
              return !lost && q.rows[0]?.n===0 && (!lockedTables || JSON.stringify(await tableInventory())===JSON.stringify(lockedTables));
            }catch{return false;}
          };
          try{
            await conn.connect();
            const q=await conn.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version,pg_is_in_recovery() AS standby");
            check(q.rows[0]?.db===database&&Math.floor(q.rows[0]?.version/10000)===18&&!q.rows[0]?.standby&&await healthy(),'Unexpected database or other client present');
            await conn.query('BEGIN'); await conn.query("SET LOCAL lock_timeout='3s'");
            const tables=await tableInventory();
            check(tables.length>0&&tables.length<=10000,'Unexpected database table inventory');
            for(const table of tables){
              check(Date.now()<lockDeadline,'Source lock acquisition deadline exceeded');
              await conn.query('LOCK TABLE ONLY '+table+' IN SHARE MODE');
            }
            lockedTables=tables;
            check(await healthy(),'Source clients appeared');
            beforeMedia=await mediaInventory();
            return {healthy,release:async()=>{try{await conn.query('ROLLBACK')}finally{await conn.end()}}};
          }catch{await conn.end().catch(()=>{});throw Error('Offline source verification or locking failed');}
        },
        capture:async(kind,maxBytes)=>{
          const output=join(scratch,kind), isDb=kind==='database.dump.age';
          const result=await captureEncryptedArtifact({producer:isDb?'pg_dump':'tar',
            args:isDb?['--format=custom','--no-owner','--no-acl','--dbname',database]:
              ['--one-file-system','--exclude=./'+controlName,'-C',mediaRoot,'-cf','-','.'],
            producerEnv:isDb?pgEnv:{PATH:env.PATH,HOME:scratch},recipient,output,maxBytes,timeoutMs:600000});
          if(!isDb){const after=await mediaInventory();check(after.digest===beforeMedia?.digest,'Media changed during capture');}
          return {path:output,bytes:result.bytes};
        },
        upload,
        signManifest:args=>signBackupManifest({...args,privateKey:env.VANTA_BACKUP_SIGNING_PRIVATE_KEY}),
        encryptManifest:async(bytes,maxBytes)=>{
          check(Buffer.isBuffer(bytes)&&bytes.length<=16*1024,'Manifest too large');
          const output=join(scratch,'manifest.json.age');
          execFileSync('bash',['backend/scripts/backup-age-encrypt.sh',output],
            {input:bytes,env:{PATH:env.PATH,HOME:scratch,VANTA_BACKUP_AGE_RECIPIENT:recipient},timeout:15000,stdio:['pipe','ignore','ignore']});
          const size=(await stat(output)).size;check(size<=maxBytes,'Encrypted manifest exceeds limit');
          return {path:output,bytes:size};
        },
        recordVerifiedTransfer:args=>journal.recordVerifiedTransfer(args),
        recordFailure:args=>journal.recordFailure(args),
        cleanupLocal:async()=>{await rm(scratch,{recursive:true,force:true});},
      }});
    console.log('[VANTA OFFLINE BACKUP] '+JSON.stringify({runId:result.runId,transferVerified:true,independentRestoreVerified:false}));
  } finally { client.destroy(); await rm(scratch,{recursive:true,force:true}); }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try{await main()}catch{
    console.error('[VANTA OFFLINE BACKUP] '+JSON.stringify({transferVerified:false,reconcileBeforeRetry:true}));
    process.exitCode=1;
    if(productionIdentity(process.env) && process.env.VANTA_BACKUP_ALERTS_ENABLED==='yes'){
      try{
        await sendBackupAlert({config:alertConfig(process.env),issues:['backup_attempt_failed']});
        console.error('[VANTA BACKUP ALERT] deliveryAccepted');
      }catch{console.error('[VANTA BACKUP ALERT] deliveryFailed');}
    }
  }
}
