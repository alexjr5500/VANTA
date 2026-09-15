/**
 * VANTA - Development Wallet Seed (thin wrapper)
 *
 * Seeds the Admin/CEO account with a development VANTA Coin balance using the
 * shared `admin-dev-wallet` service (src/services/admin-dev-wallet.service.ts).
 *
 * ⚠️ DEVELOPMENT ONLY - Never runs in production. The environment guard lives
 * inside the service: when `NODE_ENV === "production"` it returns
 * `{ action: "disabled" }` WITHOUT touching the database, regardless of any
 * `ADMIN_DEV_BALANCE` value present in the environment.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/seed-dev-wallet.ts
 *   npm run seed:dev-wallet
 *
 * Or automatically on server startup in development mode.
 */

import { PrismaClient } from '@prisma/client';
import {
  ADMIN_DEV_TX_REFERENCE,
  ADMIN_DEV_TX_TYPE,
  isAdminDevEnvironment,
  seedAdminDevWallet,
} from '../src/services/admin-dev-wallet.service';

const prisma = new PrismaClient();

// Backward-compatible alias used by earlier callers.
export { isAdminDevEnvironment as isDevelopment };

/**
 * Seed the development admin balance. Environment-guarded; no-op in production.
 * Returns the service result for programmatic/observability use.
 */
export async function seedDevWallet(): Promise<ReturnType<typeof seedAdminDevWallet>> {
  const result = await seedAdminDevWallet(prisma);
  switch (result.action) {
    case 'disabled':
      console.log('⏭️  Skipping development wallet seed (NODE_ENV is "production").');
      break;
    case 'admin-not-found':
      console.log('⚠️  No Admin/CEO account found. Run `npx prisma db seed` first to create the admin.');
      break;
    case 'seed-already-available':
      console.log(`✓ Development wallet already seeded. ${result.admin?.email || result.admin?.username} has ${result.balanceAfter.toLocaleString()} VANTA Coins.`);
      break;
    case 'granted':
      console.log('✓ Development wallet seeded successfully.');
      console.log(`Admin (${result.admin?.email || result.admin?.username}) credited with ${result.credited.toLocaleString()} VANTA Coins`);
      console.log(`  - Available Balance: ${result.balanceAfter.toLocaleString()} VANTA Coins`);
      console.log(`  - Transaction: ${ADMIN_DEV_TX_TYPE} (${ADMIN_DEV_TX_REFERENCE})`);
      break;
  }
  return result;
}

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