import {pathToFileURL} from 'node:url';
import {alertConfig,sendBackupAlert} from './backup-operations.mjs';
export async function runAlertDrill({env,notify=sendBackupAlert}){
  if(env.VANTA_BACKUP_ALERT_DRILL_APPROVED!=='yes'||env.DATABASE_URL||env.VANTA_BACKUP_R2_ACCESS_KEY_ID||env.VANTA_DB_BACKUP_DATABASE_URL||env.VANTA_MEDIA_BACKUP_R2_SECRET_ACCESS_KEY||env.VANTA_BACKUP_SIGNING_PRIVATE_KEY)throw Error('Isolated opt-in alert drill required');
  const config=alertConfig(env);if(!config)throw Error('Alert transport disabled');
  await notify({config,issues:['backup_alert_delivery_test'],test:true});
  return {test:true,providerAccepted:true,inboxConfirmed:false,productionFailure:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log('[VANTA BACKUP ALERT DRILL] '+JSON.stringify(await runAlertDrill({env:process.env})));}
  catch{console.error('[VANTA BACKUP ALERT DRILL] delivery_failed');process.exitCode=1;}
}
