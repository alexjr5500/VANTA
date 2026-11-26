import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkAcceptanceConfig } from './acceptance-preflight.mjs';
import { checkDatabase } from './acceptance-provider-probe.mjs';
import { encryptBackup, decryptBackup, sha256, MAX_BACKUP_BYTES } from './backup-envelope.mjs';

const log = x => console.log('[R2 RECOVERY 282] ' + JSON.stringify(x));
const check = value => { if (!value) throw new Error('acceptance assertion'); };
const env = process.env;
if (env.VANTA_R2_RECOVERY_ACCEPTANCE !== 'yes' || !checkAcceptanceConfig(env, 'worker').passed ||
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
const key = randomBytes(32), objects = [], databases = [], clients = [];
const bucket = env.R2_BUCKET;
let sdk, s3, step = 'database_guard', passed = false, clean = true, adminReady = false;
const timer = setTimeout(() => { log({ step: 'deadline', passed: false, cleanupUnverified: true }); process.exit(42); }, 240000);
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
async function archiveRoundtrip(file, basename) {
  const plain = await readBounded(file), objectKey = 'acceptance/pr-282/' + id + '/' + basename + '.enc';
  const cipher = encryptBackup(plain, key, objectKey), hash = sha256(cipher);
  const item = { objectKey, hash, size: cipher.length };
  await send(new sdk.PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: cipher, IfNoneMatch: '*',
    ContentType: 'application/octet-stream', Metadata: { 'test-id': id, sha256: hash } }));
  objects.push(item);
  const response = await send(new sdk.GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  check(response.ContentLength === cipher.length && response.Metadata?.['test-id'] === id && response.Metadata?.sha256 === hash);
  const chunks = []; let length = 0;
  for await (const chunk of response.Body) { length += chunk.length; check(length <= cipher.length); chunks.push(Buffer.from(chunk)); }
  const downloaded = Buffer.concat(chunks);
  check(length === cipher.length && sha256(downloaded) === hash);
  const restored = decryptBackup(downloaded, key, objectKey);
  check(sha256(restored) === sha256(plain));
  const destination = join(root, 'restored-' + basename);
  await writeFile(destination, restored, { mode: 0o600, flag: 'wx' });
  return { destination, bytes: plain.length };
}
try {
  await admin.connect(); adminReady = true;
  const { rows: [server] } = await admin.query("SELECT current_database() AS name, current_setting('server_version_num')::int AS version, pg_is_in_recovery() AS standby");
  check(server.name === base.database && !server.standby && Math.floor(server.version / 10000) === 18);
  for (const bin of ['pg_dump', 'pg_restore']) check(/\(PostgreSQL\) 18\./.test(run(bin, ['--version']).toString()));
  step = 'fixtures';
  const src = await createDb(source), dst = await createDb(target);
  const mediaDir = join(root, 'media'), restoredDir = join(root, 'media-restored');
  await mkdir(mediaDir, { mode: 0o700 }); await mkdir(restoredDir, { mode: 0o700 });
  const media = randomBytes(4096), hash = sha256(media);
  await writeFile(join(mediaDir, 'fixture.bin'), media, { mode: 0o600, flag: 'wx' });
  await src.query('CREATE TABLE fixture_owner (id text PRIMARY KEY); CREATE TABLE fixture_media (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES fixture_owner(id), bytes integer NOT NULL, checksum text NOT NULL)');
  await src.query('INSERT INTO fixture_owner VALUES ($1)', ['synthetic-owner']);
  await src.query('INSERT INTO fixture_media VALUES ($1,$2,$3,$4)', ['synthetic-file', 'synthetic-owner', media.length, hash]);
  const expected = (await src.query('SELECT * FROM fixture_media ORDER BY id')).rows;
  const dump = join(root, 'db.dump'), tar = join(root, 'media.tar');
  step = 'archive';
  const start = Date.now();
  run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dump, '--dbname', source], { env: pgEnv });
  run('tar', ['-C', mediaDir, '-cf', tar, 'fixture.bin']);
  log({ step, passed: true, sourceDataCopied: false, databaseMajor: 18 });
  step = 'sdk';
  const sdkDir = join(root, 'sdk'); await mkdir(sdkDir);
  run('npm', ['install', '--prefix', sdkDir, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '@aws-sdk/client-s3@3.1178.0'],
    { timeout: 90000, env: { PATH: env.PATH, HOME: root, npm_config_cache: join(root, 'npm-cache'), npm_config_registry: 'https://registry.npmjs.org/' } });
  sdk = createRequire(join(sdkDir, 'package.json'))('@aws-sdk/client-s3');
  s3 = new sdk.S3Client({ region: 'auto', endpoint: env.R2_ENDPOINT, forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  step = 'r2_roundtrip';
  const db = await archiveRoundtrip(dump, 'db.dump'), files = await archiveRoundtrip(tar, 'media.tar');
  log({ step, passed: true, databaseBytes: db.bytes, mediaBytes: files.bytes, encryptedObjects: objects.length });
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
      const h = await send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: obj.objectKey }));
      check(h.ContentLength === obj.size && h.Metadata?.['test-id'] === id && h.Metadata?.sha256 === obj.hash);
      await send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: obj.objectKey }));
      try { await send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: obj.objectKey })); throw new Error('still present'); }
      catch (e) { check(httpStatus(e) === 404); }
      removed++;
    } catch { clean = false; }
  }
  s3?.destroy(); key.fill(0);
  for (const c of clients) await c.end().catch(() => { clean = false; });
  let dropped = 0;
  if (adminReady) for (const database of databases.reverse()) {
    try { check(database === source || database === target); await admin.query('DROP DATABASE "' + database + '"'); dropped++; } catch { clean = false; }
  }
  await admin.end().catch(() => { clean = false; });
  await rm(root, { recursive: true, force: true }).catch(() => { clean = false; });
  clearTimeout(timer);
  log({ step: 'cleanup', passed: clean, createdObjects: objects.length, removedObjects: removed, createdDatabases: databases.length, droppedDatabases: dropped });
  log({ complete: true, passed: passed && clean && removed === 2 && dropped === 2, scope: 'synthetic_scratch_databases_same_staging_cluster_r2_ephemeral_key' });
  process.exitCode = passed && clean && removed === 2 && dropped === 2 ? 0 : 1;
}
