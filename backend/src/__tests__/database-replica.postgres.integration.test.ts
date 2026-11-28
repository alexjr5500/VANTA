import { probeReplica } from '../services/database-replica-readiness';

const url = process.env.DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;
describeWithDatabase('database replica probe against disposable PostgreSQL', () => {
  it('rejects a real writable primary even via a distinct connection URL', async () => {
    const alternate = new URL(url!);
    alternate.searchParams.set('application_name', 'replica-probe-negative-test');
    await expect(probeReplica(url!, alternate.toString())).resolves.toEqual({
      status: 'blocked', reason: 'not_read_replica', replayLagBytes: null,
    });
  }, 20000);
});
