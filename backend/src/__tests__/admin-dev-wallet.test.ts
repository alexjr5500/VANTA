import {
  ADMIN_DEV_BALANCE_DEFAULT,
  ADMIN_DEV_TX_LEGACY_REFERENCE,
  ADMIN_DEV_TX_REFERENCE,
  ADMIN_DEV_TX_TYPE,
  AdminDevPrisma,
  CEO_ADMIN_ALLOCATION_COINS,
  ensureAdminDevBalance,
  getAdminDevBalance,
  isAdminDevEnvironment,
  seedAdminDevWallet,
} from '../services/admin-dev-wallet.service';

// ============================================================================
// Helpers — build a stateful in-memory Prisma stub
// ============================================================================

interface MockState {
  balance: number;
  exists: boolean;
  grantedAt: Date | null; // Wallet.ceoAllocationGrantedAt
  allocated: boolean; // an existing COMPLETED allocation ledger row
  walletTransactionCreates: Record<string, unknown>[];
  walletTransactionFindFirstCalls: Record<string, unknown>[];
  coinTransactionCreates: Record<string, unknown>[];
  auditCreates: Record<string, unknown>[];
  transferLimitCreates: number;
  userUpdates: Record<string, unknown>[];
  walletUpdates: Record<string, unknown>[];
  $transactionCalls: number;
}

const ADMIN = { id: 'admin1', username: 'CEO', email: 'ceo@vanta.app', coins: 0 };

function makeMockPrisma(
  initialBalance: number,
  opts?: { grantedAt?: Date | null; allocated?: boolean; blockClaim?: boolean }
): { prisma: AdminDevPrisma; state: MockState } {
  const state: MockState = {
    balance: initialBalance,
    exists: initialBalance > 0 || Boolean(opts?.grantedAt),
    grantedAt: opts?.grantedAt ?? null,
    allocated: opts?.allocated ?? false,
    walletTransactionCreates: [],
    walletTransactionFindFirstCalls: [],
    coinTransactionCreates: [],
    auditCreates: [],
    transferLimitCreates: 0,
    userUpdates: [],
    walletUpdates: [],
    $transactionCalls: 0,
  };

  const tx: any = {
    wallet: {
      findUnique: async () =>
        state.exists
          ? { id: 'w1', userId: ADMIN.id, coinBalance: state.balance, ceoAllocationGrantedAt: state.grantedAt }
          : null,
      create: async (args: any) => {
        state.exists = true;
        state.balance = args.data.coinBalance;
        return { id: 'w1', userId: ADMIN.id, coinBalance: state.balance, ceoAllocationGrantedAt: null };
      },
      update: async (args: any) => {
        if (typeof args.data.coinBalance === 'number') state.balance = args.data.coinBalance;
        if (args.data.ceoAllocationGrantedAt !== undefined) {
          state.grantedAt = args.data.ceoAllocationGrantedAt;
        }
        state.walletUpdates.push(args.data);
        return { id: 'w1', userId: ADMIN.id, coinBalance: state.balance, ceoAllocationGrantedAt: state.grantedAt };
      },
      updateMany: async () => {
        if (opts?.blockClaim || !state.exists || state.grantedAt !== null) return { count: 0 };
        state.grantedAt = new Date();
        return { count: 1 };
      },
    },
    walletTransaction: {
      findFirst: async (args: any) => {
        state.walletTransactionFindFirstCalls.push(args.where);
        return state.allocated ? { id: 'tx_alloc' } : null;
      },
      create: async (args: any) => {
        state.walletTransactionCreates.push(args.data);
        if ((args.data?.reference as string) === ADMIN_DEV_TX_REFERENCE) state.allocated = true;
        return { id: 't1' };
      },
    },
    transferLimit: {
      findUnique: async () => null,
      create: async () => {
        state.transferLimitCreates += 1;
        return {};
      },
    },
    coinTransaction: {
      create: async (args: any) => {
        state.coinTransactionCreates.push(args.data);
        return { id: 'c1' };
      },
    },
    walletAuditLog: {
      create: async (args: any) => {
        state.auditCreates.push(args.data);
        return { id: 'a1' };
      },
    },
    user: {
      update: async (args: any) => {
        state.userUpdates.push(args.data);
        return {};
      },
    },
  };

  const prisma: any = {
    user: { findFirst: jest.fn(async () => ({ ...ADMIN, coins: state.balance })) },
    wallet: {
      findUnique: jest.fn(async () =>
        state.exists
          ? { id: 'w1', userId: ADMIN.id, coinBalance: state.balance, ceoAllocationGrantedAt: state.grantedAt }
          : null
      ),
    },
    $transaction: async (fn: any) => {
      state.$transactionCalls += 1;
      return fn(tx);
    },
  };

  return { prisma, state };
}

