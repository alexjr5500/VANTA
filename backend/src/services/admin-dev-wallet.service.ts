/**
 * VANTA — Development-only Admin/CEO wallet grant.
 *
 * Adds a real, server-side VANTA Coin balance to the canonical administrator
 * (CEO) account so the FULL economy can be exercised during development and
 * testing (gifts, transfers, purchases, creator monetization, balance
 * deductions).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Production safety (REQUIRED READING)
 * ────────────────────────────────────────────────────────────────────────────
 * This grant is HARD-BLOCKED when `NODE_ENV === "production"`. That is the
 * same environment convention this project already uses to guard production
 * behavior in `prisma/admin-credentials.ts` and the coin-payment
 * configuration (`src/config/coin-payments.config.ts`). No amount of
 * `ADMIN_DEV_BALANCE` in the environment can enable the grant in production —
 * `seedAdminDevWallet()` returns `{ action: "disabled" }` without touching the
 * database.
 *
 * The `ADMIN_DEV_BALANCE` variable is a **development/test-only** affordance.
 * NEVER set it (or allow it to leak) on a production deployment.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Idempotency
 * ────────────────────────────────────────────────────────────────────────────
 * The grant is idempotent and never hands out repeated million-coin bonuses:
 *
 *   balance <  target  →  credit exactly (target - balance)  (a top-up)
 *   balance >= target  →  no-op, balance left untouched
 *
 * So re-running the seed does NOT produce 2M, and a CEO who already holds more
 * than the target is never reduced.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Identity
 * ────────────────────────────────────────────────────────────────────────────
 * The grant is tied to the canonical administrator EMAIL (`ceo@vanta.app`, the
 * same constant the seed uses to create the account). It is NOT derived from a
 * client-supplied username/role, so a normal user who renames themselves to
 * `ceo` (or `CEO`) can never claim the development balance.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Canonical administrator account email. Single source of truth with the seed. */
export const ADMIN_DEV_EMAIL = 'ceo@vanta.app';

/** Fallback development balance target when ADMIN_DEV_BALANCE is unset/invalid. */
export const ADMIN_DEV_BALANCE_DEFAULT = 1_000_000;

/** Ledger identity used to clearly record the development administrator grant. */
export const ADMIN_DEV_TX_TYPE = 'SYSTEM_CREDIT';
export const ADMIN_DEV_TX_REFERENCE = 'DEV_ADMIN_BALANCE_GRANT';
export const ADMIN_DEV_TX_DESCRIPTION = 'Development admin/CEO balance grant';
/**
 * Resolve the configured development balance target.
 *
 * Reads `ADMIN_DEV_BALANCE` from the environment and defaults to 1,000,000.
 * Any non-numeric, negative, or empty value falls back to the default. This
 * value is DEVELOPMENT/TEST only — the production guard is enforced separately
 * in `seedAdminDevWallet()`.
 */
export function getAdminDevBalance(): number {
  const raw = process.env.ADMIN_DEV_BALANCE;
  if (raw === undefined || raw.trim() === '') {
    return ADMIN_DEV_BALANCE_DEFAULT;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < 0) {
    return ADMIN_DEV_BALANCE_DEFAULT;
  }
  // Coins are stored as integers; floor to avoid fractional grants.
  return Math.floor(parsed);
}

/**
 * True only when the application is explicitly NOT running in production.
 *
 * Uses the project's existing environment convention (`NODE_ENV ===
 * "production"` disables the mechanism — same guard `admin-credentials.ts`
 * and `coin-payments.config.ts` rely on). Development and test environments
 * are both allowed.
 */
export function isAdminDevEnvironment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Result of a development wallet grant attempt. Exposed so callers and tests
 * can assert on the outcome.
 */
export interface AdminDevWalletResult {
  /** Which action was taken. */
  action: 'granted' | 'seed-already-available' | 'disabled' | 'admin-not-found';
  /** The development balance target used. */
  targetBalance: number;
  /** Balance before the operation. */
  balanceBefore: number;
  /** Balance after the operation. */
  balanceAfter: number;
  /** Number of coins actually credited by this call (0 when no top-up). */
  credited: number;
  /** Resolved administrator account (when found). */
  admin?: { id: string; username: string; email: string | null };
  /** Short human-readable message. */
  message: string;
}

