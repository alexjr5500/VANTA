import bcrypt from 'bcryptjs';

export interface AdministratorSeedClient {
  user: {
    findFirst(args: { where: { OR: Array<{ email?: string; username?: string }> } }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

/** Only creates a missing administrator. Never alters an existing account. */
export async function ensureInitialAdministrator(
  prisma: AdministratorSeedClient,
  identity: { email: string; username: string; fullName: string },
  resolvePassword: () => string,
): Promise<'existing' | 'created'> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: identity.email }, { username: identity.username }] },
  });
  if (existing) return 'existing';

  const passwordHash = await bcrypt.hash(resolvePassword(), 10);
  await prisma.user.create({
    data: {
      email: identity.email,
      username: identity.username,
      fullName: identity.fullName,
      passwordHash,
      role: 'ADMIN',
      verified: true,
      emailVerified: true,
      status: 'ACTIVE',
      profile: { create: { username: identity.username, fullName: identity.fullName } },
      wallet: { create: {} },
      userSettings: { create: {} },
      notificationPrefs: { create: {} },
    },
  });
  return 'created';
}
