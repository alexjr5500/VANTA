import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAcceptanceConfig } from './acceptance-preflight.mjs';
const sha = 'a'.repeat(40);
const env = {
  VANTA_ACCEPTANCE_PREFLIGHT: 'yes',
  RAILWAY_PROJECT_ID: '7e1dc607-2d36-4b63-a833-0f7dd88210be',
  RAILWAY_ENVIRONMENT_ID: '5f4aefe1-9ca5-47bd-aba5-4b627d0738ee',
  RAILWAY_SERVICE_ID: '810d5bba-675a-42be-b29f-91ab79e07eba',
  RAILWAY_ENVIRONMENT_NAME: 'staging', RAILWAY_GIT_COMMIT_SHA: sha,
  VANTA_ACCEPTANCE_EXPECTED_SHA: sha,
  VANTA_ACCEPTANCE_DATABASE_HOST: 'synthetic-db.railway.internal',
  DATABASE_URL: 'postgresql://synthetic:synthetic@synthetic-db.railway.internal:5432/fixture',
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