/**
 * Minimal subset of the Prisma client used by the dev wallet grant. Accepting
 * the client as a parameter (instead of importing the singleton) keeps the
 * grant deterministic and trivially unit-testable with a stub.
 */
export interface AdminDevPrisma {
  user: {
    findFirst(args: {
      where: { email: string };
      select?: Record<string, boolean>;
    }): Promise<{ id: string; username: string; email: string | null; coins: number } | null>;
  };
  wallet: {
    findUnique(args: { where: { userId: string } }): Promise<{
      id?: string;
      userId: string;
      coinBalance: number;
    } | null>;
  };
  $transaction<T>(fn: (tx: AdminDevTx) => Promise<T>): Promise<T>;
}

/** Transaction-scoped subset used inside $transaction. */
export interface AdminDevTx {
  wallet: {
    findUnique?(args: { where: { userId: string } }): Promise<{
      id?: string;
      userId: string;
      coinBalance: number;
    } | null>;
    create(args: { data: { userId: string; coinBalance: number } }): Promise<{
      id: string;
      userId: string;
      coinBalance: number;
    }>;
    update(args: { where: { userId: string }; data: { coinBalance: number } }): Promise<{
      id: string;
      coinBalance: number;
    }>;
  };
  transferLimit: {
    findUnique(args: { where: { walletId: string } }): Promise<unknown | null>;
    create(args: { data: { walletId: string } }): Promise<unknown>;
  };
  walletTransaction: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  coinTransaction: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  walletAuditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  user: {
    update(args: { where: { id: string }; data: { coins: number } }): Promise<unknown>;
  };
}

/**
 * Idempotently ensure the canonical CEO account's wallet holds at least
 * `target` VANTA Coins (defaults to the configured `ADMIN_DEV_BALANCE`).
 *
 *  - If the CEO account (identified by `ceo@vanta.app`) does not exist,
 *    returns `admin-not-found` without creating anything.
 *  - If the wallet already holds >= target, returns `seed-already-available`
 *    and leaves the balance untouched (never reduces).
 *  - Otherwise credits exactly `(target - balance)` via the existing wallet/
 *    ledger system and records `SYSTEM_CREDIT` wallet + coin transactions and
 *    a wallet audit log entry.
 *
 * Because the credited amount is derived from the CURRENT balance, re-running
 * never stacks successive 1M grants. It is safe to call on every seed.
 */
