import { prisma } from '../prisma';

export async function activeAccountSessions(userId: string, currentId: string) {
  const now = new Date();
  const sessions = await prisma.session.findMany({
    where: { userId, OR: [{ refreshExpiresAt: { gt: now } }, { refreshExpiresAt: null, expiresAt: { gt: now } }] },
    orderBy: { lastActiveAt: 'desc' },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastActiveAt: true, expiresAt: true },
  });
  return sessions.map(session => ({ ...session, isCurrent: session.id === currentId }));
}

export async function revokeOtherAccountSessions(userId: string, currentId: string) {
  if (!userId || !currentId) throw new Error('Current session required');
  const result = await prisma.session.deleteMany({ where: { userId, id: { not: currentId } } });
  return result.count;
}

export async function connectedIdentities(userId: string) {
  return prisma.providerAccount.findMany({
    where: { userId },
    select: { id: true, provider: true, email: true, displayName: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function trustedDeviceRecords(userId: string) {
  return prisma.trustedDevice.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, deviceName: true, userAgent: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function removeTrustedDeviceRecord(userId: string, id: string) {
  const result = await prisma.trustedDevice.deleteMany({ where: { userId, id } });
  return result.count > 0;
}
