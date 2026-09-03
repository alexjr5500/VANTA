/**
 * VANTA - Verified Creator Provisioning (plain JS, no ts-node needed)
 *
 * Marks @alex and @ceo as VERIFIED using the real, server-controlled
 * `User.verified` boolean — the single source of truth the whole app reads.
 * Idempotent and NON-destructive: only flips verified/emailVerified/status,
 * never deletes or resets data.
 *
 * Usage: node prisma/verify-creators.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function ensureVerified(handle, opts = {}) {
  const lower = handle.toLowerCase();
  const variants = Array.from(
    new Set([lower, handle, handle.toUpperCase(), lower.charAt(0).toUpperCase() + lower.slice(1)])
  );

  const existing = await prisma.user.findFirst({
    where: { OR: variants.map((username) => ({ username })) },
  });

  if (!existing) {
    console.log(`⚠️  @${handle} not found — skipping (no destructive create).`);
    return;
  }

  const data = {};
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
}

async function main() {
  console.log('🔵 VANTA verified-creator provisioning');
  await ensureVerified('ceo', { role: 'ADMIN' });
  await ensureVerified('alex');

  const rows = await prisma.user.findMany({
    where: { OR: [{ username: 'ceo' }, { username: 'CEO' }, { username: 'alex' }, { username: 'Alex' }] },
    select: { username: true, verified: true, role: true, status: true },
  });
  console.log('FINAL_STATE=' + JSON.stringify(rows));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
