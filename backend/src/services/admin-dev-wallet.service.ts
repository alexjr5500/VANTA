/**
 * VANTA — CEO/Admin initial allocation (real, database-backed, idempotent).
 *
 * Gives the designated CEO/Admin account (`ceo@vanta.app`) an initial
 * allocation of EXACTLY 1,000,000 VANTA Coins, persisted through VANTA's
 * existing wallet / ledger architecture:
 *
 *   - `Wallet.coinBalance`            — authoritative spendable balance
 *   - `WalletTransaction`             — SYSTEM_CREDIT ledger entry (rendered as
 *                                       an incoming transaction everywhere the
 *                                       app displays transaction history)
 *   - `CoinTransaction`               — coin-ledger consistency entry (type ADMIN)
 *   - `WalletAuditLog`                — audit trail
 *   - `User.coins`                    — mirrored field surfaced by the
 *                                       auth/account controller
 *   - `Wallet.ceoAllocationGrantedAt` — persistent one-time grant gate
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Idempotency (REQUIRED READING)
 * ────────────────────────────────────────────────────────────────────────────
 * The allocation is granted AT MOST ONCE per CEO account. Running migrations,
 * deployment scripts, seed scripts, server startups, logins or refreshes
 * repeatedly can NEVER add a second 1,000,000:
 *
 *   1. The persistent one-time marker (`Wallet.ceoAllocationGrantedAt`) is
 *      claimed with an atomic conditional update
 *      (`updateMany ... WHERE "ceoAllocationGrantedAt" IS NULL`). If two
 *      deployment processes start at the same time, exactly one claims the
 *      allocation; every other process observes a zero-row update and becomes
 *      a no-op. This is a hard database-level guarantee, not a best-effort
 *      application check.
 *   2. The wallet ledger is also checked for an existing COMPLETED allocation
 *      transaction (by either the current reference `CEO_INITIAL_ALLOCATION`
 *      or the legacy reference `DEV_ADMIN_BALANCE_GRANT` used by earlier
 *      builds), so deployments that were already allocated before this guard
 *      existed remain protected across upgrades.
 *   3. If the CEO wallet already holds the target or more, the allocation is
 *      treated as satisfied: it is never reduced and never credited again.
 *
 * Once the CEO SPENDS or GIFTS coins, re-running the initialization never
 * refills them — the balance behaves exactly like every other legitimate
 * VANTA wallet. No mock balance, no fake transaction, no client-side minting.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Production + environments
 * ────────────────────────────────────────────────────────────────────────────
 * This is a REAL production feature: the CEO allocation is issued in every
 * environment, including production. In production the amount is FIXED at
 * exactly 1,000,000 VANTA Coins and can never be changed by `ADMIN_DEV_BALANCE`
 * (a development/test-only override).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Identity + security
 * ────────────────────────────────────────────────────────────────────────────
 * The recipient is resolved strictly by the canonical administrator EMAIL
 * (`ceo@vanta.app`). It is NOT derived from a client-supplied username/role,
 * so a normal user who renames themselves to `ceo` (or `CEO`) can never claim
 * the allocation. There is no HTTP endpoint that mints coins: this function is
 * called only from the trusted seed / server-startup paths.
 * ────────────────────────────────────────────────────────────────────────────
 */
/** Canonical CEO/Admin account email. Single source of truth with the seed. */
export const ADMIN_DEV_EMAIL = 'ceo@vanta.app';

/** The exact CEO/Admin initial allocation amount in VANTA Coins. */
export const CEO_ADMIN_ALLOCATION_COINS = 1_000_000;

/** Fallback target when ADMIN_DEV_BALANCE is unset/invalid (non-production). */
export const ADMIN_DEV_BALANCE_DEFAULT = CEO_ADMIN_ALLOCATION_COINS;

/** Ledger identity used to clearly record the CEO/Admin initial allocation. */
export const ADMIN_DEV_TX_TYPE = 'SYSTEM_CREDIT';
/** Unique transaction/reference ID identifying the CEO/Admin initial allocation. */
export const ADMIN_DEV_TX_REFERENCE = 'CEO_INITIAL_ALLOCATION';
/**
 * Reference used by earlier builds (the former "dev admin wallet" grant). Kept
 * so a deployment that was already allocated by an older build is never
 * granted a SECOND time after this upgrade.
 */
export const ADMIN_DEV_TX_LEGACY_REFERENCE = 'DEV_ADMIN_BALANCE_GRANT';
export const ADMIN_DEV_TX_DESCRIPTION =
  'CEO/Admin initial allocation of 1,000,000 VANTA Coins';

/**
 * Resolve the configured non-production allocation target.
 *
 * Reads `ADMIN_DEV_BALANCE` from the environment and defaults to 1,000,000.
 * Any non-numeric, negative, or empty value falls back to the default.
 * DEV/TEST-ONLY override — production deployments ALWAYS allocate exactly
 * `CEO_ADMIN_ALLOCATION_COINS` (1,000,000) regardless of this variable.
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
 * True only when the process is explicitly NOT running in production. Used to
 * decide whether the development/test `ADMIN_DEV_BALANCE` override may be
 * honored. Production always uses the fixed CEO allocation amount.
 */
