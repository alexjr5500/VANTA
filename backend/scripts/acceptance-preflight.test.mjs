import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkAcceptanceConfig } from './acceptance-preflight.mjs';
const sha = 'a'.repeat(40);
const env = {
  VANTA_ACCEPTANCE_PREFLIGHT: 'yes',
  RAILWAY_PROJECT_ID: '7e1dc607-2d36-4b63-a833-0f7dd88210be',
  RAILWAY_ENVIRONMENT_ID: '5f4aefe1-9ca5-47bd-aba5-4b627d0738ee',
  RAILWAY_SERVICE_ID: '810d5bba-675a-42be-b29f-91ab79e07eba',
  RAILWAY_ENVIRONMENT_NAME: 'staging', RAILWAY_GIT_COMMIT_SHA: sha,
  VANTA_ACCEPTANCE_EXPECTED_SHA: sha,
  VANTA_ACCEPTANCE_DATABASE_HOST: 'postgres-uh7w.railway.internal',
  DATABASE_URL: 'postgresql://synthetic:synthetic@postgres-uh7w.railway.internal:5432/fixture',
  VANTA_DURABLE_QUEUE_MEDIA_STORAGE: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'synthetic', CLOUDINARY_API_KEY: 'synthetic', CLOUDINARY_API_SECRET: 'synthetic',
  JWT_SECRET: 'synthetic', JWT_REFRESH_SECRET: 'synthetic', ENCRYPTION_KEY: 'synthetic', ENCRYPTION_SALT: 'synthetic',
};
test('accepts configured isolated HTTP and worker scopes', () => {
  assert.equal(checkAcceptanceConfig(env, 'http').passed, true);
  assert.equal(checkAcceptanceConfig({...env, RAILWAY_SERVICE_ID: '0e6688b1-f83d-4518-8716-419615804bcf'}, 'worker').passed, true);
});
test('rejects wrong service, production environment, wrong commit and database', () => {
  for (const patch of [{RAILWAY_SERVICE_ID: 'other'}, {RAILWAY_ENVIRONMENT_NAME: 'production'},
    {RAILWAY_GIT_COMMIT_SHA: 'b'.repeat(40)}, {DATABASE_URL: 'postgresql://synthetic:synthetic@other.railway.internal/db'},
    {VANTA_ACCEPTANCE_PREFLIGHT: 'no'}]) assert.equal(checkAcceptanceConfig({...env, ...patch}, 'http').passed, false);
});
test('rejects missing secrets, active flags and wrong storage mode without exposing values', () => {
  const result = checkAcceptanceConfig({...env, CLOUDINARY_API_SECRET: '', JWT_SECRET: '',
    VANTA_DURABLE_QUEUE_MEDIA_PRODUCER: 'true', VANTA_DURABLE_QUEUE_MEDIA_STORAGE: 'local'}, 'http');
  assert.equal(result.passed, false);
  assert.ok(result.issues.includes('missing_CLOUDINARY_API_SECRET'));
  assert.ok(result.issues.includes('missing_JWT_SECRET'));
  assert.ok(result.issues.includes('unsafe_initial_VANTA_DURABLE_QUEUE_MEDIA_PRODUCER'));
  assert.ok(result.issues.includes('wrong_storage_mode'));
  assert.equal(JSON.stringify(result).includes(env.DATABASE_URL), false);
});

test('rejects a different database even if both expected and actual host agree', () => {
  const result = checkAcceptanceConfig({...env,
    VANTA_ACCEPTANCE_DATABASE_HOST: 'other.railway.internal',
    DATABASE_URL: 'postgresql://synthetic:synthetic@other.railway.internal/db'}, 'http');
  assert.ok(result.issues.includes('wrong_expected_database_host'));
  assert.ok(result.issues.includes('database_host_mismatch'));
});
test('rejects connection target overrides and automatic schema provisioning', () => {
  const result = checkAcceptanceConfig({...env,
    DATABASE_URL: env.DATABASE_URL + '?host=other.railway.internal',
    VANTA_PROVISION_SCHEMA_ON_START: 'true'}, 'http');
  assert.ok(result.issues.includes('unexpected_database_url_option'));
  assert.ok(result.issues.includes('automatic_schema_provisioning_not_allowed'));
});
test('CLI synchronously emits redacted failure reasons and explicit exit code', () => {
  const cli = fileURLToPath(new URL('./acceptance-preflight.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'http'], {
    env: {...env, RAILWAY_GIT_COMMIT_SHA: '', JWT_SECRET: '',
      CLOUDINARY_API_SECRET: 'fixture-credential-never-print'}, encoding: 'utf8',
  });
  assert.equal(result.status, 10);
  assert.match(result.stdout, /preflight\.begin/);
  assert.match(result.stdout, /missing_runtime_git_sha/);
  assert.match(result.stdout, /missing_JWT_SECRET/);
  assert.ok(!result.stdout.includes('fixture-credential-never-print'));
  assert.ok(!result.stdout.includes(env.DATABASE_URL));
  assert.equal(result.stderr, '');
  const success = spawnSync(process.execPath, [cli, 'http'], {env, encoding: 'utf8'});
  assert.equal(success.status, 0);
  assert.match(success.stdout, /"passed":true/);
});
