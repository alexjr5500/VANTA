import { DistributedMaintenance, maintenanceConnectionUrl } from '../services/distributed-maintenance';

describe('maintenance configuration', () => {
  it('is disabled by default and requires a direct database endpoint when enabled', () => {
    expect(maintenanceConnectionUrl({})).toBeNull();
    expect(() => maintenanceConnectionUrl({ VANTA_DISTRIBUTED_MAINTENANCE_ENABLED: 'true' })).toThrow();
    expect(() => maintenanceConnectionUrl({ VANTA_DISTRIBUTED_MAINTENANCE_ENABLED: 'true',
      VANTA_MAINTENANCE_DIRECT_DATABASE_URL: 'postgresql://test:test@localhost/db?pgbouncer=true' })).toThrow();
  });
  it('does not multiply local work when coordination is disabled', async () => {
    const runner = new DistributedMaintenance(null);
    let finish!: () => void;
    const first = runner.run('liveSweep', () => new Promise<void>(resolve => { finish = resolve; }));
    try {
      await expect(runner.run('liveSweep', async () => { throw Error('must not run'); })).resolves.toBe('busy');
    } finally { finish(); }
    await expect(first).resolves.toBe('completed');
  });
});

const url = process.env.VANTA_CI_MAINTENANCE_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('distributed maintenance with independent PostgreSQL sessions', () => {
  it('prevents overlapping ownership, allows independent tasks, and releases after completion', async () => {
    const first = new DistributedMaintenance(url!);
    const second = new DistributedMaintenance(url!);
    let started!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const running = first.run('liveSweep', async () => { started(); await gate; });
    try {
      await Promise.race([entered, running.then(() => { throw Error('lock not acquired'); })]);
      const blocked = jest.fn(async () => {});
      await expect(second.run('liveSweep', blocked)).resolves.toBe('busy');
      expect(blocked).not.toHaveBeenCalled();
      await expect(second.run('oauthSweep', async () => {})).resolves.toBe('completed');
    } finally {
      finish();
      await running;
    }
    await expect(second.run('liveSweep', async () => {})).resolves.toBe('completed');
  }, 15000);
  it('releases the session lock on task failure without retrying unlocked', async () => {
    const first = new DistributedMaintenance(url!);
    const second = new DistributedMaintenance(url!);
    await expect(first.run('rewardExpiry', async () => { throw Error('task failed'); })).rejects.toThrow('Maintenance task or coordination failed');
    await expect(second.run('rewardExpiry', async () => {})).resolves.toBe('completed');
  }, 15000);
  it('does not execute work when PostgreSQL is unavailable', async () => {
    const runner = new DistributedMaintenance('postgresql://test:test@127.0.0.1:1/test');
    const work = jest.fn(async () => {});
    await expect(runner.run('verificationExpiry', work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  }, 10000);
});
