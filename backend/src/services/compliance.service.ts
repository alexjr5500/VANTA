import { prisma } from '../prisma';
import { auditLog } from '../security/auditLog';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// COMPLIANCE SERVICE - Core business logic for privacy, legal & compliance
// ============================================================================

class ComplianceService {
  // ==========================================================================
  // PRIVACY CENTER
  // ==========================================================================

  async getPrivacySettings(userId: string) {
    let settings = await prisma.privacySettings.findUnique({ where: { userId } });
    if (!settings) {
      settings = await prisma.privacySettings.create({
        data: { userId },
      });
    }
    return settings;
  }

  async updatePrivacySettings(userId: string, data: any) {
    const settings = await prisma.privacySettings.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    await this.logComplianceAction(userId, 'PRIVACY_SETTINGS_UPDATE', 'SETTINGS', userId, data);
    return settings;
  }

  // ==========================================================================
  // CONSENT MANAGEMENT
  // ==========================================================================

  async getConsentPreferences(userId: string) {
    let prefs = await prisma.consentPreference.findUnique({ where: { userId } });
    if (!prefs) {
      prefs = await prisma.consentPreference.create({
        data: { userId },
      });
    }
    return prefs;
  }

  async updateConsentPreferences(userId: string, data: any, source = 'privacy_center', ipAddress?: string, userAgent?: string) {
    const existing = await prisma.consentPreference.findUnique({ where: { userId } }) || {};

    const updated = await prisma.consentPreference.upsert({
      where: { userId },
      update: {
        analytics: data.analytics ?? existing.analytics,
        personalization: data.personalization ?? existing.personalization,
        marketing: data.marketing ?? existing.marketing,
        aiFeatures: data.aiFeatures ?? existing.aiFeatures,
        notifications: data.notifications ?? existing.notifications,
        cookies: data.cookies ?? existing.cookies,
        lastUpdatedAt: new Date(),
      },
      create: {
        userId,
        analytics: data.analytics || 'not_set',
        personalization: data.personalization || 'not_set',
        marketing: data.marketing || 'not_set',
        aiFeatures: data.aiFeatures || 'not_set',
        notifications: data.notifications || 'not_set',
        cookies: data.cookies || 'not_set',
      },
    });

    // Record consent history for audit
    const consentTypes = ['analytics', 'personalization', 'marketing', 'aiFeatures', 'notifications', 'cookies'];
    for (const type of consentTypes) {
      if (data[type] && data[type] !== (existing as any)[type]) {
        await prisma.consentHistory.create({
          data: {
            userId,
            type,
            action: data[type] === 'granted' ? 'granted' : data[type] === 'denied' ? 'denied' : 'updated',
            previousValue: (existing as any)[type] || null,
            newValue: data[type],
            ipAddress,
            userAgent,
            source,
          },
        });
      }
    }

    await this.logComplianceAction(userId, 'CONSENT_UPDATE', 'CONSENT', userId, data);
    return updated;
  }

  async getConsentHistory(userId: string, limit = 50) {
    return prisma.consentHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ==========================================================================
  // DATA EXPORT
  // ==========================================================================

  async requestDataExport(userId: string) {
    const existingPending = await prisma.dataExportRequest.findFirst({
      where: { userId, status: { in: ['PENDING', 'PROCESSING'] } },
    });

    if (existingPending) {
      throw new Error('You already have a pending data export request.');
    }

    const request = await prisma.dataExportRequest.create({
      data: {
        userId,
        status: 'PENDING',
      },
    });

    await this.logComplianceAction(userId, 'DATA_EXPORT_REQUESTED', 'USER', userId, { requestId: request.id });

    // Process asynchronously
    this.processDataExport(userId, request.id).catch(err => {
      console.error(`[Compliance] Data export failed for user ${userId}:`, err);
    });

    return request;
  }

  private async processDataExport(userId: string, requestId: string) {
    try {
      await prisma.dataExportRequest.update({
        where: { id: requestId },
        data: { status: 'PROCESSING' },
      });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          photos: true,
          posts: { include: { likes: true, comments: true } },
          videos: { include: { likes: true, comments: true } },
          stories: true,
          messagesSent: { take: 1000 },
          followers: { take: 1000 },
          following: { take: 1000 },
          wallet: true,
          walletTransactions: { take: 1000 },
          sentGifts: { take: 1000 },
          receivedGifts: { take: 1000 },
          userSettings: true,
          notificationPrefs: true,
          communityMembers: { include: { community: true } },
          channelMembers: { include: { channel: true } },
          groupMembers: { include: { group: true } },
          liveStreams: { take: 100 },
          sessions: { take: 100 },
          privacySettings: true,
          consentPreferences: true,
        },
      });

