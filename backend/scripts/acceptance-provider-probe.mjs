import { writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { checkAcceptanceConfig } from './acceptance-preflight.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const log = (event, result) => writeSync(1, '[ACCEPTANCE PROBE] ' + event + ' ' + JSON.stringify(result) + '\n');

// A read-only authenticated Admin API ping. No assets or account identifiers
// are listed; no credentials, response bodies or arbitrary errors are logged.
export async function pingProvider(env, request = fetch) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(env.CLOUDINARY_CLOUD_NAME || '') ||
      !env.CLOUDINARY_API_KEY || env.CLOUDINARY_API_KEY.includes(':') || !env.CLOUDINARY_API_SECRET) {
    return { passed: false, reason: 'invalid_credential_format' };
  }
  try {
    const response = await request('https://api.cloudinary.com/v1_1/' + env.CLOUDINARY_CLOUD_NAME + '/ping', {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Basic ' + Buffer.from(env.CLOUDINARY_API_KEY + ':' + env.CLOUDINARY_API_SECRET).toString('base64'),
        Accept: 'application/json' },
    });
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel().catch(() => {});
      return { passed: false, httpStatus: response.status };
    }
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks = [];
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) return { passed: false, reason: 'response_limit' };
        chunks.push(Buffer.from(value));
      }
      return { passed: JSON.parse(Buffer.concat(chunks).toString('utf8')).status === 'ok', httpStatus: response.status };
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch { return { passed: false, reason: 'provider_request_failed' }; }
}

export async function checkDatabase(env, createClient = () => {
  const {PrismaClient} = require('@prisma/client');
  return new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
}) {
  let client;
  try {
    client = createClient();
    return await client.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
      const [state] = await tx.$queryRawUnsafe("SELECT pg_is_in_recovery() AS standby, current_setting('transaction_read_only') = 'on' AS read_only");
      const [schema] = await tx.$queryRawUnsafe(`SELECT
        to_regclass('public."QueueJob"') IS NOT NULL AS queue,
        (SELECT count(*) = 3 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'UploadedFile' AND column_name IN ('optimizedUrl','thumbnailUrl','hlsUrl')) AS derivatives,
        (SELECT count(DISTINCT migration_name) = 2 FROM public."_prisma_migrations" WHERE migration_name IN ('20261121000000_durable_queue','20261122170000_cloudinary_media_derivatives') AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations`);
      const result = { primary: state?.standby === false, readOnly: state?.read_only === true, queue: schema?.queue === true, derivatives: schema?.derivatives === true, migrations: schema?.migrations === true };
      return {passed: Object.values(result).every(Boolean), ...result};
    }, {maxWait: 5000, timeout: 12000});
  } catch { return {passed:false,reason:'database_probe_failed'}; }
  finally { if (client) await client.$disconnect().catch(() => {}); }
}

export async function runProbe(env, role, provider = pingProvider, database = checkDatabase) {
  const guard = checkAcceptanceConfig(env, role);
  log('guard', guard);
  if (!guard.passed) return 10;
  const db = await database(env);
  log('database', db);
  if (!db.passed) return 40;
  const result = await provider(env);
  log('provider', result);
  return result.passed ? 0 : 41;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  log('begin', {});
  // Bound entire execution even if a database connect/disconnect stalls.
  const deadline = setTimeout(() => {log('deadline', {passed:false}); process.exit(42);}, 35000);
  try { process.exitCode = await runProbe(process.env, process.argv[2]); }
  catch { log('unexpected_failure', {passed:false}); process.exitCode = 43; }
  finally { clearTimeout(deadline); }
}
