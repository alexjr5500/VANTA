import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { initialGiftCatalog } from './gift-catalog.data';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding VANTA monetization data...');

  // ============================================================================
  // 0. CREATE ADMINISTRATOR ACCOUNT (if not exists)
  // ============================================================================
  const adminEmail = 'ceo@vanta.app';
  const adminUsername = 'CEO';
  const adminPassword = '2388562Ceo$';

  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        { email: adminEmail },
        { username: adminUsername },
      ],
    },
  });

  if (existingAdmin) {
    // Update missing fields if necessary
    const updates: any = {};
    if (existingAdmin.role !== 'ADMIN') updates.role = 'ADMIN';
    if (!existingAdmin.verified) updates.verified = true;
    if (!existingAdmin.emailVerified) updates.emailVerified = true;

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: updates,
      });
      console.log('✅ Administrator account updated with missing fields');
    } else {
      console.log('✅ Administrator account already exists and is up-to-date');
    }
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
        fullName: 'CEO',
        role: 'ADMIN',
        verified: true,
        emailVerified: true,
        status: 'ACTIVE',
        profile: {
          create: {
            username: adminUsername,
            fullName: 'CEO',
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
  // 0b. VERIFIED CREATOR ACCOUNTS (@alex, @ceo)
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

  await ensureVerifiedUser('ceo', 'CEO', { role: 'ADMIN', email: adminEmail, password: adminPassword });
  await ensureVerifiedUser('alex', 'Alex');
  console.log('✅ Verified creator accounts ensured (@alex, @ceo)');

  // ============================================================================
  // 1. Create VANTA Packages (up to $100,000)
  // ============================================================================

  const packages = [
    { name: 'Starter Pack', coins: 100, price: 0.99, bonusCoins: 0, isPopular: false, sortOrder: 1 },
    { name: 'Popular Pack', coins: 550, price: 4.99, bonusCoins: 50, isPopular: true, sortOrder: 2 },
    { name: 'Premium Pack', coins: 1200, price: 9.99, bonusCoins: 100, isPopular: true, sortOrder: 3 },
    { name: 'Elite Pack', coins: 2500, price: 19.99, bonusCoins: 300, isPopular: false, sortOrder: 4 },
    { name: 'Ultra Pack', coins: 6500, price: 49.99, bonusCoins: 1000, isPopular: false, sortOrder: 5 },
    { name: 'Legendary Pack', coins: 14000, price: 99.99, bonusCoins: 3000, isPopular: false, sortOrder: 6 },
    // High-value packages (up to $100,000)
    { name: 'Platinum Pack', coins: 107500, price: 999.99, bonusCoins: 7500, isPopular: false, sortOrder: 7 },
    { name: 'Diamond Pack', coins: 540000, price: 4999.99, bonusCoins: 40000, isPopular: false, sortOrder: 8 },
    { name: 'Royal Pack', coins: 1090000, price: 9999.99, bonusCoins: 90000, isPopular: false, sortOrder: 9 },
    { name: 'Imperial Pack', coins: 2750000, price: 24999.99, bonusCoins: 250000, isPopular: false, sortOrder: 10 },
    { name: 'Sovereign Pack', coins: 5550000, price: 49999.99, bonusCoins: 550000, isPopular: false, sortOrder: 11 },
    { name: 'VANTA Black Pack', coins: 11200000, price: 99999.99, bonusCoins: 1200000, isPopular: false, sortOrder: 12 },
  ];

  for (const pkg of packages) {
    const id = `pkg_${pkg.name.toLowerCase().replace(/\s+/g, '_')}`;
    await prisma.sparkCoinPackage.upsert({ where: { id }, update: pkg, create: { id, ...pkg } });
  }
  console.log('✅ SparkCoin packages created');

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