function clearEnvVars(keys: string[]) {
  for (const k of keys) delete process.env[k];
}

const ENV_KEYS = ['ADMIN_DEV_BALANCE', 'NODE_ENV', 'SEED_DEV_WALLET'];

// ============================================================================
// Allocation amount configuration
// ============================================================================

describe('CEO/Admin allocation configuration', () => {
  beforeEach(() => clearEnvVars(ENV_KEYS));

  test('the CEO/Admin allocation is exactly 1,000,000 VANTA Coins', () => {
    expect(CEO_ADMIN_ALLOCATION_COINS).toBe(1_000_000);
    expect(ADMIN_DEV_BALANCE_DEFAULT).toBe(1_000_000);
  });

  test('defaults to 1,000,000 when ADMIN_DEV_BALANCE is unset', () => {
    expect(getAdminDevBalance()).toBe(1_000_000);
  });

  test('reads ADMIN_DEV_BALANCE from the environment', () => {
    process.env.ADMIN_DEV_BALANCE = '2500000';
    expect(getAdminDevBalance()).toBe(2_500_000);
  });

  test('falls back to default on invalid/negative ADMIN_DEV_BALANCE', () => {
    process.env.ADMIN_DEV_BALANCE = 'not-a-number';
    expect(getAdminDevBalance()).toBe(ADMIN_DEV_BALANCE_DEFAULT);
    process.env.ADMIN_DEV_BALANCE = '-5';
    expect(getAdminDevBalance()).toBe(ADMIN_DEV_BALANCE_DEFAULT);
  });

  test('is enabled in development and test, disabled in production', () => {
    process.env.NODE_ENV = 'development';
    expect(isAdminDevEnvironment()).toBe(true);
    process.env.NODE_ENV = 'test';
    expect(isAdminDevEnvironment()).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(isAdminDevEnvironment()).toBe(false);
  });
});
// ============================================================================
// ensureAdminDevBalance — CEO/Admin initial allocation
// ============================================================================

