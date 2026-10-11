/**
 * Regression tests for the production migration step.
 *
 * INCIDENT THESE PIN DOWN
 * -----------------------
 * VANTA's production Railway deploy never started. Two errors were reported:
 *
 *   P1001 "can't reach postgres.railway.internal:5432"  -> genuinely transient
 *   P3005 "The database schema is not empty"            -> PERMANENT
 *
 * The old start command retried `prisma migrate deploy` 10x, provision-db.ts
 * retried 10x more, and restartPolicyMaxRetries restarted the container. A
 * PERMANENT P3005 was therefore retried as though the database were merely
 * still starting, producing the endless migration-retry loop.
 *
 * The contract asserted here:
 *   1. P1001/P1002/... (transient) is the ONLY retryable class.
 *   2. P3005 fails IMMEDIATELY - never retried - and names the exact fix.
 *   3. A failed/drifted migration fails immediately.
 *   4. An unrecognised error fails fast (never loops on something unknown).
 *   5. Only the baseline migration is ever named for baselining.
 */

import {
  BASELINE_MIGRATION,
  buildRemediationGuidance,
  classifyMigrateError,
  isRetriableMigrateError,
  runMigrations,
  type MigrateErrorKind,
} from '../deploy/migrate-deploy';

// Stub the Prisma CLI invocation so runMigrations() can be exercised without a
// live database. `child_process` is mocked rather than a real Postgres, so the
// retry policy is asserted directly and deterministically.
jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

import { execFileSync } from 'child_process';

const mockedExecFileSync = execFileSync as unknown as jest.Mock;

/** Make the next `prisma migrate deploy` call fail with the given output. */
function failWith(output: string, code = 1): void {
  const err = Object.assign(new Error('Command failed'), {
    status: code,
    stdout: Buffer.from(''),
    stderr: Buffer.from(output),
  });
  mockedExecFileSync.mockImplementationOnce(() => {
    throw err;
  });
}

/** Make EVERY subsequent `prisma migrate deploy` call fail (exhausts retries). */
function failAlwaysWith(output: string, code = 1): void {
  const err = Object.assign(new Error('Command failed'), {
    status: code,
    stdout: Buffer.from(''),
    stderr: Buffer.from(output),
  });
  mockedExecFileSync.mockImplementation(() => {
    throw err;
  });
}


const P1001 = `
Environment variables loaded from .env
Error: P1001: Can't reach database server at \`postgres.railway.internal\`:\`5432\`
Please make sure your database server is running at \`postgres.railway.internal\`:\`5432\`.
`;

const P3005 = `
Environment variables loaded from .env
Error: P3005

The database schema is not empty. Read more about how to baseline an existing
database: https://pris.ly/d/migrate-baseline
`;

const P3009 = `
Error: P3009
migrate found failed migrations in the target database, the
\`20261006000000_transfer_otp_challenges\` migration started at ...
`;

const P3018 = `
Error: P3018
A migration failed to apply cleanly to the shadow database.
`;

const P3018_MODIFIED = `
Error: P3018
The migration \`20261005000000_baseline_production_schema\` was modified after it was applied.
`;

describe('classifyMigrateError', () => {
  describe('transient connection failures are the only retryable class', () => {
    const transient: Array<[string, string]> = [
      ['P1001 unreachable', P1001],
      ['P1002 timeout', 'Error: P1002: The database server at `host`:`5432` was reached but timed out.'],
      ['P1003 closed', 'Error: P1003: The database server at `host`, closed the connection.'],
      ['P1017 closed', 'Error: P1017: Server has closed the connection.'],
      ['ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'],
      ['ENOTFOUND', 'getaddrinfo ENOTFOUND postgres.railway.internal'],
      ['EAI_AGAIN', 'Error: getaddrinfo EAI_AGAIN postgres.railway.internal'],
      ['prose, no code', "Can't reach database server at `postgres.railway.internal`:`5432`"],
    ];

    it.each(transient)('%s -> CONNECTION (retryable)', (_label, output) => {
      expect(classifyMigrateError(output)).toBe('CONNECTION');
      expect(isRetriableMigrateError('CONNECTION')).toBe(true);
    });
  });

  describe('P3005 is permanent and must never be retried', () => {
    it('classifies the exact production P3005 text', () => {
      expect(classifyMigrateError(P3005)).toBe('HISTORY_MISSING');
    });

    it('is NOT retryable', () => {
      expect(isRetriableMigrateError('HISTORY_MISSING')).toBe(false);
    });

    it('wins over incidental connection wording in the same output', () => {
      // A P3005 that also mentions connectivity must still be treated as
      // permanent; otherwise the endless-retry bug returns.
      expect(classifyMigrateError(`${P3005}\nECONNREFUSED while probing`)).toBe('HISTORY_MISSING');
    });
  });

  describe('failed / drifted migrations are permanent', () => {
    it.each([
      ['P3009 failed migrations', P3009, 'MIGRATION_FAILED'],
      ['P3018 apply failure', P3018, 'MIGRATION_FAILED'],
      ['P3018 modified after applied', P3018_MODIFIED, 'MIGRATION_FAILED'],
      ['P3015 missing file', 'Error: P3015: Could not find the migration file, it does not exist locally.', 'MIGRATION_FAILED'],
    ])('%s -> %s', (_label, output, expected) => {
      expect(classifyMigrateError(output)).toBe(expected as MigrateErrorKind);
      expect(isRetriableMigrateError(expected as MigrateErrorKind)).toBe(false);
    });
  });

  describe('unknown errors fail fast rather than loop', () => {
    it('classifies unrecognised output as UNKNOWN', () => {
      expect(classifyMigrateError('something entirely unexpected happened')).toBe('UNKNOWN');
    });

    it('UNKNOWN is not retryable', () => {
      expect(isRetriableMigrateError('UNKNOWN')).toBe(false);
    });

    it('tolerates empty / nullish input', () => {
      expect(classifyMigrateError('')).toBe('UNKNOWN');
      expect(classifyMigrateError(undefined as unknown as string)).toBe('UNKNOWN');
      expect(classifyMigrateError(null as unknown as string)).toBe('UNKNOWN');
    });
  });
});

