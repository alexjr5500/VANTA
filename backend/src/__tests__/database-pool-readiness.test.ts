import { configureDatabasePool, calculateConnectionBudget } from '../config/database-pool';
import { evaluateReplicaReadiness, evaluateReplicaIdentity, ReplicaState } from '../services/database-replica-readiness';

describe('database connection budget', () => {
  const url = 'postgresql://test:test@localhost/db?schema=public&sslmode=require';
  it('preserves existing configuration when not opted in', () => {
    expect(configureDatabasePool(url, {})).toBe(url);
  });
  it('applies explicit bounds without losing other connection parameters', () => {
    const configured = new URL(configureDatabasePool(url, {
      VANTA_DB_CONNECTION_LIMIT: '8', VANTA_DB_POOL_TIMEOUT_SECONDS: '5',
    }));
    expect(configured.searchParams.get('connection_limit')).toBe('8');
    expect(configured.searchParams.get('pool_timeout')).toBe('5');
    expect(configured.searchParams.get('schema')).toBe('public');
    expect(configured.searchParams.get('sslmode')).toBe('require');
  });
  it('rejects unlimited or invalid pool settings without exposing credentials', () => {
    for (const value of ['0', '-1', '1.5', '101', '']) {
      expect(() => configureDatabasePool(url, { VANTA_DB_CONNECTION_LIMIT: value }))
        .toThrow('Invalid database pool setting: VANTA_DB_CONNECTION_LIMIT');
    }
    expect(() => configureDatabasePool('invalid-secret', { VANTA_DB_CONNECTION_LIMIT: '8' }))
      .toThrow('Invalid database URL for pool configuration');
  });
  it('budgets combined application and worker pools, including operational reserve', () => {
    const plan = { applicationReplicas: 3, applicationPool: 8, workerReplicas: 2,
      workerPool: 4, reservedConnections: 10, databaseMaxConnections: 50 };
    expect(calculateConnectionBudget(plan)).toEqual({
      estimatedConnections: 42, remainingConnections: 8, withinBudget: true,
    });
    expect(calculateConnectionBudget({ ...plan, applicationReplicas: 5 }).withinBudget).toBe(false);
  });
});

describe('read replica readiness', () => {
  const state: ReplicaState = { inRecovery: true, readOnly: true, replayLsn: '0/1234', receiverStreaming: true };
  it('blocks a primary masquerading as a replica, even if it is configured read-only', () => {
    expect(evaluateReplicaReadiness(false, { ...state, inRecovery: false }, 0).reason).toBe('not_read_replica');
    expect(evaluateReplicaReadiness(true, state, 0).reason).toBe('primary_in_recovery');
    expect(evaluateReplicaReadiness(false, { ...state, readOnly: false }, 0).reason).toBe('not_read_replica');
  });
  it('blocks missing receiver, unknown lag and excessive WAL lag', () => {
    expect(evaluateReplicaReadiness(false, { ...state, receiverStreaming: false }, 0).reason).toBe('receiver_not_streaming');
    expect(evaluateReplicaReadiness(false, state, null).reason).toBe('lag_unknown');
    expect(evaluateReplicaReadiness(false, state, -1).reason).toBe('lag_unknown');
    expect(evaluateReplicaReadiness(false, state, 11, 10).reason).toBe('lag_exceeded');
    expect(evaluateReplicaReadiness(false, state, 10, 10).status).toBe('ready');
  });
});

describe('replica identity gate', () => {
  const primary = { systemId: '1234567890123456789', database: 'test' };
  it('rejects unrelated clusters, wrong databases and unknown identifiers', () => {
    expect(evaluateReplicaIdentity(primary, { ...primary, systemId: '222' })?.reason).toBe('cluster_mismatch');
    expect(evaluateReplicaIdentity(primary, { ...primary, database: 'other' })?.reason).toBe('database_mismatch');
    expect(evaluateReplicaIdentity(primary, { ...primary, systemId: null })?.reason).toBe('cluster_identity_unknown');
    expect(evaluateReplicaIdentity(primary, primary)).toBeNull();
  });
});
