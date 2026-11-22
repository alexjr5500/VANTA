import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { initialGiftCatalog } from './gift-catalog.data';
import { CryptoUtils } from '../src/security/crypto';
import {
  ADMIN_EMAIL as adminEmail,
  ADMIN_USERNAME as adminUsername,
  ADMIN_FULL_NAME as adminFullName,
  resolveAdminPassword,
} from './admin-credentials';
import { seedAdminDevWallet } from '../src/services/admin-dev-wallet.service';
import { ensureCanonicalPurchaseCatalog } from '../src/services/purchase-catalog.service';

const prisma = new PrismaClient();

async function main() {
  const adminPassword = resolveAdminPassword();
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

  // ============================================================================
  // 0b. VERIFY THE CONFIGURED ADMIN ACCOUNT
  // Verification is a REAL, server-controlled property on the User record
  // (User.verified). This block is idempotent and never destroys existing
  // accounts/data — it only ensures the flag is set. The frontend badge reads
  // this server value; it must never be inferred from a hardcoded username.
  // ============================================================================
  const ensureVerifiedUser = async (
    handle: string,
    fullName: string,
    opts: { role?: 'USER' | 'ADMIN'; email?: string; password?: string } = {}
  ): Promise<void> => {
    const lower = handle.toLowerCase();
    // SQLite has no case-insensitive filter mode, so match known case variants
    // (covers the seeded uppercase "CEO" account without creating a duplicate).
    const variants = Array.from(
      new Set([lower, handle, handle.toUpperCase(), lower.charAt(0).toUpperCase() + lower.slice(1)])
    );

    const existing = await prisma.user.findFirst({
      where: { OR: variants.map((username) => ({ username })) },
    });

    if (existing) {
      const data: Record<string, unknown> = {};
      if (!existing.verified) data.verified = true;
      if (!existing.emailVerified) data.emailVerified = true;
      if (existing.status !== 'ACTIVE') data.status = 'ACTIVE';
      if (opts.role === 'ADMIN' && existing.role !== 'ADMIN') data.role = 'ADMIN';
      if (Object.keys(data).length > 0) {
        await prisma.user.update({ where: { id: existing.id }, data });
      }
      console.log(`✅ @${existing.username} verified (server-controlled User.verified)`);
      return;
    }

    const passwordHash = await bcrypt.hash(opts.password || `Vanta$${lower}2025`, 10);
    const created = await prisma.user.create({
      data: {
        email: opts.email || `${lower}@vanta.app`,
        username: lower,
        passwordHash,
        fullName,
        role: opts.role || 'USER',
        verified: true,
        emailVerified: true,
        status: 'ACTIVE',
        profile: { create: { username: lower, fullName } },
        wallet: { create: {} },
        userSettings: { create: {} },
        notificationPrefs: { create: {} },
      },
    });
    console.log(`✅ Verified creator account created: @${created.username}`);
  };

  // The configured administrator above is the single admin bootstrap account.
  // Do not create a second hard-coded CEO account on a fresh database.
  console.log(`✅ Configured administrator identity ensured (${adminEmail}, @${adminUsername})`);

// ============================================================================
  // 0c + 1. PURCHASE CATALOG (Verified Badge plans + VANTA Coin packages)
  // The DATABASE is the authoritative purchase catalog. The same provisioning
  // routine used at application startup (src/services/purchase-catalog.service.ts)
  // upserts:
  //   * the four canonical Verified Badge plans (Blue 1/3/6 mo, Gold 1 yr) into
  //     `SubscriptionPlan`, and
  //   * the canonical VANTA Coin packages (src/config/wallet.config.ts) into
  //     `SparkCoinPackage` — using the EXACT ids the frontend config uses
  //     (`pkg_starter`, `pkg_popular`, ...), and deactivates (never deletes)
  //     legacy rows with old ids (e.g. `pkg_popular_pack`) whose ids never
  //     existed in the config catalog.
  // This is idempotent: running it repeatedly never duplicates packages.
  // ============================================================================
  const catalog = await ensureCanonicalPurchaseCatalog(prisma);
  console.log(
    `✅ Purchase catalog provisioned: ${catalog.coinPackages} coin package(s) active, ` +
    `${catalog.badgePlans} badge plan(s), ${catalog.legacyDeactivated} legacy package(s) retired`
  );

  // ============================================================================
  // 2. Create Gifts
  // ============================================================================
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