import { createRequire } from 'node:module';
import { randomUUID, randomBytes, generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkAcceptanceConfig } from './acceptance-preflight.mjs';
import { checkDatabase } from './acceptance-provider-probe.mjs';
import { sha256, MAX_BACKUP_BYTES } from './backup-envelope.mjs';
import { captureEncryptedArtifact } from './backup-bounded-capture.mjs';
import { uploadEncryptedArtifact } from './backup-r2-multipart.mjs';
import { runBackupSet, signBackupManifest, verifySignedBackupManifest } from './backup-orchestrator.mjs';
import { openBackupJournal, measureR2Inventory, measureScratchFreeBytes } from './backup-operational-adapters.mjs';

const log = x => console.log('[AGE BACKUP SET 282] ' + JSON.stringify(x));
const check = value => { if (!value) throw new Error('acceptance assertion'); };
const env = process.env;
if (env.VANTA_AGE_BACKUP_SET_ACCEPTANCE !== 'yes' || !checkAcceptanceConfig(env, 'worker').passed ||
    env.R2_BUCKET !== 'vanta-backups' || !/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/i.test(env.R2_ENDPOINT || '') ||
    !env.R2_ACCESS_KEY_ID?.trim() || !env.R2_SECRET_ACCESS_KEY?.trim() ||
    !(await checkDatabase(env)).passed) {
  log({ step: 'guard', passed: false, complete: true }); process.exit(10);
}
log({ step: 'guard', passed: true });
const require = createRequire(import.meta.url);
const { Client } = require('pg');
const url = new URL(env.DATABASE_URL);
const base = { host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), connectionTimeoutMillis: 5000, statement_timeout: 10000 };
const admin = new Client(base);
const id = randomUUID(), name = id.replaceAll('-', ''), source = 'vanta_r2_src_' + name, target = 'vanta_r2_dst_' + name;
const root = await mkdtemp(join(tmpdir(), 'vanta-r2-recovery-'));
const objects = [], databases = [], clients = [];
const writer = join(root, 'writer'), recovery = join(root, 'recovery'), identity = join(recovery, 'identity');
const control = join(root, 'control');
let recipient;
const bucket = env.R2_BUCKET;
let sdk, s3, step = 'database_guard', passed = false, clean = true, adminReady = false;
const timer = setTimeout(() => { log({ step: 'deadline', passed: false, cleanupUnverified: true }); process.exit(42); }, 360000);
const run = (bin, args, options = {}) => execFileSync(bin, args, { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024, ...options });
const pgEnv = { PATH: env.PATH, HOME: root, PGHOST: base.host, PGPORT: String(base.port), PGUSER: base.user, PGPASSWORD: base.password, PGCONNECT_TIMEOUT: '5' };
const send = command => s3.send(command, { abortSignal: AbortSignal.timeout(20000) });
const httpStatus = err => err?.$metadata?.httpStatusCode;
async function openDb(database) {
  const c = new Client({ ...base, database }); clients.push(c); await c.connect(); return c;
}
async function createDb(database) {
  check(database === source || database === target);
  await admin.query('CREATE DATABASE "' + database + '" TEMPLATE template0');
  databases.push(database);
  const c = await openDb(database);
  const result = await c.query("SELECT current_database() AS name, (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') AS tables");
  check(result.rows[0].name === database && result.rows[0].tables === 0);
  return c;
}
async function readBounded(file) {
  const info = await stat(file); check(info.isFile() && info.size > 0 && info.size <= MAX_BACKUP_BYTES);
  const bytes = await readFile(file); check(bytes.length === info.size); return bytes;
}
async function upload(kind, file, maxBytes) {
  const cipher = await readBounded(file);
  const item = { objectKey: 'acceptance/pr-282/' + id + '/' + kind, hash: sha256(cipher), size: cipher.length };
  objects.push(item);
  return uploadEncryptedArtifact({ client: s3, sdk, bucket, runId: id, kind, file,
    maxBytes });
}
async function download(item, basename) {
  const response = await send(new sdk.GetObjectCommand({ Bucket: bucket, Key: item.key }));
  check(response.ContentLength === item.bytes && response.Metadata?.['test-id'] === id && response.Metadata?.sha256 === item.sha256);
  const chunks = []; let length = 0;
  for await (const chunk of response.Body) { length += chunk.length; check(length <= item.bytes); chunks.push(Buffer.from(chunk)); }
  const encrypted = Buffer.concat(chunks);
  check(length === item.bytes && sha256(encrypted) === item.sha256);
  const cipher = join(recovery, basename + '.age'), destination = join(recovery, basename);
  await writeFile(cipher, encrypted, { mode: 0o600, flag: 'wx' });
  run('age', ['--decrypt', '-i', identity, '-o', destination, cipher], { env: { PATH: env.PATH, HOME: recovery } });
  return { destination, bytes: (await stat(destination)).size };
}
function encryptManifest(bytes) {
  const path = join(writer, 'manifest.json.age');
  run('bash', ['backend/scripts/backup-age-encrypt.sh', path], {
    input: bytes, stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: env.PATH, HOME: writer, VANTA_BACKUP_AGE_RECIPIENT: recipient },
  });
  return path;
}

