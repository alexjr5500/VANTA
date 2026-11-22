import { PrismaClient } from '@prisma/client';
import { initialGiftCatalog } from './gift-catalog.data';
import {
  ADMIN_EMAIL as adminEmail,
  ADMIN_USERNAME as adminUsername,
  ADMIN_FULL_NAME as adminFullName,
  resolveAdminPassword,
} from './admin-credentials';
import { seedAdminDevWallet } from '../src/services/admin-dev-wallet.service';
import { ensureInitialAdministrator } from './ensure-initial-administrator';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding VANTA monetization data...');

  // ============================================================================
  // 0. CREATE ADMINISTRATOR ACCOUNT (if not exists)
  // ============================================================================

  const adminSeedAction = await ensureInitialAdministrator(
    prisma,
    { email: adminEmail, username: adminUsername, fullName: adminFullName },
    resolveAdminPassword,
  );
  console.log(adminSeedAction === 'created'
    ? '✅ Initial administrator created'
    : '✅ Existing administrator preserved without modification');

  // Purchase catalog provisioning runs once at backend startup (src/index.ts).
  // Do not also mutate catalog prices/plans during the predeploy seed.

  const allGifts = initialGiftCatalog;

  for (const gift of allGifts) {
    await prisma.gift.upsert({
      where: { slug: gift.slug },
      update: { ...gift, sortOrder: allGifts.indexOf(gift) + 1, isActive: true },
      create: { id: `gift_${gift.slug.replace(/-/g, '_')}`, ...gift, sortOrder: allGifts.indexOf(gift) + 1, isActive: true },
    });
  }
  console.log(`✅ ${allGifts.length} gifts created`);

  // ============================================================================
  // 3b. Admin initial allocation: grant the configured administrator
  //     EXACTLY 1,000,000 VANTA Coins, once, through the real
  //     wallet/ledger system (see src/services/admin-dev-wallet.service.ts).
  //     This is idempotent and database-gated: re-running the seed, restarting,
  //     or redeploying can NEVER add a duplicate allocation, and a spent
  //     balance is never refilled or reduced. Production is always exactly
  //     1,000,000 (ADMIN_DEV_BALANCE is a development/test-only override).
  // ============================================================================
  try {
    const devWalletResult = await seedAdminDevWallet(prisma);
    if (devWalletResult.action === 'granted') {
      console.log(
        `✅ CEO/Admin initial allocation granted: ${devWalletResult.admin?.email || devWalletResult.admin?.username} ` +
        `→ ${devWalletResult.balanceAfter.toLocaleString()} VANTA Coins (+${devWalletResult.credited.toLocaleString()})`
      );
    } else if (devWalletResult.action === 'seed-already-available') {
      console.log(
        `✅ CEO/Admin initial allocation already present: ${devWalletResult.balanceAfter.toLocaleString()} VANTA Coins (unchanged)`
      );
    } else {
      console.log(`ℹ️  ${devWalletResult.message}`);
    }
  } catch (seedWalletError) {
    console.warn('⚠️  CEO/Admin allocation grant skipped:', seedWalletError);
  }

  console.log('🎉 VANTA monetization seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });