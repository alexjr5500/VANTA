import { probeReplica } from './services/database-replica-readiness';

async function main(): Promise<void> {
  const primary = process.env.VANTA_STAGING_PRIMARY_PROBE_URL;
  const replica = process.env.VANTA_STAGING_REPLICA_PROBE_URL;
  if (process.env.VANTA_STAGING_DB_PROBE !== 'yes' || !primary || !replica ||
      primary === process.env.DATABASE_URL || replica === process.env.DATABASE_URL) {
    throw new Error('Explicit isolated database probe configuration required');
  }
  const report = await probeReplica(primary, replica);
  console.info('[DatabaseReplicaReadiness]', JSON.stringify(report));
  if (report.status !== 'ready') process.exitCode = 2;
}
void main().catch(() => {
  console.error('[DatabaseReplicaReadiness] Probe unavailable');
  process.exitCode = 2;
});