describe('ensureAdminDevBalance — CEO/Admin initial allocation', () => {
  beforeEach(() => clearEnvVars(ENV_KEYS));

  test('grants exactly 1M to an empty wallet (0 -> 1M) with a real ledger entry', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(0);
    const result = await ensureAdminDevBalance(prisma);

    expect(result.action).toBe('granted');
    expect(result.targetBalance).toBe(1_000_000);
    expect(result.balanceBefore).toBe(0);
    expect(result.balanceAfter).toBe(1_000_000);
    expect(result.credited).toBe(1_000_000);
    expect(state.balance).toBe(1_000_000);
    expect(state.grantedAt).not.toBeNull();

    // Recorded through the existing ledger system exactly once.
    expect(state.walletTransactionCreates).toHaveLength(1);
    expect(state.walletTransactionCreates[0]).toMatchObject({
      type: ADMIN_DEV_TX_TYPE,
      reference: ADMIN_DEV_TX_REFERENCE,
      amount: 1_000_000,
      fee: 0,
      balanceBefore: 0,
      balance: 1_000_000,
      status: 'COMPLETED',
      description: 'CEO/Admin initial allocation of 1,000,000 VANTA Coins',
    });
    expect(state.coinTransactionCreates).toHaveLength(1);
    expect(state.auditCreates).toHaveLength(1);
    // Balance is mirrored onto the auth/account field.
    expect(state.userUpdates).toEqual([{ coins: 1_000_000 }]);
  });

  test('credits the exact shortfall on first allocation (400k -> 1M)', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(400_000);
    const result = await ensureAdminDevBalance(prisma);
    expect(result.action).toBe('granted');
    expect(result.credited).toBe(600_000);
    expect(result.balanceAfter).toBe(1_000_000);
    expect(state.balance).toBe(1_000_000);
    expect(state.walletTransactionCreates).toHaveLength(1);
  });

  test('running the seed twice does NOT produce 2M and creates only one ledger row', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(0);
    const first = await ensureAdminDevBalance(prisma);
    const second = await ensureAdminDevBalance(prisma);

    expect(first.action).toBe('granted');
    expect(second.action).toBe('seed-already-available');
    expect(first.balanceAfter).toBe(1_000_000);
    expect(second.balanceAfter).toBe(1_000_000);
    expect(second.credited).toBe(0);
    expect(state.balance).toBe(1_000_000);
    expect(state.walletTransactionCreates).toHaveLength(1);
  });

  test('running the seed repeatedly never continuously increases the balance', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(0);
    for (let i = 0; i < 5; i++) {
      const r = await ensureAdminDevBalance(prisma);
      expect(r.balanceAfter).toBe(1_000_000);
      expect(r.credited).toBe(i === 0 ? 1_000_000 : 0);
    }
    expect(state.balance).toBe(1_000_000);
    expect(state.walletTransactionCreates).toHaveLength(1);
  });

  test('a spent CEO balance is NEVER refilled by re-running the seed', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(0);
    await ensureAdminDevBalance(prisma); // allocation issued 0 -> 1,000,000
    expect(state.balance).toBe(1_000_000);

    // The CEO spends 600,000 VANTA Coins exactly like any other wallet.
    state.balance = 400_000;

    const rerun = await ensureAdminDevBalance(prisma);
    expect(rerun.action).toBe('seed-already-available');
    expect(rerun.credited).toBe(0);
    expect(rerun.balanceAfter).toBe(400_000);
    expect(state.balance).toBe(400_000);
    expect(state.walletTransactionCreates).toHaveLength(1);
  });

  test('if CEO already has 1,200,000, reseeding does NOT reduce it', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(1_200_000);
    const result = await ensureAdminDevBalance(prisma);
    expect(result.action).toBe('seed-already-available');
    expect(result.balanceAfter).toBe(1_200_000);
    expect(result.credited).toBe(0);
    expect(state.balance).toBe(1_200_000);
    expect(state.walletTransactionCreates).toHaveLength(0);
  });

  test('a pre-existing legacy allocation is detected and never re-granted', async () => {
    process.env.NODE_ENV = 'development';
    // Simulates a database allocated by an older build: the ledger row exists
    // (legacy reference) but the marker column is null.
    const { prisma, state } = makeMockPrisma(1_000_000, { allocated: true, grantedAt: null });
    const result = await ensureAdminDevBalance(prisma);
    expect(result.action).toBe('seed-already-available');
    expect(result.credited).toBe(0);
    expect(state.balance).toBe(1_000_000);
    expect(state.walletTransactionCreates).toHaveLength(0);
    // The ledger lookup must recognize BOTH the current and the legacy refs.
    const where = state.walletTransactionFindFirstCalls[0] as {
      reference?: { in?: string[] };
    };
    expect(where.reference?.in).toContain(ADMIN_DEV_TX_REFERENCE);
    expect(where.reference?.in).toContain(ADMIN_DEV_TX_LEGACY_REFERENCE);
    // The DB gate marker is backfilled so it is authoritative from now on.
    expect(state.grantedAt).not.toBeNull();
  });

  test('the DB gate blocks a concurrent duplicate grant (updateMany count 0)', async () => {
    process.env.NODE_ENV = 'development';
    // Simulates a race: another process already claimed the marker between the
    // ledger read and our claim, so the conditional update matches 0 rows.
    const { prisma, state } = makeMockPrisma(0, { blockClaim: true });
    const result = await ensureAdminDevBalance(prisma);
    expect(result.action).toBe('seed-already-available');
    expect(result.credited).toBe(0);
    expect(state.balance).toBe(0);
    expect(state.walletTransactionCreates).toHaveLength(0);
  });

  test('normal users do NOT receive the allocation (no canonical email)', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(0);
    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const result = await ensureAdminDevBalance(prisma);
    expect(result.action).toBe('admin-not-found');
    expect(result.credited).toBe(0);
    expect(state.$transactionCalls).toBe(0);
    expect(state.balance).toBe(0);
  });

  test('a user cannot impersonate the CEO by changing their username', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(0);
    await ensureAdminDevBalance(prisma);
    // The lookup must be strictly by canonical email, never by username/role.
    const args = (prisma.user.findFirst as jest.Mock).mock.calls[0][0];
    expect((args as { where: { email: string } }).where.email).toBe('ceo@vanta.app');
    expect(state.balance).toBe(1_000_000);
  });

  test('balance is stored server-side and mirrored on User.coins', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(0);
    await ensureAdminDevBalance(prisma);
    expect(state.balance).toBe(1_000_000);
    const walletAfter = await prisma.wallet.findUnique({ where: { userId: 'admin1' } });
    expect((walletAfter as any).coinBalance).toBe(1_000_000);
    expect(state.userUpdates).toHaveLength(1);
    expect(state.userUpdates[0]).toEqual({ coins: 1_000_000 });
  });
});
// ============================================================================
// seedAdminDevWallet — production allocation
// ============================================================================

