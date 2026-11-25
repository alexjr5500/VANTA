import { Client } from 'pg';
import { probeReplica } from '../services/database-replica-readiness';

const primaryUrl = process.env.VANTA_CI_REPLICATION_PRIMARY_URL;
const standbyUrl = process.env.VANTA_CI_REPLICATION_STANDBY_URL;
const enabled = process.env.VANTA_CI_DISPOSABLE_REPLICATION === 'yes' && primaryUrl && standbyUrl;
const suite = enabled ? describe : describe.skip;

suite('physical PostgreSQL streaming replication', () => {
  it('validates an actual streaming standby and rejects a writable candidate', async () => {
    const primary = new Client({ connectionString: primaryUrl, connectionTimeoutMillis: 3000, query_timeout: 4000 });
    const standby = new Client({ connectionString: standbyUrl, connectionTimeoutMillis: 3000, query_timeout: 4000 });
    try {
      await primary.connect();
      await standby.connect();
      await primary.query('CREATE TABLE IF NOT EXISTS ci_replica_marker (id int PRIMARY KEY)');
      await primary.query('INSERT INTO ci_replica_marker VALUES (1) ON CONFLICT DO NOTHING');
      let replicated = false;
      for (let i = 0; i < 30; i++) {
        try {
          const result = await standby.query('SELECT id FROM ci_replica_marker WHERE id = 1');
          if (result.rowCount === 1) { replicated = true; break; }
        } catch { /* replay may not have created the relation yet */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      expect(replicated).toBe(true);
      await expect(probeReplica(primaryUrl!, standbyUrl!)).resolves.toMatchObject({ status: 'ready', reason: 'ok' });
      const alternate = new URL(primaryUrl!);
      alternate.searchParams.set('application_name', 'ci-writable-candidate');
      await expect(probeReplica(primaryUrl!, alternate.href)).resolves.toMatchObject({ status: 'blocked', reason: 'not_read_replica' });
    } finally {
      await Promise.allSettled([primary.end(), standby.end()]);
    }
  }, 45000);
});
