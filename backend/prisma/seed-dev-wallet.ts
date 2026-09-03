/**
 * VANTA - Development Wallet Seed
 *
 * Seeds the Admin/CEO account with 1,000,000 VANTA Coins for development/testing.
 *
 * ⚠️ DEVELOPMENT ONLY - Never runs in production.
 * Guarded by NODE_ENV === "development" (or explicit SEED_DEV_WALLET=true).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/seed-dev-wallet.ts
 *
 * Or automatically on server startup in development mode.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// CONFIGURATION
// ============================================================================

const SEED_AMOUNT = 1_000_000;
const SEED_TYPE = 'SYSTEM_CREDIT';
const SEED_DESCRIPTION = 'Development wallet seed';
const SEED_REFERENCE = 'DEV_WALLET_SEED_1M';

// Admin account identifiers (in priority order)
const ADMIN_USERNAMES = ['CEO', 'ceo', '@ceo'];
const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

// ============================================================================
// DEVELOPMENT GUARD
// ============================================================================

function isDevelopment(): boolean {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const explicitFlag = process.env.SEED_DEV_WALLET === 'true';
  return nodeEnv === 'development' || explicitFlag;
}

// ============================================================================
// MAIN SEED LOGIC
// ============================================================================

async function seedDevWallet(): Promise<void> {
  if (!isDevelopment()) {
    console.log('⏭️  Skipping development wallet seed (NODE_ENV is not "development").');
    return;
  }

  console.log('🌱 Seeding development wallet for Admin/CEO...');

  // --------------------------------------------------------------------------
  // 1. Locate the Admin/CEO account
  // --------------------------------------------------------------------------
  const admin = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { in: ADMIN_USERNAMES } },
        { role: { in: ADMIN_ROLES } },
      ],
    },
    orderBy: { createdAt: 'asc' }, // Prefer the first/oldest admin
  });

  if (!admin) {
    console.log('⚠️  No Admin/CEO account found. Run `npx prisma db seed` first to create the admin.');
    return;
  }

  const adminLabel = `@${admin.username}`;
  console.log(`✅ Found admin account: ${adminLabel} (${admin.email || 'no email'}) [role: ${admin.role}]`);

  // --------------------------------------------------------------------------
  // 2. Check if wallet already has funds (idempotency guard)
  // --------------------------------------------------------------------------
  const existingWallet = await prisma.wallet.findUnique({
    where: { userId: admin.id },
  });

  const existingSeedTx = await prisma.walletTransaction.findFirst({
    where: {
      userId: admin.id,
      OR: [
        { reference: SEED_REFERENCE },
        { description: SEED_DESCRIPTION },
      ],
      type: SEED_TYPE,
    },
  });

  if (existingSeedTx || (existingWallet && existingWallet.coinBalance >= SEED_AMOUNT)) {
    console.log(`✓ Development wallet already seeded. ${adminLabel} has ${existingWallet?.coinBalance.toLocaleString() || 0} VANTA Coins.`);
    return;
  }

  // --------------------------------------------------------------------------
  // 3. Seed the wallet inside a database transaction
  // --------------------------------------------------------------------------
  const result = await prisma.$transaction(async (tx) => {
    // Create wallet if it doesn't exist, otherwise update it
    const wallet = await tx.wallet.upsert({
      where: { userId: admin.id },
      create: {
        userId: admin.id,
        coinBalance: SEED_AMOUNT,
        earningsBalance: 0,
        lifetimeEarnings: 0,
        totalCoinsPurchased: 0,
        totalCoinsReceived: 0,
        totalCoinsSent: 0,
        totalGiftsSent: 0,
        totalGiftsReceived: 0,
        totalWithdrawn: 0,
        bonusCoins: 0,
        lockedCoins: 0,
        isFrozen: false,
      },
      update: {
        coinBalance: SEED_AMOUNT,
        lockedCoins: 0,
        bonusCoins: 0,
        isFrozen: false,
      },
    });

    // Create default transfer limits if wallet was just created
    const existingLimit = await tx.transferLimit.findUnique({
      where: { walletId: wallet.id },
    });
    if (!existingLimit) {
      await tx.transferLimit.create({
        data: { walletId: wallet.id },
      });
    }

    // Insert initial transaction for auditing
    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId: admin.id,
        type: SEED_TYPE,
        amount: SEED_AMOUNT,
        fee: 0,
        balance: SEED_AMOUNT,
        status: 'COMPLETED',
        description: SEED_DESCRIPTION,
        reference: SEED_REFERENCE,
        metadata: JSON.stringify({
          seededBy: 'development-seed',
          environment: process.env.NODE_ENV || 'development',
          seededAt: new Date().toISOString(),
        }),
      },
    });

    // Also create a CoinTransaction record for consistency with the coin ledger
    await tx.coinTransaction.create({
      data: {
        userId: admin.id,
        type: 'ADMIN',
        amount: SEED_AMOUNT,
        balance: SEED_AMOUNT,
        description: SEED_DESCRIPTION,
        reference: SEED_REFERENCE,
        metadata: JSON.stringify({
          seededBy: 'development-seed',
          environment: process.env.NODE_ENV || 'development',
        }),
      },
    });

    // Update the User.coins field for consistency (auth controller surfaces this)
    await tx.user.update({
      where: { id: admin.id },
      data: { coins: SEED_AMOUNT },
    });

    // Log audit trail
    await tx.walletAuditLog.create({
      data: {
        userId: admin.id,
        action: 'SYSTEM_CREDIT',
        details: JSON.stringify({
          amount: SEED_AMOUNT,
          type: SEED_TYPE,
          description: SEED_DESCRIPTION,
          reference: SEED_REFERENCE,
          seededBy: 'development-seed',
        }),
      },
    });

    return { wallet, transaction };
  });

  // --------------------------------------------------------------------------
  // 4. Log success
  // --------------------------------------------------------------------------
  console.log('✓ Development wallet seeded successfully.');
  console.log(`Admin (${adminLabel}) credited with ${SEED_AMOUNT.toLocaleString()} VANTA Coins.`);
  console.log(`  - Available Balance: ${result.wallet.coinBalance.toLocaleString()} VANTA Coins`);
  console.log(`  - Locked: 0`);
  console.log(`  - Pending: 0`);
  console.log(`  - Transaction: ${SEED_TYPE} (${SEED_REFERENCE})`);
}

// ============================================================================
// EXPORT (for programmatic use from server startup)
// ============================================================================

export { seedDevWallet, isDevelopment };

// ============================================================================
// RUN (when executed directly as a script)
// ============================================================================

// Only auto-run when executed directly (not when imported)
if (require.main === module) {
  seedDevWallet()
    .catch((e) => {
      console.error('❌ Development wallet seed failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