export function isAdminDevEnvironment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/** Allocation target for the CURRENT environment. */
function getResolvedTarget(): number {
  return isAdminDevEnvironment() ? getAdminDevBalance() : CEO_ADMIN_ALLOCATION_COINS;
}
/**
 * Result of a CEO/Admin allocation attempt. Exposed so callers and tests can
 * assert on the outcome.
 */
export interface AdminDevWalletResult {
  /** Which action was taken. */
  action: 'granted' | 'seed-already-available' | 'disabled' | 'admin-not-found';
  /** The allocation target used. */
  targetBalance: number;
  /** Balance before the operation. */
  balanceBefore: number;
  /** Balance after the operation. */
  balanceAfter: number;
  /** Number of coins actually credited by this call (0 when nothing new). */
  credited: number;
  /** Resolved CEO account (when found). */
  admin?: { id: string; username: string; email: string | null };
  /** Short human-readable message. */
  message: string;
}

/** Wallet row subset used by the allocation logic. */
export interface AdminDevWalletRow {
  id?: string;
  userId: string;
  coinBalance: number;
  ceoAllocationGrantedAt?: Date | null;
}

/**
 * Minimal subset of the Prisma client used by the CEO allocation. Accepting
 * the client as a parameter (instead of importing the singleton) keeps the
 * operation deterministic and trivially unit-testable with a stub.
 */
export interface AdminDevPrisma {
  user: {
    findFirst(args: {
      where: { email: string };
      select?: Record<string, boolean>;
    }): Promise<{ id: string; username: string; email: string | null; coins: number } | null>;
  };
  wallet: {
    findUnique(args: { where: { userId: string } }): Promise<AdminDevWalletRow | null>;
  };
  $transaction<T>(fn: (tx: AdminDevTx) => Promise<T>): Promise<T>;
}

