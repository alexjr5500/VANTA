import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { initialGiftCatalog } from './gift-catalog.data';
import {
  ADMIN_EMAIL as adminEmail,
  ADMIN_USERNAME as adminUsername,
  ADMIN_FULL_NAME as adminFullName,
  resolveAdminPassword,
} from './admin-credentials';
import { seedAdminDevWallet } from '../src/services/admin-dev-wallet.service';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding VANTA monetization data...');

  // ============================================================================
  // 0. CREATE ADMINISTRATOR ACCOUNT (if not exists)
  // ============================================================================

  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        { email: adminEmail },
        { username: adminUsername },
      ],
    },
  });

  if (existingAdmin) {
    // Routine deployments must never reset credentials, reactivate a suspended
    // administrator, or silently change privileged roles. Existing accounts
    // are managed through explicit, audited administrative workflows.
    // First-time account creation remains supported below.
    console.log('✅ Existing administrator account found; automatic reconciliation skipped');
  } else {
    const adminPassword = resolveAdminPassword();
    // Keep seed-created credentials aligned with the application's current
    // password hashing algorithm. Runtime verification remains compatible
    // with Argon2 hashes created by older versions.
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    // Create admin user with all required fields
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        username: adminUsername,
        passwordHash,
        fullName: adminFullName,
        role: 'ADMIN',
        verified: true,
        emailVerified: true,
        status: 'ACTIVE',
        profile: {
          create: {
            username: adminUsername,
            fullName: adminFullName,
          },
        },
        wallet: {
          create: {},
        },
        userSettings: {
          create: {},
        },
        notificationPrefs: {
          create: {},
        },
      },
    });

    console.log(`✅ Administrator account created: ${admin.email} (${admin.username})`);
  }

  // The configured administrator above is the single admin bootstrap account.
  // Do not create a second hard-coded CEO account on a fresh database.
  console.log(`✅ Configured administrator identity ensured (${adminEmail}, @${adminUsername})`);

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