describe('seedAdminDevWallet — production', () => {
  beforeEach(() => clearEnvVars(ENV_KEYS));

  test('grants exactly 1,000,000 in production (REAL production feature)', async () => {
    process.env.NODE_ENV = 'production';
    const { prisma, state } = makeMockPrisma(0);
    const result = await seedAdminDevWallet(prisma);
    expect(result.action).toBe('granted');
    expect(result.balanceAfter).toBe(1_000_000);
    expect(result.credited).toBe(1_000_000);
    expect(state.balance).toBe(1_000_000);
    expect(state.walletTransactionCreates).toHaveLength(1);
  });

  test('production ALWAYS allocates exactly 1,000,000 (ADMIN_DEV_BALANCE ignored)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_DEV_BALANCE = '999999999'; // hostile / misconfigured value
    const { prisma, state } = makeMockPrisma(0);
    const result = await seedAdminDevWallet(prisma);
    expect(result.action).toBe('granted');
    expect(result.targetBalance).toBe(1_000_000);
    expect(result.credited).toBe(1_000_000);
    expect(state.balance).toBe(1_000_000);
    expect(state.walletTransactionCreates[0]).toMatchObject({ amount: 1_000_000 });
  });

  test('production is idempotent: re-running never duplicates the allocation', async () => {
    process.env.NODE_ENV = 'production';
    const { prisma, state } = makeMockPrisma(0);
    const first = await seedAdminDevWallet(prisma);
    const second = await seedAdminDevWallet(prisma);
    expect(first.action).toBe('granted');
    expect(second.action).toBe('seed-already-available');
    expect(state.balance).toBe(1_000_000);
    expect(state.walletTransactionCreates).toHaveLength(1);
  });

  test('production never refills a spent CEO balance', async () => {
    process.env.NODE_ENV = 'production';
    const { prisma, state } = makeMockPrisma(400_000, { grantedAt: new Date(), allocated: true });
    const result = await seedAdminDevWallet(prisma);
    expect(result.action).toBe('seed-already-available');
    expect(result.credited).toBe(0);
    expect(result.balanceAfter).toBe(400_000);
    expect(state.balance).toBe(400_000);
    expect(state.walletTransactionCreates).toHaveLength(0);
  });

  test('runs normally in a development environment', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma } = makeMockPrisma(0);
    const result = await seedAdminDevWallet(prisma);
    expect(result.action).toBe('granted');
    expect(result.balanceAfter).toBe(1_000_000);
  });
});