export async function ensureAdminDevBalance(
  prisma: AdminDevPrisma,
  target?: number,
): Promise<AdminDevWalletResult> {
  const targetBalance = target === undefined
    ? getAdminDevBalance()
    : Math.max(0, Math.floor(target));

  // Locate the canonical admin strictly by email. A username/role match is
  // NEVER used, so renaming an ordinary account to "ceo" cannot impersonate.
  const admin = await prisma.user.findFirst({
    where: { email: ADMIN_DEV_EMAIL },
    select: { id: true, username: true, email: true, coins: true },
  });

  if (!admin) {
    return {
      action: 'admin-not-found',
      targetBalance,
      balanceBefore: 0,
      balanceAfter: 0,
      credited: 0,
      message: `Canonical admin (${ADMIN_DEV_EMAIL}) not found; no development balance granted.`,
    };
  }

  const adminInfo = { id: admin.id, username: admin.username, email: admin.email };

  const outcome = await prisma.$transaction(async (tx) => {
    let wallet = await tx.wallet.findUnique?.({ where: { userId: admin.id } });
    if (!wallet) {
      wallet = await prisma.wallet.findUnique({ where: { userId: admin.id } });
    }
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: { userId: admin.id, coinBalance: 0 },
      });
    }

    const balanceBefore = wallet.coinBalance;
    if (balanceBefore >= targetBalance) {
      return { balanceBefore, balanceAfter: balanceBefore, credited: 0, toggled: false, walletId: wallet.id };
    }

    const credited = targetBalance - balanceBefore;
    const updatedWallet = await tx.wallet.update({
      where: { userId: admin.id },
      data: { coinBalance: targetBalance },
    });

    // Default transfer limits for a freshly created wallet (mirrors the
    // runtime walletService.ensureWallet behavior) so the account is consistent.
    const existingLimit = await tx.transferLimit.findUnique({ where: { walletId: wallet.id } });
    if (!existingLimit) {
      await tx.transferLimit.create({ data: { walletId: wallet.id } });
    }

    const env = process.env.NODE_ENV || 'development';
    const walletId = wallet.id;

    // Wallet ledger entry (incoming SYSTEM_CREDIT). The frontend Balance page
    // already treats SYSTEM_CREDIT as an incoming type, so it renders correctly.
    await tx.walletTransaction.create({
      data: {
        walletId,
        userId: admin.id,
        type: ADMIN_DEV_TX_TYPE,
        amount: credited,
        fee: 0,
        balanceBefore,
        balance: targetBalance,
        status: 'COMPLETED',
        description: ADMIN_DEV_TX_DESCRIPTION,
        reference: ADMIN_DEV_TX_REFERENCE,
        metadata: JSON.stringify({
          grantType: 'development-admin-balance',
          seededBy: 'development-seed',
          environment: env,
          grantedAt: new Date().toISOString(),
        }),
      },
    });

    // CoinTransaction ledger (consistency with the coin ledger).
    await tx.coinTransaction.create({
      data: {
        userId: admin.id,
        type: 'ADMIN',
        amount: credited,
        balance: targetBalance,
        description: ADMIN_DEV_TX_DESCRIPTION,
        reference: ADMIN_DEV_TX_REFERENCE,
        metadata: JSON.stringify({
          grantType: 'development-admin-balance',
          seededBy: 'development-seed',
          environment: env,
        }),
      },
    });

    // Mirror the authoritative balance onto User.coins (the auth/account
    // controller surfaces this field).
    await tx.user.update({
      where: { id: admin.id },
      data: { coins: targetBalance },
    });

    // Audit trail.
    await tx.walletAuditLog.create({
      data: {
        userId: admin.id,
        action: ADMIN_DEV_TX_TYPE,
        details: JSON.stringify({
          amount: credited,
          type: ADMIN_DEV_TX_TYPE,
          description: ADMIN_DEV_TX_DESCRIPTION,
          reference: ADMIN_DEV_TX_REFERENCE,
          balanceBefore,
          balanceAfter: targetBalance,
          seededBy: 'development-seed',
        }),
      },
    });

    return {
      balanceBefore,
      balanceAfter: updatedWallet.coinBalance,
      credited,
      toggled: true,
      walletId,
    };
  });

  if (!outcome.toggled) {
    return {
      action: 'seed-already-available',
      targetBalance,
      balanceBefore: outcome.balanceAfter,
      balanceAfter: outcome.balanceAfter,
      credited: 0,
      admin: adminInfo,
      message: `Development balance already available (${outcome.balanceAfter.toLocaleString()} VANTA Coins).`,
    };
  }

  return {
    action: 'granted',
    targetBalance,
    balanceBefore: outcome.balanceBefore,
    balanceAfter: outcome.balanceAfter,
    credited: outcome.credited,
    admin: adminInfo,
    message: `Developer admin (${
      adminInfo.email || adminInfo.username
    }) topped up to ${outcome.balanceAfter.toLocaleString()} VANTA Coins (+${outcome.credited.toLocaleString()}).`,
  };
}

/**
 * Environment-guarded entry point used by seed scripts and server startup.
 *
 * Returns `{ action: "disabled" }` WITHOUT touching the database when the
 * process is running in production. In development/test it delegates to
 * `ensureAdminDevBalance`.
 */
export async function seedAdminDevWallet(
  prisma: AdminDevPrisma,
  target?: number,
): Promise<AdminDevWalletResult> {
  if (!isAdminDevEnvironment()) {
    return {
      action: 'disabled',
      targetBalance: target === undefined ? getAdminDevBalance() : target,
      balanceBefore: 0,
      balanceAfter: 0,
      credited: 0,
      message: 'Development admin balance is disabled in production. No grant was issued.',
    };
  }
  return ensureAdminDevBalance(prisma, target);
}