/** One-time, administrator-only bootstrap. Does not seed gifts, coins or wallets beyond the new user's empty wallet. */
import { PrismaClient } from '@prisma/client';
import { ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_FULL_NAME, resolveAdminPassword } from './admin-credentials';
import { ensureInitialAdministrator } from './ensure-initial-administrator';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const action = await ensureInitialAdministrator(
    prisma,
    { email: ADMIN_EMAIL, username: ADMIN_USERNAME, fullName: ADMIN_FULL_NAME },
    resolveAdminPassword,
  );
  console.log(action === 'created'
    ? '[ADMIN BOOTSTRAP] Initial administrator created.'
    : '[ADMIN BOOTSTRAP] Matching account exists; no account or password changed.');
}

main()
  .catch((error) => {
    console.error('[ADMIN BOOTSTRAP] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
