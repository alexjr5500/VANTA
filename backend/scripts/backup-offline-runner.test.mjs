import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { checkOfflineConfig } from './backup-offline-runner.mjs';
const env={
  VANTA_BACKUP_OFFLINE_CAPTURE:'yes',VANTA_BACKUP_ALL_WRITERS_STOPPED:'yes',VANTA_BACKUP_RECOVERY_COPIES_VERIFIED:'yes',
  VANTA_BACKUP_RECIPIENT_VERIFIED:'yes',VANTA_BACKUP_CREDENTIALS_ROTATED:'yes',
  RAILWAY_PROJECT_ID:'a05242c0-8a26-40b0-a88d-e338e96eec55',RAILWAY_ENVIRONMENT_ID:'4a6d43ce-571f-4d85-8abe-c7c5f19ed920',
  RAILWAY_SERVICE_ID:'c0231973-3822-4d57-b3d0-a5df671dfacf',RAILWAY_ENVIRONMENT_NAME:'production',
  VANTA_BACKUP_EXPECTED_SHA:'a'.repeat(40),RAILWAY_GIT_COMMIT_SHA:'a'.repeat(40),VANTA_BACKUP_APPROVED_RUN_ID:randomUUID(),
  VANTA_BACKUP_AGE_RECIPIENT:'age1'+'a'.repeat(58),VANTA_BACKUP_R2_ENDPOINT:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com',
  VANTA_BACKUP_R2_BUCKET:'vanta-backups',VANTA_BACKUP_R2_ACCESS_KEY_ID:'synthetic',VANTA_BACKUP_R2_SECRET_ACCESS_KEY:'synthetic',
  VANTA_BACKUP_SIGNING_PUBLIC_FINGERPRINT:'b'.repeat(64),VANTA_BACKUP_SIGNING_PRIVATE_KEY:'synthetic',
  VANTA_BACKUP_EXPECTED_DB_HOST:'postgres.railway.internal',DATABASE_URL:'postgresql://test:test@postgres.railway.internal:5432/test',
  VANTA_BACKUP_DATABASE_LIMIT_BYTES:'268435456',VANTA_BACKUP_MEDIA_LIMIT_BYTES:'536870912',VANTA_BACKUP_R2_BUDGET_BYTES:'8000000000',
};
test('offline configuration requires exact production identity, revision, maintenance approval and budgets',()=>{
  assert.equal(checkOfflineConfig(env,1).databaseLimitBytes,268435456);
  assert.throws(()=>checkOfflineConfig({},1));
  assert.throws(()=>checkOfflineConfig(env,2));
  for(const key of ['VANTA_BACKUP_OFFLINE_CAPTURE','VANTA_BACKUP_ALL_WRITERS_STOPPED','VANTA_BACKUP_RECOVERY_COPIES_VERIFIED',
    'VANTA_BACKUP_CREDENTIALS_ROTATED','VANTA_BACKUP_SIGNING_PRIVATE_KEY','VANTA_BACKUP_APPROVED_RUN_ID','RAILWAY_GIT_COMMIT_SHA','RAILWAY_SERVICE_ID'])
    assert.throws(()=>checkOfflineConfig({...env,[key]:undefined},1),key);
  assert.throws(()=>checkOfflineConfig({...env,DATABASE_URL:'postgresql://test:test@unrelated.example/test'},1));
  assert.throws(()=>checkOfflineConfig({...env,VANTA_BACKUP_R2_BUDGET_BYTES:'8000000001'},1));
});
