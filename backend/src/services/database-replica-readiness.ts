import { Client } from 'pg';

export interface ReplicaState {
  inRecovery: boolean;
  readOnly: boolean;
  replayLsn: string | null;
  receiverStreaming: boolean;
}
export interface ReplicaReadiness {
  status: 'ready' | 'blocked';
  reason: 'ok' | 'primary_in_recovery' | 'not_read_replica' | 'receiver_not_streaming' | 'lag_unknown' | 'lag_exceeded';
  replayLagBytes: number | null;
}

export function evaluateReplicaReadiness(
  primaryInRecovery: boolean,
  replica: ReplicaState,
  lagBytes: number | null,
  maxLagBytes = 16 * 1024 * 1024,
): ReplicaReadiness {
  if (!Number.isSafeInteger(maxLagBytes) || maxLagBytes < 0) throw new Error('Invalid replica lag limit');
  const blocked = (reason: ReplicaReadiness['reason'], replayLagBytes: number | null = null): ReplicaReadiness =>
    ({ status: 'blocked', reason, replayLagBytes });
  if (primaryInRecovery) return blocked('primary_in_recovery');
  if (!replica.inRecovery || !replica.readOnly) return blocked('not_read_replica');
  if (!replica.receiverStreaming) return blocked('receiver_not_streaming');
  if (!replica.replayLsn || lagBytes === null || !Number.isSafeInteger(lagBytes) || lagBytes < 0) return blocked('lag_unknown');
  if (lagBytes > maxLagBytes) return blocked('lag_exceeded', lagBytes);
  return { status: 'ready', reason: 'ok', replayLagBytes: lagBytes };
}

/**
 * Read-only, explicit staging probe. LSN comparison assumes both endpoints
 * belong to the same verified replication topology; this does not prove identity.
 * No client is exported or used to route application queries.
 */
export async function probeReplica(primaryUrl: string, replicaUrl: string): Promise<ReplicaReadiness> {
  if (!primaryUrl || !replicaUrl || primaryUrl === replicaUrl) throw new Error('Distinct database endpoints required');
  const options = { connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 };
  const primary = new Client({ ...options, connectionString: primaryUrl });
  const replica = new Client({ ...options, connectionString: replicaUrl });
  // Suppress raw connection errors; the caller reports only a generic failure.
  primary.on('error', () => {});
  replica.on('error', () => {});
  try {
    await primary.connect();
    await replica.connect();
    const p = await primary.query<{ recovery: boolean }>('SELECT pg_is_in_recovery() AS recovery');
    const r = await replica.query<{ recovery: boolean; read_only: string; replay_lsn: string | null; streaming: boolean }>(
      "SELECT pg_is_in_recovery() AS recovery, current_setting('transaction_read_only') AS read_only, " +
      "pg_last_wal_replay_lsn()::text AS replay_lsn, EXISTS (SELECT 1 FROM pg_stat_wal_receiver WHERE status = 'streaming') AS streaming",
    );
    const row = r.rows[0];
    const state = { inRecovery: row.recovery, readOnly: row.read_only === 'on',
      replayLsn: row.replay_lsn, receiverStreaming: row.streaming };
    // A primary or disconnected receiver is blocked without evaluating WAL distance.
    const initial = evaluateReplicaReadiness(p.rows[0].recovery, state, null);
    if (initial.reason !== 'lag_unknown' || !state.replayLsn) return initial;
    const lag = await primary.query<{ lag: string | null }>(
      'SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn)::text AS lag', [state.replayLsn],
    );
    const raw = lag.rows[0].lag;
    return evaluateReplicaReadiness(false, state, raw === null ? null : Number(raw));
  } finally {
    await Promise.allSettled([primary.end(), replica.end()]);
  }
}
