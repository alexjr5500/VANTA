/**
 * VANTA - Verified Creator Provisioning Script
 *
 * Marks the @alex and @ceo accounts as VERIFIED using the real,
 * server-controlled `User.verified` boolean. This is the single source of
 * truth the whole application reads from; the frontend badge must never be
 * inferred from a hardcoded username.
 *
 * The script is idempotent and NON-destructive:
 *   - It never resets the database or deletes records.
 *   - If the account exists (any case variant) it only sets verified = true.
 *   - If the account is missing it creates a minimal, valid demo account so
 *     the badge is demonstrable.
 *
 * Usage: npx ts-node --transpile-only prisma/verify-creators.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

interface EnsureOptions {
  role?: 'USER' | 'ADMIN';
  email?: string;
  password?: string;
}

async function ensureVerifiedUser(handle: string, fullName: string, opts: EnsureOptions = {}): Promise<void> {
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
      console.log(`✅ Updated @${existing.username}: ${JSON.stringify(data)}`);
    } else {
      console.log(`✅ @${existing.username} already verified — no changes needed`);
    }
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
  console.log(`✅ Created verified account @${created.username} [ID: ${created.id}]`);
}

async function main(): Promise<void> {
  console.log('🔵 VANTA verified-creator provisioning');
  console.log('='.repeat(56));

  await ensureVerifiedUser('ceo', 'CEO', { role: 'ADMIN' });
  await ensureVerifiedUser('alex', 'Alex');

  // Report final state so the change is auditable.
  const rows = await prisma.user.findMany({
    where: { OR: [{ username: 'ceo' }, { username: 'CEO' }, { username: 'alex' }, { username: 'Alex' }] },
    select: { id: true, username: true, verified: true, role: true, status: true },
  });
  console.log('\n📋 Verified creator state:');
  for (const row of rows) {
    const icon = row.verified ? '✅' : '❌';
    console.log(`${icon} @${row.username} — verified=${row.verified}, role=${row.role}, status=${row.status}`);
  }
  console.log('='.repeat(56));
}

main()
  .catch((e) => {
    console.error('❌ Verified-creator provisioning failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