describe('buildRemediationGuidance', () => {
  it('for P3005, names the exact baseline migration and the exact command', () => {
    const guidance = buildRemediationGuidance('HISTORY_MISSING');
    expect(guidance).toContain(BASELINE_MIGRATION);
    expect(guidance).toContain(`migrate resolve --applied ${BASELINE_MIGRATION}`);
    expect(guidance).toContain('prisma migrate deploy');
    expect(guidance).toContain('prisma migrate status');
  });

  it('for P3005, states it is permanent so an operator does not retry', () => {
    const guidance = buildRemediationGuidance('HISTORY_MISSING');
    expect(guidance.toLowerCase()).toContain('permanent');
    expect(guidance.toLowerCase()).toContain('retrying it can never succeed');
  });

  it('for P3005, names ONLY the baseline - never all five migrations', () => {
    const guidance = buildRemediationGuidance('HISTORY_MISSING');
    // The migrations that must actually run are named as NOT-yet-applied, and
    // are never offered as a `resolve --applied` target.
    expect(guidance).toContain('transfer_otp_challenges');
    expect(guidance).not.toContain('resolve --applied 20261006000000');
    expect(guidance).not.toContain('resolve --applied 20261008000000');
    expect(guidance).not.toContain('resolve --applied 20261009000000');
  });

  it('points at the runbook', () => {
    expect(buildRemediationGuidance('HISTORY_MISSING')).toContain('MIGRATION_RUNBOOK.md');
  });

  it('for MIGRATION_FAILED, forbids db push / --accept-data-loss', () => {
    const guidance = buildRemediationGuidance('MIGRATION_FAILED');
    expect(guidance).toContain('PERMANENT');
    expect(guidance).toContain('Never use `prisma db push`');
    expect(guidance).toContain('--accept-data-loss');
  });

  it('never suggests migrate reset in any branch', () => {
    for (const kind of ['HISTORY_MISSING', 'MIGRATION_FAILED', 'UNKNOWN'] as const) {
      expect(buildRemediationGuidance(kind)).not.toContain('migrate reset');
    }
  });
});

describe('BASELINE_MIGRATION', () => {
  it('is the idempotent schema snapshot, not an additive migration', () => {
    expect(BASELINE_MIGRATION).toBe('20261005000000_baseline_production_schema');
  });
});

describe('runMigrations retry policy', () => {
  const PG_ENV = { DATABASE_URL: 'postgresql://user:pw@postgres.railway.internal:5432/railway' };

  beforeEach(() => {
    mockedExecFileSync.mockReset();
  });

  it('THE INCIDENT FIX: P3005 throws immediately and is never retried', () => {
    failWith(P3005);

    expect(() => runMigrations({ attempts: 10, retryDelayMs: 0, env: PG_ENV, silent: true })).toThrow(
      /failed permanently \(HISTORY_MISSING\)/
    );

    // The whole bug: the old code retried this 10x in the start command and
    // 10x more in provision-db.ts. Exactly ONE attempt must happen now.
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('P3005 error text carries the baselining remediation', () => {
    failWith(P3005);
    let message = '';
    try {
      runMigrations({ attempts: 5, retryDelayMs: 0, env: PG_ENV, silent: true });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(BASELINE_MIGRATION);
    expect(message).toContain('migrate resolve --applied');
  });

  it('a failed migration throws immediately and is never retried', () => {
    failWith(P3018);
    expect(() => runMigrations({ attempts: 10, retryDelayMs: 0, env: PG_ENV, silent: true })).toThrow(
      /failed permanently \(MIGRATION_FAILED\)/
    );
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('an UNKNOWN error fails fast rather than looping', () => {
    failWith('totally unexpected prisma explosion');
    expect(() => runMigrations({ attempts: 10, retryDelayMs: 0, env: PG_ENV, silent: true })).toThrow(
      /failed permanently \(UNKNOWN\)/
    );
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('P1001 IS retried up to the attempt limit', () => {
    failAlwaysWith(P1001);
    expect(() => runMigrations({ attempts: 3, retryDelayMs: 0, env: PG_ENV, silent: true })).toThrow(
      /still unreachable after 3 attempt/
    );
    expect(mockedExecFileSync).toHaveBeenCalledTimes(3);
  });

  it('a transient failure recovers when the database becomes reachable', () => {
    failWith(P1001);
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from('All migrations have been applied.'));

    expect(() => runMigrations({ attempts: 3, retryDelayMs: 0, env: PG_ENV, silent: true })).not.toThrow();
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
  });

  it('invokes `migrate deploy` - never db push / reset / --accept-data-loss', () => {
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from('ok'));
    runMigrations({ attempts: 1, env: PG_ENV, silent: true });

    const args = mockedExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('migrate');
    expect(args).toContain('deploy');
    expect(args).not.toContain('push');
    expect(args).not.toContain('reset');
    expect(args).not.toContain('--accept-data-loss');
  });

  it('refuses to run without DATABASE_URL', () => {
    expect(() => runMigrations({ env: {}, silent: true })).toThrow(/DATABASE_URL is not set/);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('refuses to run against a non-PostgreSQL URL (never SQLite)', () => {
    expect(() =>
      runMigrations({ env: { DATABASE_URL: 'file:./dev.db' }, silent: true })
    ).toThrow(/does not point at PostgreSQL/);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});
