import {
  ADMIN_DEV_BALANCE_DEFAULT,
  ADMIN_DEV_TX_REFERENCE,
  ADMIN_DEV_TX_TYPE,
  AdminDevPrisma,
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
  created: boolean;
  walletTransactionCreates: Record<string, unknown>[];
  coinTransactionCreates: Record<string, unknown>[];
  auditCreates: Record<string, unknown>[];
  transferLimitCreates: number;
  userUpdates: Record<string, unknown>[];
  $transactionCalls: number;
}

const ADMIN = { id: 'admin1', username: 'CEO', email: 'ceo@vanta.app', coins: 0 };

function makeMockPrisma(initialBalance: number): { prisma: AdminDevPrisma; state: MockState } {
  const state: MockState = {
    balance: initialBalance,
    created: initialBalance > 0,
    walletTransactionCreates: [],
    coinTransactionCreates: [],
    auditCreates: [],
    transferLimitCreates: 0,
    userUpdates: [],
    $transactionCalls: 0,
  };

  const tx: any = {
    wallet: {
      findUnique: async () => ({ id: 'w1', userId: ADMIN.id, coinBalance: state.balance }),
      create: async (args: any) => {
        state.created = true;
        state.balance = args.data.coinBalance;
        return { id: 'w1', coinBalance: state.balance };
      },
      update: async (args: any) => {
        state.balance = args.data.coinBalance;
        return { id: 'w1', coinBalance: state.balance };
      },
    },
    transferLimit: {
      findUnique: async () => null,
      create: async () => { state.transferLimitCreates += 1; return {}; },
    },
    walletTransaction: {
      create: async (args: any) => { state.walletTransactionCreates.push(args.data); return { id: 't1' }; },
    },
    coinTransaction: {
      create: async (args: any) => { state.coinTransactionCreates.push(args.data); return { id: 'c1' }; },
    },
    walletAuditLog: {
      create: async (args: any) => { state.auditCreates.push(args.data); return { id: 'a1' }; },
    },
    user: {
      update: async (args: any) => { state.userUpdates.push(args.data); return {}; },
    },
  };

  const prisma: any = {
    user: { findFirst: jest.fn(async () => ({ ...ADMIN, coins: state.balance })) },
    wallet: { findUnique: jest.fn(async () => ({ id: 'w1', userId: ADMIN.id, coinBalance: state.balance })) },
    $transaction: async (fn: any) => { state.$transactionCalls += 1; return fn(tx); },
  };

  return { prisma, state };
}

function clearEnvVars(keys: string[]) {
  for (const k of keys) delete process.env[k];
}

const ENV_KEYS = ['ADMIN_DEV_BALANCE', 'NODE_ENV', 'SEED_DEV_WALLET'];

// ============================================================================
// ADMIN_DEV_BALANCE configuration
// ============================================================================

describe('ADMIN_DEV_BALANCE configuration', () => {
  beforeEach(() => clearEnvVars(ENV_KEYS));

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
// ensureAdminDevBalance — development grant
// ============================================================================

describe('ensureAdminDevBalance — development grant', () => {
  beforeEach(() => clearEnvVars(ENV_KEYS));

  test('grants 1M to an empty wallet (0 -> 1M)', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(0);
    const result = await ensureAdminDevBalance(prisma);
    expect(result.action).toBe('granted');
    expect(result.balanceBefore).toBe(0);
    expect(result.balanceAfter).toBe(1_000_000);
    expect(result.credited).toBe(1_000_000);
    expect(state.balance).toBe(1_000_000);
    // Recorded through the existing ledger system.
    expect(state.walletTransactionCreates).toHaveLength(1);
    expect(state.walletTransactionCreates[0]).toMatchObject({
      type: ADMIN_DEV_TX_TYPE,
      reference: ADMIN_DEV_TX_REFERENCE,
      amount: 1_000_000,
      balanceBefore: 0,
      balance: 1_000_000,
    });
    expect(state.coinTransactionCreates).toHaveLength(1);
    expect(state.auditCreates).toHaveLength(1);
  });

  test('top-up only the difference when already part-way below target (400k -> 1M)', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(400_000);
    const result = await ensureAdminDevBalance(prisma);
    expect(result.action).toBe('granted');
    expect(result.balanceBefore).toBe(400_000);
    expect(result.credited).toBe(600_000);
    expect(result.balanceAfter).toBe(1_000_000);
    expect(state.balance).toBe(1_000_000);
    expect(state.walletTransactionCreates).toHaveLength(1);
  });

  test('running the seed twice does NOT produce 2M', async () => {
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
    // Only ONE ledger write happened across both runs.
    expect(state.walletTransactionCreates).toHaveLength(1);
  });

  test('running the seed repeatedly does NOT continuously increase the balance', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma, state } = makeMockPrisma(0);
    for (let i = 0; i < 5; i++) {
      const r = await ensureAdminDevBalance(prisma);
      expect(r.balanceAfter).toBe(1_000_000);
    }
    expect(state.balance).toBe(1_000_000);
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

  test('normal users do NOT receive the grant (no canonical email)', async () => {
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
    expect((walletAfter as { coinBalance: number }).coinBalance).toBe(1_000_000);
    expect(state.userUpdates).toHaveLength(1);
    expect(state.userUpdates[0]).toEqual({ coins: 1_000_000 });
  });
});

// ============================================================================
// seedAdminDevWallet — production safety
// ============================================================================

describe('seedAdminDevWallet — production safety', () => {
  beforeEach(() => clearEnvVars(ENV_KEYS));

  test('does NOT run and does NOT touch the database in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_DEV_BALANCE = '1000000';
    const { prisma, state } = makeMockPrisma(0);
    const result = await seedAdminDevWallet(prisma);
    expect(result.action).toBe('disabled');
    expect(result.credited).toBe(0);
    expect(state.$transactionCalls).toBe(0);
    expect(state.balance).toBe(0);
    expect(state.walletTransactionCreates).toHaveLength(0);
  });

  test('production is guarded even when ADMIN_DEV_BALANCE is huge', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_DEV_BALANCE = '999999999';
    const { prisma, state } = makeMockPrisma(0);
    const result = await seedAdminDevWallet(prisma);
    expect(result.action).toBe('disabled');
    expect(state.balance).toBe(0);
  });

  test('runs normally in a development environment', async () => {
    process.env.NODE_ENV = 'development';
    const { prisma } = makeMockPrisma(0);
    const result = await seedAdminDevWallet(prisma);
    expect(result.action).toBe('granted');
    expect(result.balanceAfter).toBe(1_000_000);
  });
});