import { spawn } from 'node:child_process';
import path from 'node:path';
// Disabled by default. Use the backend's mounted volume; no second volume owner.
// Schedule at 03:10–03:59 UTC, after the 02:10 UTC database job. Single flight,
// daily journal and remote no-overwrite enforce at most one committed set.
export function mediaBackupWindow(now: Date): boolean {
  return now.getUTCHours() === 3 && now.getUTCMinutes() >= 10;
}
export async function runMediaBackupWindow(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.VANTA_MEDIA_BACKUP_ENABLED !== 'yes' || env.VANTA_MEDIA_BACKUP_OWNER_APPROVED !== 'yes' || !mediaBackupWindow(new Date())) return;
  const allowed = ['PATH','UPLOAD_STORAGE_DIR','RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','RAILWAY_ENVIRONMENT_NAME','RAILWAY_GIT_COMMIT_SHA','VANTA_BACKUP_AGE_RECIPIENT','VANTA_BACKUP_R2_BUCKET','VANTA_BACKUP_R2_ENDPOINT','VANTA_BACKUP_ALERTS_ENABLED','VANTA_BACKUP_ALERT_FROM','VANTA_BACKUP_ALERT_TO','VANTA_BACKUP_ALERT_SENDGRID_KEY','VANTA_MEDIA_BACKUP_ENABLED','VANTA_MEDIA_BACKUP_OWNER_APPROVED','VANTA_MEDIA_BACKUP_EXPECTED_SHA','VANTA_MEDIA_BACKUP_R2_ACCESS_KEY_ID','VANTA_MEDIA_BACKUP_R2_SECRET_ACCESS_KEY','VANTA_MEDIA_BACKUP_SIGNER_FINGERPRINT','VANTA_MEDIA_BACKUP_SIGNER_PRIVATE_KEY','VANTA_MEDIA_BACKUP_LIMIT_BYTES','VANTA_MEDIA_BACKUP_BUDGET_BYTES'];
  const childEnv = Object.fromEntries(allowed.filter(k => env[k] !== undefined).map(k => [k, env[k]]));
  await new Promise<void>((resolve,reject) => {
    const child = spawn(process.execPath,[path.resolve(__dirname,'../../scripts/backup-media-daily.mjs')],{env:childEnv,stdio:['ignore','inherit','inherit']});
    const timer=setTimeout(()=>child.kill('SIGKILL'),910000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error('Media backup task failed'));});
  });
}