      if (!user) throw new Error('User not found');

      // Build export data
      const exportData = {
        exportedAt: new Date().toISOString(),
        platform: 'VANTA',
        account: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          fullName: user.fullName,
          bio: user.bio,
          gender: user.gender,
          age: user.age,
          country: user.country,
          city: user.city,
          verified: user.verified,
          premium: user.premium,
          role: user.role,
          coins: user.coins,
          earnings: user.earnings,
          createdAt: user.createdAt,
        },
        profile: user.profile,
        photos: user.photos,
        posts: user.posts,
        videos: user.videos,
        stories: user.stories,
        messages: user.messagesSent,
        followers: user.followers,
        following: user.following,
        wallet: user.wallet,
        transactions: user.walletTransactions,
        giftsSent: user.sentGifts,
        giftsReceived: user.receivedGifts,
        settings: {
          userSettings: user.userSettings,
          notificationPrefs: user.notificationPrefs,
          privacySettings: user.privacySettings,
        },
        communities: user.communityMembers,
        channels: user.channelMembers,
        groups: user.groupMembers,
        liveStreams: user.liveStreams,
        sessions: user.sessions,
        consentPreferences: user.consentPreferences,
      };

      // Generate archive
      const exportDir = path.resolve(__dirname, '../../exports');
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      const fileName = `vanta-export-${userId}-${Date.now()}.zip`;
      const filePath = path.join(exportDir, fileName);

      await this.createExportArchive(filePath, exportData, user);

      // Update request status
      await prisma.dataExportRequest.update({
        where: { id: requestId },
        data: {
          status: 'COMPLETED',
          filePath,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });

      // Send notification
      await this.createComplianceNotification(userId, 'DATA_EXPORT_READY', {
        title: 'Your data export is ready',
        message: 'Your requested data export has been generated and is available for download. The file will be available for 7 days.',
        actionUrl: '/privacy-center?tab=export',
      });

      await this.logComplianceAction(userId, 'DATA_EXPORT_COMPLETED', 'USER', userId, { requestId });
    } catch (error: any) {
      await prisma.dataExportRequest.update({
        where: { id: requestId },
        data: { status: 'FAILED' },
      });

      await this.createComplianceNotification(userId, 'DATA_EXPORT_FAILED', {
        title: 'Data export failed',
        message: 'Your data export request could not be processed. Please try again or contact support.',
        actionUrl: '/privacy-center?tab=export',
      });

      await this.logComplianceAction(userId, 'DATA_EXPORT_FAILED', 'USER', userId, { requestId, error: error.message });
    }
  }

  private async createExportArchive(filePath: string, exportData: any, user: any): Promise<void> {
    const archiver = require('archiver');
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);

      // Add JSON data files
      archive.append(JSON.stringify(exportData.account, null, 2), { name: 'account.json' });
      archive.append(JSON.stringify(exportData.profile, null, 2), { name: 'profile.json' });
      archive.append(JSON.stringify(exportData.photos, null, 2), { name: 'photos.json' });
      archive.append(JSON.stringify(exportData.posts, null, 2), { name: 'posts.json' });
      archive.append(JSON.stringify(exportData.videos, null, 2), { name: 'videos.json' });
      archive.append(JSON.stringify(exportData.stories, null, 2), { name: 'stories.json' });
      archive.append(JSON.stringify(exportData.messages, null, 2), { name: 'messages.json' });
      archive.append(JSON.stringify(exportData.followers, null, 2), { name: 'followers.json' });
      archive.append(JSON.stringify(exportData.following, null, 2), { name: 'following.json' });
      archive.append(JSON.stringify(exportData.wallet, null, 2), { name: 'wallet.json' });
      archive.append(JSON.stringify(exportData.transactions, null, 2), { name: 'transactions.json' });
      archive.append(JSON.stringify(exportData.giftsSent, null, 2), { name: 'gifts_sent.json' });
      archive.append(JSON.stringify(exportData.giftsReceived, null, 2), { name: 'gifts_received.json' });
      archive.append(JSON.stringify(exportData.settings, null, 2), { name: 'settings.json' });
      archive.append(JSON.stringify(exportData.communities, null, 2), { name: 'communities.json' });
      archive.append(JSON.stringify(exportData.channels, null, 2), { name: 'channels.json' });
      archive.append(JSON.stringify(exportData.groups, null, 2), { name: 'groups.json' });
      archive.append(JSON.stringify(exportData.liveStreams, null, 2), { name: 'live_streams.json' });
      archive.append(JSON.stringify(exportData.sessions, null, 2), { name: 'sessions.json' });
      archive.append(JSON.stringify(exportData.consentPreferences, null, 2), { name: 'consent_preferences.json' });

      // Add README
      const readme = `VANTA Data Export
=======================
Exported on: ${exportData.exportedAt}
Account: ${user.username} (${user.id})

This archive contains your data from VANTA in JSON format.
Files can be opened with any text editor or JSON viewer.

For questions about your data, contact privacy@vanta.app
`;
      archive.append(readme, { name: 'README.txt' });

      archive.finalize();
    });
  }

  async getDataExports(userId: string) {
    return prisma.dataExportRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async downloadExport(exportId: string, userId: string) {
    const exportReq = await prisma.dataExportRequest.findFirst({
      where: { id: exportId, userId },
    });

    if (!exportReq || !exportReq.filePath) {
      throw new Error('Export not found or not yet available.');
    }

    if (exportReq.expiresAt && exportReq.expiresAt < new Date()) {
      throw new Error('This export has expired. Please request a new one.');
    }

    return exportReq;
  }

  // ==========================================================================
  // ACCOUNT DELETION / DEACTIVATION
  // ==========================================================================

  async deactivateAccount(userId: string, reason?: string, reasonDetail?: string) {
    const existing = await prisma.accountDeactivation.findUnique({ where: { userId } });
    if (existing && existing.status === 'DEACTIVATED') {
      throw new Error('Account is already deactivated.');
    }
    if (existing && existing.status === 'SCHEDULED_FOR_DELETION') {
      throw new Error('Account is already scheduled for deletion.');
    }

    const deactivation = await prisma.accountDeactivation.upsert({
      where: { userId },
      update: {
        deactivationType: 'TEMPORARY',
        reason,
        reasonDetail,
        status: 'DEACTIVATED',
        deactivatedAt: new Date(),
        recoveryPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days recovery
        recoveryToken: uuidv4(),
      },
      create: {
        userId,
        deactivationType: 'TEMPORARY',
        reason,
        reasonDetail,
        status: 'DEACTIVATED',
        deactivatedAt: new Date(),
        recoveryPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        recoveryToken: uuidv4(),
      },
    });

    // Update user status
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'DEACTIVATED' },
    });

    await this.logComplianceAction(userId, 'ACCOUNT_DEACTIVATED', 'USER', userId, { deactivationId: deactivation.id, reason });
    return deactivation;
  }

  async scheduleAccountDeletion(userId: string, reason?: string, scheduledDate?: Date) {
    const deleteDate = scheduledDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days

    // First deactivate if not already
    const existing = await prisma.accountDeactivation.findUnique({ where: { userId } });
    if (existing && existing.status === 'DELETED') {
      throw new Error('Account has already been deleted.');
    }

    const deactivation = await prisma.accountDeactivation.upsert({
      where: { userId },
      update: {
        deactivationType: 'SCHEDULED',
        reason,
        status: 'SCHEDULED_FOR_DELETION',
        deactivatedAt: existing?.deactivatedAt || new Date(),
        scheduledFor: deleteDate,
        recoveryPeriodEnd: deleteDate,
      },
      create: {
        userId,
        deactivationType: 'SCHEDULED',
        reason,
        status: 'SCHEDULED_FOR_DELETION',
        deactivatedAt: new Date(),
        scheduledFor: deleteDate,
        recoveryPeriodEnd: deleteDate,
        recoveryToken: uuidv4(),
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'SCHEDULED_FOR_DELETION' },
    });

    await this.logComplianceAction(userId, 'ACCOUNT_DELETION_SCHEDULED', 'USER', userId, {
      deactivationId: deactivation.id,
      scheduledFor: deleteDate,
      reason,
    });

    return deactivation;
  }

  async cancelDeletion(userId: string) {
    const deactivation = await prisma.accountDeactivation.findUnique({ where: { userId } });
    if (!deactivation) throw new Error('No deletion request found.');
    if (deactivation.status === 'DELETED') throw new Error('Account has already been deleted.');

    const updated = await prisma.accountDeactivation.update({
      where: { userId },
      data: {
        status: 'RECOVERED',
        recoveredAt: new Date(),
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE' },
    });

    await this.logComplianceAction(userId, 'ACCOUNT_DELETION_CANCELLED', 'USER', userId, { deactivationId: deactivation.id });
    return updated;
  }

  async recoverAccount(userId: string, recoveryToken: string) {
    const deactivation = await prisma.accountDeactivation.findUnique({ where: { userId } });
    if (!deactivation) throw new Error('No deactivation record found.');
    if (deactivation.recoveryToken !== recoveryToken) throw new Error('Invalid recovery token.');
    if (deactivation.recoveryPeriodEnd && deactivation.recoveryPeriodEnd < new Date()) {
      throw new Error('Recovery period has expired. Account has been permanently deleted.');
    }

    const updated = await prisma.accountDeactivation.update({
      where: { userId },
      data: {
        status: 'RECOVERED',
        recoveredAt: new Date(),
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE' },
    });

    await this.logComplianceAction(userId, 'ACCOUNT_RECOVERED', 'USER', userId, { deactivationId: deactivation.id });
    return updated;
  }

  async getDeactivationStatus(userId: string) {
    return prisma.accountDeactivation.findUnique({ where: { userId } });
  }

  async permanentlyDeleteExpiredAccounts() {
    const expired = await prisma.accountDeactivation.findMany({
      where: {
        status: 'SCHEDULED_FOR_DELETION',
        scheduledFor: { lte: new Date() },
      },
    });

    for (const deactivation of expired) {
      await this.permanentlyDeleteUser(deactivation.userId);
    }

    // Also check deactivated accounts past recovery period
    const unrecovered = await prisma.accountDeactivation.findMany({
      where: {
        status: 'DEACTIVATED',
        recoveryPeriodEnd: { lte: new Date() },
      },
    });

    for (const deactivation of unrecovered) {
      await this.permanentlyDeleteUser(deactivation.userId);
    }

    return { deleted: expired.length, unrecovered: unrecovered.length };
  }

  private async permanentlyDeleteUser(userId: string) {
    try {
      // Anonymize data for legal retention (financial records, fraud prevention)
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (user) {
        // Anonymize PII
        await prisma.user.update({
          where: { id: userId },
          data: {
            email: `deleted-${userId}@vanta.app`,
            phone: null,
            phoneNumber: null,
            passwordHash: null,
            fullName: 'Deleted Account',
            username: `deleted_${userId.substring(0, 8)}`,
            bio: null,
            avatar: null,
            status: 'DELETED',
            googleId: null,
            appleId: null,
            twoFactorSecret: null,
            backupCodes: null,
            rememberMeToken: null,
          },
        });

        // Update deactivation record
        await prisma.accountDeactivation.update({
          where: { userId },
          data: {
            status: 'DELETED',
            permanentlyDeletedAt: new Date(),
          },
        });

        // Delete sessions
        await prisma.session.deleteMany({ where: { userId } });

        // Delete non-essential data (keep financial records per policy)
        await prisma.post.deleteMany({ where: { authorId: userId } });
        await prisma.video.deleteMany({ where: { creatorId: userId } });
        await prisma.story.deleteMany({ where: { userId } });
        await prisma.message.deleteMany({ where: { senderId: userId } });

        await this.logComplianceAction(userId, 'ACCOUNT_PERMANENTLY_DELETED', 'USER', userId, {});
      }
    } catch (error) {
      console.error(`[Compliance] Error permanently deleting user ${userId}:`, error);
    }
  }

  // ==========================================================================
  // REPORTING SYSTEM
  // ==========================================================================

  async createReport(
    reporterId: string,
    targetType: string,
    targetId: string,
    category: string,
    description?: string,
    targetUserId?: string,
    evidenceUrls?: string[],
  ) {
    // Check for duplicate reports
    const recentReport = await prisma.report.findFirst({
      where: {
        reporterId,
        targetType,
        targetId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24h
      },
    });

    if (recentReport) {
      throw new Error('You have already reported this content. Please allow time for review.');
    }

    const report = await prisma.report.create({
      data: {
        reporterId,
        targetType,
        targetId,
        category,
        description,
        targetUserId,
        evidenceUrls: evidenceUrls ? JSON.stringify(evidenceUrls) : null,
        status: 'PENDING',
        priority: this.calculateReportPriority(category),
      },
    });

    await this.logComplianceAction(reporterId, 'REPORT_CREATED', 'REPORT', report.id, {
      targetType,
      targetId,
      category,
    });

    return report;
  }

  private calculateReportPriority(category: string): string {
    const urgentCategories = ['illegal_content', 'child_safety', 'violence', 'self_harm'];
    const highCategories = ['harassment', 'hate_speech', 'impersonation'];
    
    if (urgentCategories.includes(category)) return 'URGENT';
    if (highCategories.includes(category)) return 'HIGH';
    return 'NORMAL';
  }

  async getReports(userId: string, role: string, limit = 50, offset = 0) {
    const where: any = {};
    
    if (role === 'USER') {
      where.reporterId = userId;
    } else if (role === 'MODERATOR') {
      where.OR = [
        { reporterId: userId },
        { assignedTo: userId },
      ];
    }
    // ADMIN and SUPER_ADMIN see all

    return prisma.report.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
      skip: offset,
      include: {
        reporter: { select: { id: true, username: true, avatar: true } },
      },
    });
  }

  async processReport(reportId: string, adminId: string, action: string, note?: string) {
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new Error('Report not found.');

    const updated = await prisma.report.update({
      where: { id: reportId },
      data: {
        status: action === 'dismiss' ? 'DISMISSED' : 'ACTIONED',
        actionTaken: action,
        processedById: adminId,
        processedAt: new Date(),
        resolutionNote: note,
      },
    });

    // If action involves user, update their status
    if (report.targetUserId && ['suspend', 'ban', 'warn'].includes(action)) {
      const userStatus = action === 'ban' ? 'BANNED' : action === 'suspend' ? 'SUSPENDED' : undefined;
      if (userStatus) {
        await prisma.user.update({
          where: { id: report.targetUserId },
          data: { status: userStatus },
        });
      }
    }

    await this.logComplianceAction(adminId, 'REPORT_PROCESSED', 'REPORT', reportId, {
      action,
      note,
      previousStatus: report.status,
    });

    return updated;
  }

  // ==========================================================================
  // APPEALS SYSTEM
  // ==========================================================================

  async createAppeal(
    userId: string,
    appealType: string,
    reason: string,
    explanation?: string,
    targetId?: string,
    reportId?: string,
    evidenceUrls?: string[],
  ) {
    // Check for existing open appeal
    const existingAppeal = await prisma.appeal.findFirst({
      where: {
        userId,
        appealType,
        status: { in: ['PENDING', 'UNDER_REVIEW', 'ESCALATED'] },
      },
    });

    if (existingAppeal) {
      throw new Error('You already have a pending appeal for this type. Please wait for a decision.');
    }

    const appeal = await prisma.appeal.create({
      data: {
        userId,
        appealType,
        targetType: this.getAppealTargetType(appealType),
        targetId,
        reportId,
        reason,
        explanation,
        evidenceUrls: evidenceUrls ? JSON.stringify(evidenceUrls) : null,
        status: 'PENDING',
      },
    });

    await this.logComplianceAction(userId, 'APPEAL_CREATED', 'APPEAL', appeal.id, {
      appealType,
      reason,
    });

    return appeal;
  }

  private getAppealTargetType(appealType: string): string {
    const mapping: Record<string, string> = {
      SUSPENSION: 'ACCOUNT',
      BAN: 'ACCOUNT',
      CONTENT_REMOVAL: 'CONTENT',
      MONETIZATION_DECISION: 'MONETIZATION',
      REPORT_DISMISSAL: 'REPORT',
    };
    return mapping[appealType] || 'ACCOUNT';
  }

  async getAppeals(userId: string, role: string, limit = 50, offset = 0) {
    const where: any = {};
    
    if (role === 'USER') {
      where.userId = userId;
    }

    return prisma.appeal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
  }

  async processAppeal(appealId: string, adminId: string, decision: string, reason?: string) {
    const appeal = await prisma.appeal.findUnique({ where: { id: appealId } });
    if (!appeal) throw new Error('Appeal not found.');

    const updated = await prisma.appeal.update({
      where: { id: appealId },
      data: {
        status: decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : 'ESCALATED',
        decision,
        decisionReason: reason,
        reviewedById: adminId,
        reviewedAt: new Date(),
      },
    });

    // If appeal approved, restore user status
    if (decision === 'APPROVED' && appeal.appealType === 'SUSPENSION') {
      await prisma.user.update({
        where: { id: appeal.userId },
        data: { status: 'ACTIVE' },
      });
    }

    // Notify the user
    await this.createComplianceNotification(appeal.userId, 'APPEAL_DECISION', {
      title: `Appeal ${decision.toLowerCase()}`,
      message: `Your appeal regarding ${appeal.appealType.toLowerCase().replace('_', ' ')} has been ${decision.toLowerCase()}.${reason ? ` Reason: ${reason}` : ''}`,
      actionUrl: '/privacy-center?tab=appeals',
    });

    await this.logComplianceAction(adminId, 'APPEAL_PROCESSED', 'APPEAL', appealId, {
      decision,
      reason,
      previousStatus: appeal.status,
    });

    return updated;
  }

  // ==========================================================================
  // COPYRIGHT MANAGEMENT
  // ==========================================================================

  async createCopyrightClaim(data: {
    claimantName: string;
    claimantEmail: string;
    claimantUserId?: string;
    rightsHolderName: string;
    rightsHolderContact?: string;
    originalWorkTitle: string;
    originalWorkUrl?: string;
    originalWorkDescription?: string;
    infringingUrl: string;
    infringingContentId?: string;
    infringingContentType?: string;
    infringingUserId?: string;
  }) {
    // Check for existing claim on same content
    if (data.infringingUrl) {
      const existing = await prisma.copyrightClaim.findFirst({
        where: { infringingUrl: data.infringingUrl, status: { notIn: ['REJECTED', 'RESOLVED'] } },
      });
      if (existing) throw new Error('A copyright claim already exists for this content.');
    }

    const claim = await prisma.copyrightClaim.create({
      data: {
        ...data,
        status: 'PENDING',
      },
    });

    // Track repeat infringement
    if (data.infringingUserId) {
      await this.trackRepeatInfringement(data.infringingUserId, claim.id);
    }

    await this.logComplianceAction(data.claimantUserId || 'anonymous', 'COPYRIGHT_CLAIM_FILED', 'COPYRIGHT_CLAIM', claim.id, {
      infringingUrl: data.infringingUrl,
      originalWork: data.originalWorkTitle,
    });

    return claim;
  }

  private async trackRepeatInfringement(userId: string, claimId: string) {
    const existing = await prisma.repeatInfringement.findUnique({ where: { userId } });

    if (existing) {
      const newCount = existing.infringementCount + 1;
      const status = newCount >= 3 ? 'ACCOUNT_LOCKED' : newCount >= 2 ? 'WARNING_SENT' : 'MONITORING';

      await prisma.repeatInfringement.update({
        where: { userId },
        data: {
          infringementCount: newCount,
          lastClaimId: claimId,
          status,
          warningSentAt: newCount === 2 ? new Date() : existing.warningSentAt,
          lockedAt: newCount >= 3 ? new Date() : existing.lockedAt,
        },
      });

      if (status === 'ACCOUNT_LOCKED') {
        await prisma.user.update({
          where: { id: userId },
          data: { status: 'BANNED' },
        });
      }
    } else {
      await prisma.repeatInfringement.create({
        data: {
          userId,
          infringementCount: 1,
          lastClaimId: claimId,
          status: 'MONITORING',
        },
      });
    }
  }

  async processCopyrightClaim(claimId: string, adminId: string, action: string, note?: string) {
    const claim = await prisma.copyrightClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new Error('Copyright claim not found.');

    const updated = await prisma.copyrightClaim.update({
      where: { id: claimId },
      data: {
        status: action === 'remove' ? 'ACTIONED' : action === 'reject' ? 'REJECTED' : 'COUNTER_NOTICE',
        actionTaken: action === 'remove' ? 'CONTENT_REMOVED' : action === 'restore' ? 'RESTORED' : undefined,
        processedById: adminId,
        processedAt: new Date(),
        decisionNote: note,
      },
    });

    await this.logComplianceAction(adminId, 'COPYRIGHT_CLAIM_PROCESSED', 'COPYRIGHT_CLAIM', claimId, {
      action,
      note,
    });

    return updated;
  }

  async fileCounterNotice(claimId: string, data: {
    respondentName: string;
    respondentEmail: string;
    respondentUserId?: string;
    statement: string;
    signature: string;
    contactInfo?: string;
  }) {
    const claim = await prisma.copyrightClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new Error('Copyright claim not found.');

    const counterNotice = await prisma.counterNotice.create({
      data: {
        copyrightClaimId: claimId,
        ...data,
        status: 'PENDING',
      },
    });

    await prisma.copyrightClaim.update({
      where: { id: claimId },
      data: {
        status: 'COUNTER_NOTICE',
        counterNoticeId: counterNotice.id,
        counterNoticeAt: new Date(),
      },
    });

    await this.logComplianceAction(data.respondentUserId || 'anonymous', 'COUNTER_NOTICE_FILED', 'COPYRIGHT_CLAIM', claimId, {
      counterNoticeId: counterNotice.id,
    });

    return counterNotice;
  }

  async getCopyrightClaims(limit = 50, offset = 0, status?: string) {
    const where: any = {};
    if (status) where.status = status;

    return prisma.copyrightClaim.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  // ==========================================================================
  // COMMUNITY STANDARDS
  // ==========================================================================

  async getCommunityStandards() {
    return prisma.communityStandard.findMany({
      where: { isActive: true },
      orderBy: { type: 'asc' },
    });
  }

  async upsertCommunityStandard(type: string, title: string, content: string, version: string) {
    const standard = await prisma.communityStandard.upsert({
      where: { type },
      update: {
        title,
        content,
        version,
        publishedAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        type,
        title,
        content,
        version,
        isActive: true,
        publishedAt: new Date(),
      },
    });

    await this.logComplianceAction('system', 'COMMUNITY_STANDARD_UPDATED', 'POLICY', standard.id, {
      type,
      version,
    });

    return standard;
  }

  // ==========================================================================
  // POLICY & USER AGREEMENTS
  // ==========================================================================

  async getCurrentPolicy(policyType: string) {
    return prisma.policyVersion.findFirst({
      where: { policyType, isCurrent: true },
    });
  }

  async getAllPolicies() {
    return prisma.policyVersion.findMany({
      where: { isCurrent: true },
      orderBy: { policyType: 'asc' },
    });
  }

  async publishPolicyVersion(policyType: string, version: string, title: string, content: string) {
    // Set all previous versions as not current
    await prisma.policyVersion.updateMany({
      where: { policyType },
      data: { isCurrent: false },
    });

    const policy = await prisma.policyVersion.create({
      data: {
        policyType,
        version,
        title,
        content,
        isCurrent: true,
        publishedAt: new Date(),
        effectiveAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days notice
      },
    });

    await this.logComplianceAction('system', 'POLICY_PUBLISHED', 'POLICY', policy.id, {
      policyType,
      version,
    });

    return policy;
  }

  async acceptPolicy(userId: string, policyType: string, version: string, ipAddress?: string, userAgent?: string) {
    const acceptance = await prisma.policyAcceptance.upsert({
      where: {
        userId_policyType: { userId, policyType },
      },
      update: {
        policyVersion: version,
        acceptedAt: new Date(),
        accepted: true,
        ipAddress,
        userAgent,
      },
      create: {
        userId,
        policyType,
        policyVersion: version,
        accepted: true,
        ipAddress,
        userAgent,
      },
    });

    await this.logComplianceAction(userId, 'POLICY_ACCEPTED', 'POLICY', userId, {
      policyType,
      version,
    });

    return acceptance;
  }

  async getUserPolicyAcceptances(userId: string) {
    return prisma.policyAcceptance.findMany({
      where: { userId },
    });
  }

  // ==========================================================================
  // CHILD SAFETY
  // ==========================================================================

  async createChildSafetyFlag(data: {
    userId: string;
    flagType: string;
    ageEstimate?: number;
    declaredAge?: number;
    notes?: string;
  }) {
    const flag = await prisma.childSafetyFlag.create({
      data: {
        ...data,
        status: 'PENDING_REVIEW',
        escalationLevel: 'NORMAL',
      },
    });

    // Auto-escalate for high-priority flags
    if (data.flagType === 'AI_DETECTED' || data.declaredAge && data.declaredAge < 13) {
      await prisma.childSafetyFlag.update({
        where: { id: flag.id },
        data: { escalationLevel: 'HIGH' },
      });
    }

    await this.logComplianceAction('system', 'CHILD_SAFETY_FLAG_CREATED', 'USER', data.userId, {
      flagType: data.flagType,
      flagId: flag.id,
    });

    return flag;
  }

  async processChildSafetyFlag(flagId: string, adminId: string, action: string, note?: string) {
    const flag = await prisma.childSafetyFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw new Error('Flag not found.');

    const updated = await prisma.childSafetyFlag.update({
      where: { id: flagId },
      data: {
        status: action === 'approve' ? 'APPROVED' : action === 'dismiss' ? 'DISMISSED' : 'ESCALATED',
        actionTaken: action,
        actionDetail: note,
        reviewedById: adminId,
        reviewedAt: new Date(),
      },
    });

    // Take action on the user
    if (action === 'restrict') {
      await prisma.user.update({
        where: { id: flag.userId },
        data: { status: 'RESTRICTED' },
      });
    }

    await this.logComplianceAction(adminId, 'CHILD_SAFETY_FLAG_PROCESSED', 'USER', flag.userId, {
      flagId,
      action,
      note,
    });

    return updated;
  }

  // ==========================================================================
  // TRANSPARENCY CENTER
  // ==========================================================================

  async getTransparencyMetrics(period: string = 'MONTHLY') {
    return prisma.transparencyMetric.findMany({
      where: { period },
      orderBy: { periodStart: 'desc' },
      take: 12,
    });
  }

  async generateTransparencyReport() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const metrics = [
      {
        metricType: 'ENFORCEMENT_ACTIONS',
        totalCount: await prisma.report.count({ where: { status: 'ACTIONED', createdAt: { gte: monthStart, lte: monthEnd } } }),
      },
      {
        metricType: 'REPORT_VOLUME',
        totalCount: await prisma.report.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
      },
      {
        metricType: 'APPEAL_OUTCOMES',
        totalCount: await prisma.appeal.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
      },
      {
        metricType: 'CONTENT_REMOVALS',
        totalCount: await prisma.copyrightClaim.count({ where: { actionTaken: 'CONTENT_REMOVED', createdAt: { gte: monthStart, lte: monthEnd } } }),
      },
      {
        metricType: 'DATA_REQUESTS',
        totalCount: await prisma.dataExportRequest.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
      },
    ];

    for (const metric of metrics) {
      await prisma.transparencyMetric.upsert({
        where: {
          metricType_period_periodStart: {
            metricType: metric.metricType,
            period: 'MONTHLY',
            periodStart: monthStart,
          },
        },
        update: {
          totalCount: metric.totalCount,
          periodEnd: monthEnd,
          publishedAt: now,
        },
        create: {
          metricType: metric.metricType,
          period: 'MONTHLY',
          periodStart: monthStart,
          periodEnd: monthEnd,
          totalCount: metric.totalCount,
          publishedAt: now,
        },
      });
    }

    return metrics;
  }

  // ==========================================================================
  // CONNECTED DEVICES
  // ==========================================================================

  async getConnectedDevices(userId: string) {
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
    });

    // Transform sessions into device records
    return sessions.map(session => ({
      id: session.id,
      deviceName: session.userAgent?.split('/')[0] || 'Unknown Device',
      deviceType: this.detectDeviceType(session.userAgent),
      ipAddress: session.ipAddress,
      isTrusted: session.isTrusted,
      lastActiveAt: session.lastActiveAt || session.createdAt,
      createdAt: session.createdAt,
    }));
  }

  private detectDeviceType(userAgent?: string | null): string {
    if (!userAgent) return 'UNKNOWN';
    if (userAgent.includes('Mobile')) return 'MOBILE';
    if (userAgent.includes('Tablet')) return 'TABLET';
    if (userAgent.includes('Electron')) return 'DESKTOP';
    return 'WEB';
  }

  async getLoginHistory(userId: string, limit = 50) {
    return prisma.loginHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ==========================================================================
  // COMPLIANCE NOTIFICATIONS
  // ==========================================================================

  async createComplianceNotification(userId: string, type: string, data: {
    title: string;
    message: string;
    actionUrl?: string;
    metadata?: any;
  }) {
    return prisma.complianceNotification.create({
      data: {
        userId,
        type,
        title: data.title,
        message: data.message,
        actionUrl: data.actionUrl,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      },
    });
  }

  async getComplianceNotifications(userId: string, unreadOnly = false) {
    const where: any = { userId };
    if (unreadOnly) where.read = false;

    return prisma.complianceNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markNotificationRead(notificationId: string, userId: string) {
    return prisma.complianceNotification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
  }

  async markAllNotificationsRead(userId: string) {
    return prisma.complianceNotification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  // ==========================================================================
  // AUDIT LOGGING
  // ==========================================================================

  async logComplianceAction(
    userId: string | null,
    action: string,
    resourceType: string,
    resourceId: string | null,
    details?: any,
    ipAddress?: string,
    userAgent?: string,
  ) {
    return prisma.complianceAuditLog.create({
      data: {
        userId,
        action,
        resourceType,
        resourceId,
        details: details ? JSON.stringify(details) : null,
        ipAddress,
        userAgent,
        severity: 'INFO',
      },
    });
  }

  async getAuditLogs(filters?: {
    userId?: string;
    action?: string;
    resourceType?: string;
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
  }) {
    const where: any = {};
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.action) where.action = filters.action;
    if (filters?.resourceType) where.resourceType = filters.resourceType;
    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters?.startDate) where.createdAt.gte = filters.startDate;
      if (filters?.endDate) where.createdAt.lte = filters.endDate;
    }

    return prisma.complianceAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }

  // ==========================================================================
  // ADMIN COMPLIANCE DASHBOARD DATA
  // ==========================================================================

  async getComplianceDashboardStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      pendingReports,
      pendingAppeals,
      pendingExports,
      pendingCopyrightClaims,
      activeDeactivations,
      pendingChildSafetyFlags,
      totalConsentRecords,
      reportsToday,
    ] = await Promise.all([
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.appeal.count({ where: { status: 'PENDING' } }),
      prisma.dataExportRequest.count({ where: { status: 'PENDING' } }),
      prisma.copyrightClaim.count({ where: { status: 'PENDING' } }),
      prisma.accountDeactivation.count({ where: { status: { in: ['DEACTIVATED', 'SCHEDULED_FOR_DELETION'] } } }),
      prisma.childSafetyFlag.count({ where: { status: 'PENDING_REVIEW' } }),
      prisma.consentHistory.count(),
      prisma.report.count({ where: { createdAt: { gte: todayStart } } }),
    ]);

    return {
      pendingReports,
      pendingAppeals,
      pendingExports,
      pendingCopyrightClaims,
      activeDeactivations,
      pendingChildSafetyFlags,
      totalConsentRecords,
      reportsToday,
      timestamp: now.toISOString(),
    };
  }
}

export const complianceService = new ComplianceService();