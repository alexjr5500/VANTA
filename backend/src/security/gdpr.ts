import { prisma } from '../prisma';
import { config } from './config';
import { auditLog } from './auditLog';
import { CryptoUtils } from './crypto';

export class GDPRCompliance {
  async requestDataExport(userId: string): Promise<void> {
    await prisma.dataExportRequest.create({
      data: { userId, status: 'PENDING' },
    });
    auditLog.log({ userId, action: 'DATA_EXPORT_REQUESTED', severity: 'INFO' });
  }

  async exportUserData(userId: string): Promise<object> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true, posts: true, videos: true, stories: true,
        messagesSent: true, sessions: true, securityLogs: true,
        purchaseOrders: true, wallet: { include: { transactions: true } },
        userSettings: true, notificationPrefs: true,
        consentRecords: true,
      },
    });
    if (!user) throw new Error('User not found');
    return { exportedAt: new Date().toISOString(), user };
  }

  async requestAccountDeletion(userId: string, reason?: string): Promise<void> {
    const existing = await prisma.accountDeletionRequest.findUnique({ where: { userId } });
    if (existing) throw new Error('Deletion already requested');
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + config.compliance.deletionGracePeriodDays);
    await prisma.accountDeletionRequest.create({
      data: { userId, reason, scheduledFor },
    });
    await prisma.user.update({ where: { id: userId }, data: { status: 'DEACTIVATED' } });
    auditLog.log({ userId, action: 'ACCOUNT_DELETION_REQUESTED', severity: 'CRITICAL' });
  }

  async cancelDeletion(userId: string): Promise<void> {
    await prisma.accountDeletionRequest.delete({ where: { userId } });
    await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
  }

  async processPendingDeletions(): Promise<number> {
    const pending = await prisma.accountDeletionRequest.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: new Date() } },
    });
    for (const req of pending) {
      await this.anonymizeUser(req.userId);
      await prisma.accountDeletionRequest.update({
        where: { id: req.id }, data: { status: 'PROCESSED', processedAt: new Date() },
      });
    }
    return pending.length;
  }

  async anonymizeUser(userId: string): Promise<void> {
    const anonId = `deleted_${CryptoUtils.sha256(userId).substring(0, 16)}`;
    await prisma.user.update({
      where: { id: userId },
      data: {
        email: `${anonId}@deleted.vanta`,
        username: anonId,
        fullName: 'Deleted User',
        passwordHash: null,
        phone: null, phoneNumber: null,
        bio: null, avatar: null,
        status: 'DELETED',
      },
    });
    await prisma.session.deleteMany({ where: { userId } });
  }

  async recordConsent(userId: string, type: string, granted: boolean, ipAddress?: string): Promise<void> {
    await prisma.consentRecord.create({
      data: { userId, type, granted, ipAddress },
    });
  }

  async getConsentRecords(userId: string) {
    return prisma.consentRecord.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' },
    });
  }
}