/** Transaction-scoped subset used inside $transaction. */
export interface AdminDevTx {
  wallet: {
    findUnique?(args: { where: { userId: string } }): Promise<AdminDevWalletRow | null>;
    create(args: {
      data: { userId: string; coinBalance: number };
    }): Promise<AdminDevWalletRow>;
    update(args: {
      where: { userId: string };
      data: { coinBalance?: number; ceoAllocationGrantedAt?: Date | null };
    }): Promise<AdminDevWalletRow>;
    /** Atomic one-time gate: claims the allocation exactly once per account. */
    updateMany(args: {
      where: { userId: string; ceoAllocationGrantedAt: null };
      data: { ceoAllocationGrantedAt: Date };
    }): Promise<{ count: number }>;
  };
  transferLimit: {
    findUnique(args: { where: { walletId: string } }): Promise<unknown | null>;
    create(args: { data: { walletId: string } }): Promise<unknown>;
  };
  walletTransaction: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
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
 * Idempotently ensure the canonical CEO account's wallet holds the CEO/Admin
 * initial allocation (default 1,000,000 VANTA Coins).
 *
 *  - If the CEO account (identified by `ceo@vanta.app`) does not exist,
 *    returns `admin-not-found` without creating anything.
 *  - If the allocation was already received (DB marker or existing ledger
 *    transaction), returns `seed-already-available` and leaves the balance
 *    untouched — repeated seeds, startups, logins or deployments can NEVER add
 *    a second allocation, and a spent balance is never refilled or reduced.
 *  - Otherwise credits exactly `(target - currentBalance)` coins via the
 *    existing wallet/ledger system: a SYSTEM_CREDIT wallet transaction, a coin
 *    ledger entry, an audit-log row, and the `User.coins` mirror — all inside
 *    one atomic transaction gated by the `Wallet.ceoAllocationGrantedAt`
 *    marker.
 */
export async function ensureAdminDevBalance(
  prisma: AdminDevPrisma,
  target?: number,
): Promise<AdminDevWalletResult> {
  const targetBalance =
    target === undefined
      ? getResolvedTarget()
      : Math.max(0, Math.floor(target));

  // Locate the canonical CEO strictly by email. A username/role match is NEVER
  // used, so renaming an ordinary account to "ceo" cannot impersonate.
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
      message: `Canonical CEO admin (${ADMIN_DEV_EMAIL}) not found; no allocation granted.`,
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

    const walletId = wallet.id!;
    const balanceBefore = wallet.coinBalance;

    // 1) Existing ledger transaction (covers deployments allocated before the
    //    marker column existed, including the legacy reference).
    const existingAllocationTx = await tx.walletTransaction.findFirst({
      where: {
        userId: admin.id,
        type: ADMIN_DEV_TX_TYPE,
        status: 'COMPLETED',
        reference: { in: [ADMIN_DEV_TX_REFERENCE, ADMIN_DEV_TX_LEGACY_REFERENCE] },
      },
    });

    const alreadyGranted =
      Boolean(wallet.ceoAllocationGrantedAt) || Boolean(existingAllocationTx);

    if (alreadyGranted) {
      // Backfill the DB gate for pre-existing grants so it is authoritative.
      if (!wallet.ceoAllocationGrantedAt) {
        await tx.wallet.update({
          where: { userId: admin.id },
          data: { ceoAllocationGrantedAt: new Date() },
        });
      }
      return {
        granted: false,
        balanceBefore,
        balanceAfter: balanceBefore,
        credited: 0,
        walletId,
      };
    }

    // 2) Atomic DB-level gate. Exactly ONE concurrent caller can claim the
    //    allocation; everyone else observes count === 0 and becomes a no-op.
    const claim = await tx.wallet.updateMany({
      where: { userId: admin.id, ceoAllocationGrantedAt: null },
      data: { ceoAllocationGrantedAt: new Date() },
    });
    if (claim.count === 0) {
      return {
        granted: false,
        balanceBefore,
        balanceAfter: balanceBefore,
        credited: 0,
        walletId,
      };
    }

    // 3) If the CEO already holds the target or more, the allocation is
    //    satisfied: never reduce, never credit a second amount on top.
    if (balanceBefore >= targetBalance) {
      return {
        granted: false,
        balanceBefore,
        balanceAfter: balanceBefore,
        credited: 0,
        walletId,
      };
    }

    // 4) Credit exactly the shortfall so the balance is EXACTLY the target
    //    (0 + 1,000,000 on a fresh CEO wallet).
    const credited = targetBalance - balanceBefore;
    const updatedWallet = await tx.wallet.update({
      where: { userId: admin.id },
      data: { coinBalance: targetBalance },
    });
// 5) Default transfer limits for a freshly created wallet (mirrors the
    //    runtime walletService.ensureWallet behavior) so the account is
    //    fully consistent with a normal runtime-created wallet.
    const existingLimit = await tx.transferLimit.findUnique({ where: { walletId } });
    if (!existingLimit) {
      await tx.transferLimit.create({ data: { walletId } });
    }

    const env = process.env.NODE_ENV || 'development';
    const grantedAt = new Date();

    // 6) Wallet ledger entry (incoming SYSTEM_CREDIT). The frontend Balance
    //    page already treats SYSTEM_CREDIT as an incoming type, so it renders
    //    correctly in transaction history.
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
          grantType: 'ceo-initial-allocation',
          amount: credited,
          environment: env,
          grantedAt: grantedAt.toISOString(),
        }),
      },
    });

    // 7) CoinTransaction ledger (consistency with the coin ledger).
    await tx.coinTransaction.create({
      data: {
        userId: admin.id,
        type: 'ADMIN',
        amount: credited,
        balance: targetBalance,
        description: ADMIN_DEV_TX_DESCRIPTION,
        reference: ADMIN_DEV_TX_REFERENCE,
        metadata: JSON.stringify({
          grantType: 'ceo-initial-allocation',
          environment: env,
          grantedAt: grantedAt.toISOString(),
        }),
      },
    });

    // 8) Mirror the authoritative balance onto User.coins (the auth/account
    //    controller surfaces this field).
    await tx.user.update({
      where: { id: admin.id },
      data: { coins: targetBalance },
    });

    // 9) Audit trail.
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
        }),
      },
    });

    return {
      granted: true,
      balanceBefore,
      balanceAfter: updatedWallet.coinBalance,
      credited,
      walletId,
    };
  });

  if (!outcome.granted) {
    return {
      action: 'seed-already-available',
      targetBalance,
      balanceBefore: outcome.balanceBefore,
      balanceAfter: outcome.balanceAfter,
      credited: 0,
      admin: adminInfo,
      message: `CEO/Admin initial allocation already present (${outcome.balanceAfter.toLocaleString()} VANTA Coins).`,
    };
  }

  return {
    action: 'granted',
    targetBalance,
    balanceBefore: outcome.balanceBefore,
    balanceAfter: outcome.balanceAfter,
    credited: outcome.credited,
    admin: adminInfo,
    message:
      `CEO/Admin (${adminInfo.email || adminInfo.username}) allocated ` +
      `${outcome.credited.toLocaleString()} VANTA Coins → balance ${outcome.balanceAfter.toLocaleString()}.`,
  };
}

/**
 * Entry point used by seed scripts and server startup.
 *
 * Grants the CEO/Admin initial allocation in EVERY environment (including
 * production) with exactly-once, database-gated semantics — see
 * `ensureAdminDevBalance`. Production always allocates exactly 1,000,000
 * coins; `ADMIN_DEV_BALANCE` is a development/test-only override.
 */
export async function seedAdminDevWallet(
  prisma: AdminDevPrisma,
  target?: number,
): Promise<AdminDevWalletResult> {
  return ensureAdminDevBalance(prisma, target);
}