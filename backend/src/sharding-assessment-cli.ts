import { runShardingAssessment } from './services/sharding-assessment';

async function main() {
  const url = process.env.VANTA_STAGING_SHARDING_DATABASE_URL;
  if (process.env.VANTA_STAGING_SHARDING_ASSESSMENT !== 'yes' || !url || url === process.env.DATABASE_URL) {
    throw Error('Explicit isolated staging assessment configuration required');
  }
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw Error('PostgreSQL required');
  const candidates = await runShardingAssessment(url, process.env.VANTA_STAGING_SHARDING_SCHEMA || 'public');
  console.info(JSON.stringify({ event: 'vanta.sharding.assessment', schemaVersion: 1,
    status: 'assessment_only', candidates }));
}
void main().catch(() => {
  console.error('[ShardingAssessment] Unavailable or invalid configuration');
  process.exitCode = 2;
});