try {
  await admin.connect(); adminReady = true;
  const { rows: [server] } = await admin.query("SELECT current_database() AS name, current_setting('server_version_num')::int AS version, pg_is_in_recovery() AS standby");
  check(server.name === base.database && !server.standby && Math.floor(server.version / 10000) === 18);
  for (const bin of ['pg_dump', 'pg_restore']) check(/\(PostgreSQL\) 18\./.test(run(bin, ['--version']).toString()));
  step = 'fixtures';
  await mkdir(writer, { mode: 0o700 }); await mkdir(recovery, { mode: 0o700 }); await mkdir(control, { mode: 0o700 });
  run('age-keygen', ['-o', identity], { env: { PATH: env.PATH, HOME: recovery } });
  recipient = run('age-keygen', ['-y', identity], { env: { PATH: env.PATH, HOME: recovery } }).toString().trim();
  // Ephemeral drill identity only. Never request or read the owner's private key.
  const src = await createDb(source), dst = await createDb(target);
  const mediaDir = join(root, 'media'), restoredDir = join(root, 'media-restored');
  await mkdir(mediaDir, { mode: 0o700 }); await mkdir(restoredDir, { mode: 0o700 });
  const media = randomBytes(6 * 1024 * 1024), hash = sha256(media);
  await writeFile(join(mediaDir, 'fixture.bin'), media, { mode: 0o600, flag: 'wx' });
  await src.query('CREATE TABLE fixture_owner (id text PRIMARY KEY); CREATE TABLE fixture_media (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES fixture_owner(id), bytes integer NOT NULL, checksum text NOT NULL)');
  await src.query('INSERT INTO fixture_owner VALUES ($1)', ['synthetic-owner']);
  await src.query('INSERT INTO fixture_media VALUES ($1,$2,$3,$4)', ['synthetic-file', 'synthetic-owner', media.length, hash]);
  const expected = (await src.query('SELECT * FROM fixture_media ORDER BY id')).rows;
  step = 'sdk';
  const sdkRequire = createRequire(new URL('../backup-runtime/package.json', import.meta.url));
  const runtimeLock = JSON.parse(await readFile(new URL('../backup-runtime/package-lock.json', import.meta.url), 'utf8'));
  check(runtimeLock.packages?.['node_modules/@aws-sdk/client-s3']?.version === '3.1178.0');
  sdk = sdkRequire('@aws-sdk/client-s3');
  s3 = new sdk.S3Client({ region: 'auto', endpoint: env.R2_ENDPOINT, forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  const journal = await openBackupJournal(control);
  const pair = generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({type:'pkcs8',format:'pem'});
  const publicKey = pair.publicKey.export({type:'spki',format:'pem'});
  const signerFingerprint = createHash('sha256').update(pair.publicKey.export({type:'spki',format:'der'})).digest('hex');
  let writeBlocked = false, fenceReleased = false, sourceLost = false;
  src.on('error',()=>{sourceLost=true}); src.on('end',()=>{sourceLost=true});
  const start = Date.now();
  step = 'orchestration';
  const result = await runBackupSet({ scope:'acceptance',runId:id,
    policy:{enabled:true,ownerApproved:true,recoveryCopiesVerified:true,recipientVerified:true,credentialsRotated:true,
      dependencyLockVerified:true,databaseLimitBytes:1024*1024,mediaLimitBytes:MAX_BACKUP_BYTES,manifestLimitBytes:64*1024},
    adapters:{
      acquireExclusiveWriter:()=>journal.acquireExclusiveWriter(),
      measureCapacity:async()=>({...await measureR2Inventory({client:s3,sdk,bucket}),
        nowMs:Date.now(),scratchFreeBytes:await measureScratchFreeBytes(writer),unresolvedAttempt:await journal.unresolvedAttempt()}),
      beginAttempt:args=>journal.beginAttempt(args),
      fenceSources:async()=>{
        const healthy=async()=>{
          if(sourceLost)return false;
          try{
            const q=await src.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()");
            return !sourceLost&&q.rows[0]?.n===0;
          }catch{return false;}
        };
        check(await healthy()); await src.query('BEGIN');
        try{
          await src.query("SET LOCAL lock_timeout='3s'");
          await src.query('LOCK TABLE fixture_owner, fixture_media IN SHARE MODE');
          const contender=new Client({...base,database:source});
          try{
            await contender.connect(); await contender.query("SET lock_timeout='500ms'");
            try{await contender.query("INSERT INTO fixture_owner VALUES ('must-not-write')");}
            catch(e){writeBlocked=e.code==='55P03';}
          }finally{await contender.end();}
          check(writeBlocked&&await healthy());
          return {healthy,release:async()=>{await src.query('ROLLBACK');fenceReleased=true;}};
        }catch{await src.query('ROLLBACK').catch(()=>{});throw Error('Scratch fence failed');}
      },
      capture:async(kind,maxBytes)=>{
        const output=join(writer,kind),isDb=kind==='database.dump.age';
        const captured=await captureEncryptedArtifact({producer:isDb?'pg_dump':'tar',
          args:isDb?['--format=custom','--no-owner','--no-acl','--dbname',source]:['-C',mediaDir,'-cf','-','fixture.bin'],
          producerEnv:isDb?pgEnv:{PATH:env.PATH,HOME:writer},recipient,output,maxBytes});
        if(!isDb)check(sha256(await readBounded(join(mediaDir,'fixture.bin')))===hash);
        return {path:output,bytes:captured.bytes};
      },
      upload:async(kind,file,maxBytes)=>{check(fenceReleased);return upload(kind,file,maxBytes);},
      signManifest:args=>signBackupManifest({...args,privateKey}),
      encryptManifest:async(bytes,maxBytes)=>{const path=encryptManifest(bytes),size=(await stat(path)).size;check(size<=maxBytes);return {path,bytes:size};},
      recordVerifiedTransfer:args=>journal.recordVerifiedTransfer(args),
      recordFailure:args=>journal.recordFailure(args),
      cleanupLocal:async()=>{},
    }});
  const recorded=await (await openBackupJournal(control)).readCurrent();
  check(result.transferVerified&&!result.independentRestoreVerified&&recorded?.runId===id&&recorded.state==='transfer_verified'&&
    recorded.independentRestoreVerified===false&&writeBlocked&&fenceReleased&&objects.length===3);
  log({step,passed:true,writeBlocked,sourceFenceReleasedBeforeUpload:fenceReleased,durableJournalReopened:true,
    signedEncryptedMarker:true,independentRestoreRecorded:false,lockedSdk:true});
  step='manifest';
  const marker=await download(result.marker,'manifest.json');
  const {manifest}=verifySignedBackupManifest({bytes:await readFile(marker.destination),publicKey,expectedFingerprint:signerFingerprint,
    expectedRunId:id,scope:'acceptance'});
  check(JSON.stringify(manifest)===JSON.stringify(recorded.manifest));
  log({step,passed:true,signatureVerified:true,artifactCount:manifest.artifacts.length});
  step='download';
  const db=await download(manifest.artifacts[0],'db.dump'),files=await download(manifest.artifacts[1],'media.tar');
  log({step,passed:true,databaseBytes:db.bytes,mediaBytes:files.bytes});
  step = 'restore';
  const restoreStarted = Date.now();
  run('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '--dbname', target, db.destination], { env: pgEnv });
  // The only accepted archive is the authenticated tar generated above; assert
  // its exact single fixed entry before extraction.
  check(run('tar', ['-tf', files.destination]).toString().trim() === 'fixture.bin');
  run('tar', ['-C', restoredDir, '--no-same-owner', '--no-same-permissions', '-xf', files.destination]);
  const actual = (await dst.query('SELECT * FROM fixture_media ORDER BY id')).rows;
  check(JSON.stringify(actual) === JSON.stringify(expected));
  check(sha256(await readBounded(join(restoredDir, 'fixture.bin'))) === hash);
  check((await dst.query('SELECT count(*)::int AS n FROM fixture_media m JOIN fixture_owner o ON o.id=m.owner_id')).rows[0].n === 1);
  let constraintRejected = false;
  try { await dst.query("INSERT INTO fixture_media VALUES ('invalid','missing',1,'invalid')"); }
  catch (e) { constraintRejected = e.code === '23503'; }
  check(constraintRejected);
  log({ step, passed: true, rowsMatch: true, mediaChecksum: true, foreignKeyEnforced: true,
    syntheticBackupAgeMs: restoreStarted - start, restoreValidationMs: Date.now() - restoreStarted });
  passed = true;
} catch (e) {
  log({ step, passed: false, httpStatus: Number.isInteger(httpStatus(e)) ? httpStatus(e) : null, assertion: e?.message === 'acceptance assertion' });
} finally {
  let removed = 0;
  for (const obj of objects) {
    try {
      let h;
      try { h = await send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: obj.objectKey })); }
      catch (e) { check(httpStatus(e) === 404); }
      if (h) {
        check(h.ContentLength === obj.size && h.Metadata?.['test-id'] === id && h.Metadata?.sha256 === obj.hash);
        await send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: obj.objectKey }));
      }
      try { await send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: obj.objectKey })); throw new Error('still present'); }
      catch (e) { check(httpStatus(e) === 404); }
      const pending = await send(new sdk.ListMultipartUploadsCommand({ Bucket: bucket, Prefix: obj.objectKey, MaxUploads: 10 }));
      check(!pending.IsTruncated && !(pending.Uploads ?? []).some(x => x.Key === obj.objectKey));
      removed++;
    } catch { clean = false; }
  }
  s3?.destroy();
  for (const c of clients) await c.end().catch(() => { clean = false; });
  let dropped = 0;
  if (adminReady) for (const database of databases.reverse()) {
    try { check(database === source || database === target); await admin.query('DROP DATABASE "' + database + '"'); dropped++; } catch { clean = false; }
  }
  await admin.end().catch(() => { clean = false; });
  await rm(root, { recursive: true, force: true }).catch(() => { clean = false; });
  clearTimeout(timer);
  log({ step: 'cleanup', passed: clean, createdObjects: objects.length, removedObjects: removed, createdDatabases: databases.length, droppedDatabases: dropped, reconciliationPrefix: clean ? undefined : 'acceptance/pr-282/' + id });
  log({ complete: true, passed: passed && clean && removed === 3 && dropped === 2, scope: 'synthetic_orchestrated_scratch_postgres_lock_signed_marker_same_cluster_ephemeral_keys' });
  process.exitCode = passed && clean && removed === 3 && dropped === 2 ? 0 : 1;
}
