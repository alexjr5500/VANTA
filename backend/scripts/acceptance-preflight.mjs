import { pathToFileURL } from 'node:url';
import { writeSync } from 'node:fs';

// Deliberately scoped to PR #282's existing, isolated Railway services.
const projectId = '7e1dc607-2d36-4b63-a833-0f7dd88210be';
const environmentId = '5f4aefe1-9ca5-47bd-aba5-4b627d0738ee';
const dedicatedDatabaseHost = 'postgres-uh7w.railway.internal';
const services = {
  http: '810d5bba-675a-42be-b29f-91ab79e07eba',
  worker: '0e6688b1-f83d-4518-8716-419615804bcf',
};
const cloud = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const auth = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'ENCRYPTION_SALT'];
const flags = ['VANTA_DURABLE_QUEUE_MEDIA_HANDLERS', 'VANTA_DURABLE_QUEUE_MEDIA_PRODUCER',
  'VANTA_DURABLE_QUEUE_MEDIA_DELIVERY', 'VANTA_DURABLE_WORKER_ENABLED'];

/** Configuration-only validation; no database connections or provider calls. */
export function checkAcceptanceConfig(env, role) {
  const issues = [];
  if (!Object.hasOwn(services, role)) return { passed: false, issues: ['invalid_role'] };
  if (env.VANTA_ACCEPTANCE_PREFLIGHT !== 'yes') issues.push('explicit_approval_required');
  if (env.RAILWAY_PROJECT_ID !== projectId) issues.push('wrong_project_id');
  if (env.RAILWAY_ENVIRONMENT_ID !== environmentId) issues.push('wrong_environment_id');
  if (env.RAILWAY_SERVICE_ID !== services[role]) issues.push('wrong_service_id');
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'staging') issues.push('wrong_environment_name');
  if (!/^[a-f0-9]{40}$/.test(env.VANTA_ACCEPTANCE_EXPECTED_SHA || '')) issues.push('invalid_expected_sha');
  if (!env.RAILWAY_GIT_COMMIT_SHA) issues.push('missing_runtime_git_sha');
  else if (env.RAILWAY_GIT_COMMIT_SHA !== env.VANTA_ACCEPTANCE_EXPECTED_SHA) issues.push('commit_mismatch');
  // Expected hostname must be taken from the independently verified dedicated
  // database's Railway private networking configuration, not from DATABASE_URL.
  const expectedHost = env.VANTA_ACCEPTANCE_DATABASE_HOST || '';
  if (expectedHost !== dedicatedDatabaseHost) issues.push('wrong_expected_database_host');
  try {
    const db = new URL(env.DATABASE_URL || '');
    if (!['postgres:', 'postgresql:'].includes(db.protocol)) issues.push('invalid_database_protocol');
    if (db.hostname !== dedicatedDatabaseHost || db.hostname !== expectedHost) issues.push('database_host_mismatch');
    if (!db.username || !db.password) issues.push('missing_database_auth');
    if (db.pathname.length <= 1) issues.push('missing_database_name');
    // pg connection options can override the URL authority or select a
    // different target. Only the known Railway connection options are allowed.
    if ([...db.searchParams.keys()].some(key => !['sslmode', 'connect_timeout', 'connection_limit', 'pool_timeout'].includes(key))) {
      issues.push('unexpected_database_url_option');
    }
  } catch { issues.push('invalid_database_url'); }
  if (env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE !== 'cloudinary') issues.push('wrong_storage_mode');
  for (const key of [...cloud, ...(role === 'http' ? auth : [])]) {
    if (!env[key]?.trim()) issues.push('missing_' + key);
  }
  // Initial setup must not process jobs or publish derivatives. Activation
  // is separate, after isolated database and provider acceptance.
  for (const key of flags) {
    if (env[key] !== undefined && env[key] !== 'false') issues.push('unsafe_initial_' + key);
  }
  if (env.VANTA_COIN_PAYMENT_MODE === 'test') issues.push('test_payment_mode_not_allowed');
  if (env.VANTA_PROVISION_SCHEMA_ON_START?.toLowerCase() === 'true') issues.push('automatic_schema_provisioning_not_allowed');
  return { passed: issues.length === 0, role, issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeSync(1, '[ACCEPTANCE] preflight.begin\n');
  const report = checkAcceptanceConfig(process.env, process.argv[2]);
  writeSync(1, '[ACCEPTANCE] preflight.result ' + JSON.stringify(report) + '\n');
  process.exitCode = report.passed ? 0 : 10;
}
