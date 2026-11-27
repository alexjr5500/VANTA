import { prisma } from '../prisma';
import { auditLog } from '../security/auditLog';
import { removeModeratedContent, restoreModeratedContent } from './content-removal.service';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// COMPLIANCE SERVICE - Core business logic for privacy, legal & compliance
// ============================================================================

class ComplianceService {
  private async cleanupRemovedContent(removedFiles: Array<{ id: string; filename: string }>, source: string): Promise<boolean> {
    // Quarantine media instead of destroying it: local public URLs are blocked
    // by the UploadedFile tombstone, while Cloudinary assets are renamed to
    // authenticated delivery. Both paths can be restored after an audited reversal.
    const { uploadService } = require('./upload.service');
    const { cacheService } = require('./cache.service');
    const cleanup = await Promise.allSettled(removedFiles.map((file) => uploadService.quarantineModeratedFile(file.id)));
    let succeeded = true;
    cleanup.forEach((result, index) => {
      if (result.status === 'rejected' || result.value === false) {
        succeeded = false;
        console.error(`[Compliance] ${source} media quarantine failed:`, removedFiles[index]?.id);
      }
    });
    const cacheResults = await Promise.allSettled(['feed:*', 'homefeed:*', 'explore:*', 'trending:*', 'stories:*', 'live:*', 'search:*', 'reels:*', 'profile:*', 'user:*', 'post:*', 'video:*', 'story:*'].map((pattern) => cacheService.delPattern(pattern)));
    cacheResults.forEach((result) => {
      if (result.status === 'rejected' || result.value === false) {
        succeeded = false;
        console.error(`[Compliance] ${source} cache purge failed:`, result.status === 'rejected' ? result.reason : 'cache adapter returned false');
      }
    });
    return succeeded;
  }

  // ==========================================================================
  // PRIVACY CENTER
  // ==========================================================================

  private readonly privacyVisibilityKeys = ['onlineStatus', 'lastSeen', 'readReceipts', 'storyVisibility', 'liveStreamVisibility', 'communityInvites', 'groupInvites', 'messagePermissions', 'callPermissions', 'tagPermissions', 'mentionPermissions'] as const;
  private readonly privacyBooleanKeys = ['profileSearchVisibility', 'searchVisibility', 'discoverability', 'aiPersonalization', 'adPersonalization', 'cookieAnalytics', 'cookieMarketing', 'cookieFunctional'] as const;

  async getPrivacySettings(userId: string) {
    const settings = await prisma.userSettings.upsert({ where: { userId }, create: { userId }, update: {} });
    // Preserve the existing boolean readReceipts flag used by chat consumers.
    return { ...settings, readReceipts: settings.privacyReadReceipts, cookieFunctional: true };
  }

  async updatePrivacySettings(userId: string, data: Record<string, unknown>) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Privacy settings must be an object.');
    const updates: Record<string, unknown> = {};
    if (data.accountType !== undefined) {
      if (typeof data.accountType !== 'string' || !['PUBLIC', 'PRIVATE', 'CREATOR'].includes(data.accountType)) throw new Error('Account type must be PUBLIC, PRIVATE, or CREATOR.');
      updates.accountType = data.accountType;
      // Keep the established profile-visibility enforcement in sync with the
      // newer Privacy Center account-type control.
      updates.privacyProfile = data.accountType === 'PRIVATE' ? 'private' : 'public';
    }
    for (const key of this.privacyVisibilityKeys) {
      const value = data[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !['everyone', 'followers', 'nobody'].includes(value)) throw new Error(`Invalid privacy value for ${key}.`);
      updates[key === 'readReceipts' ? 'privacyReadReceipts' : key] = value;
      if (key === 'readReceipts') updates.readReceipts = value !== 'nobody';
      // Chat creation still enforces the legacy privacyMessages field. Map
      // the new Privacy Center values to that established contract.
      if (key === 'messagePermissions') {
        updates.privacyMessages = value === 'nobody' ? 'noone' : value === 'followers' ? 'followers' : 'everyone';
      }
      if (key === 'callPermissions') {
        updates.privacyCalls = value === 'nobody' ? 'noone' : value === 'followers' ? 'following' : 'everyone';
      }
      if (key === 'storyVisibility') {
        updates.privacyStories = value === 'nobody' ? 'noone' : value === 'followers' ? 'following' : 'everyone';
      }
      if (key === 'liveStreamVisibility') {
        updates.privacyLiveStream = value === 'nobody' ? 'noone' : value === 'followers' ? 'following' : 'everyone';
      }
      if (key === 'tagPermissions') {
        updates.privacyTagging = value === 'nobody' ? 'noone' : value === 'followers' ? 'following' : 'everyone';
      }
      if (key === 'groupInvites') {
        updates.privacyInvites = value === 'nobody' ? 'noone' : value === 'followers' ? 'following' : 'everyone';
      }
    }
    for (const key of this.privacyBooleanKeys) {
      const value = data[key];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') throw new Error(`Invalid boolean privacy value for ${key}.`);
      if (key === 'cookieFunctional' && value === false) throw new Error('Functional cookies are required for essential platform operation.');
      updates[key] = key === 'cookieFunctional' ? true : value;
    }
    if (Object.keys(updates).length === 0) return this.getPrivacySettings(userId);
    const settings = await prisma.userSettings.upsert({ where: { userId }, create: { userId, ...updates }, update: updates });
    await this.logComplianceAction(userId, 'PRIVACY_SETTINGS_UPDATE', 'SETTINGS', userId, updates);
    return { ...settings, readReceipts: settings.privacyReadReceipts, cookieFunctional: true };
  }

    // CONSENT MANAGEMENT
  // ==========================================================================

  private readonly consentPreferenceKeys = [
    'analytics',
    'personalization',
    'marketing',
    'aiFeatures',
    'notifications',
    'cookies',
  ] as const;

  async getConsentPreferences(userId: string) {
    const keys = [...this.consentPreferenceKeys];
    const records = await prisma.consentRecord.findMany({
      where: { userId, type: { in: [...keys, ...keys.map((key) => `${key}:NOT_SET`)] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const preferences: Record<string, string> = Object.fromEntries(keys.map((key) => [key, 'not_set']));
    const resolved = new Set<string>();
    for (const record of records) {
      const isNotSet = record.type.endsWith(':NOT_SET');
      const key = isNotSet ? record.type.slice(0, -':NOT_SET'.length) : record.type;
      if (!keys.includes(key as typeof keys[number]) || resolved.has(key)) continue;
      preferences[key] = isNotSet ? 'not_set' : record.granted ? 'granted' : 'denied';
      resolved.add(key);
    }
    return preferences;
  }

  async updateConsentPreferences(
    userId: string,
    data: Record<string, unknown>,
    source = 'privacy_center',
    ipAddress?: string,
    userAgent?: string,
  ) {
    const allowedValues = new Set(['granted', 'denied', 'not_set']);
    const updates = this.consentPreferenceKeys.flatMap((key) => {
      const value = data[key];
      if (value === undefined) return [];
      if (typeof value !== 'string' || !allowedValues.has(value)) {
        throw new Error(`Invalid consent value for ${key}.`);
      }
      return [{ key, value }];
    });

    if (updates.length === 0) return this.getConsentPreferences(userId);

    // ConsentRecord is append-only. A NOT_SET marker preserves audit history
    // without conflating an explicit denial with an unset preference.
    for (const update of updates) {
      await prisma.consentRecord.create({
        data: {
          userId,
          type: update.value === 'not_set' ? `${update.key}:NOT_SET` : update.key,
          granted: update.value === 'granted',
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        },
      });
    }

    await this.logComplianceAction(userId, 'CONSENT_UPDATE', 'CONSENT', userId, {
      source,
      changedPreferences: updates.map(({ key, value }) => ({ key, value })),
    }, ipAddress, userAgent);
    return this.getConsentPreferences(userId);
  }

  async getConsentHistory(userId: string, limit = 50) {
    const keys = [...this.consentPreferenceKeys];
    const records = await prisma.consentRecord.findMany({
      where: { userId, type: { in: [...keys, ...keys.map((key) => `${key}:NOT_SET`)] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
    });

    return records.map((record) => {
      const isNotSet = record.type.endsWith(':NOT_SET');
      const type = isNotSet ? record.type.slice(0, -':NOT_SET'.length) : record.type;
      const value = isNotSet ? 'not_set' : record.granted ? 'granted' : 'denied';
      return { ...record, type, action: value, newValue: value, source: 'privacy_center' };
    });
  }

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

  private readonly exportPageSize = 250;

  /** Cursor-paginate one dataset so no query loads an entire account history. */
  private async *iterateExportRows(
    delegateName: string,
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
    select?: Record<string, unknown>,
  ): AsyncGenerator<any> {
    const delegate = (prisma as any)[delegateName];
    if (!delegate || typeof delegate.findMany !== 'function') {
      throw new Error(`Data export source "${delegateName}" is unavailable.`);
    }
    let cursor: string | undefined;
    while (true) {
      const rows = await delegate.findMany({
        where, orderBy: { id: 'asc' }, take: this.exportPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        ...(include ? { include } : {}), ...(select ? { select } : {}),
      });
      if (!Array.isArray(rows)) throw new Error(`Data export source "${delegateName}" returned an invalid page.`);
      for (const row of rows) yield row;
      if (rows.length < this.exportPageSize) break;
      const nextCursor = rows[rows.length - 1]?.id;
      if (typeof nextCursor !== 'string' || nextCursor === cursor) {
        throw new Error(`Data export source "${delegateName}" did not return a stable cursor.`);
      }
      cursor = nextCursor;
    }
  }

  /** Emit a valid JSON array with back-pressure; only one database page is held at a time. */
  private createExportJsonStream(dataset: {
    delegate: string; where: Record<string, unknown>;
    include?: Record<string, unknown>; select?: Record<string, unknown>;
  }): any {
    const { Readable } = require('stream');
    const service = this;
    return Readable.from((async function* () {
      yield '[\n';
      let first = true;
      for await (const row of service.iterateExportRows(dataset.delegate, dataset.where, dataset.include, dataset.select)) {
        yield `${first ? '' : ',\n'}${JSON.stringify(row)}`;
        first = false;
      }
      yield '\n]\n';
    })());
  }

  private async processDataExport(userId: string, requestId: string) {
    let filePath: string | undefined;
    try {
      await prisma.dataExportRequest.update({ where: { id: requestId }, data: { status: 'PROCESSING' } });

      // Only fetch small one-to-one records here. High-cardinality relations
      // are cursor-paginated and streamed independently into the ZIP.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, username: true, email: true, phone: true, fullName: true,
          bio: true, gender: true, age: true, dateOfBirth: true, interestedIn: true,
          avatar: true, country: true, city: true, verified: true, premium: true,
          role: true, status: true, lastLoginAt: true, coins: true, earnings: true,
          createdAt: true, profile: true,
          wallet: { select: {
            id: true, coinBalance: true, earningsBalance: true, lifetimeEarnings: true,
            totalCoinsPurchased: true, totalCoinsReceived: true, totalCoinsSent: true,
            totalGiftsSent: true, totalGiftsReceived: true, totalWithdrawn: true,
            bonusCoins: true, lockedCoins: true, isFrozen: true, frozenAt: true,
            freezeReason: true, usdtWalletAddress: true, createdAt: true, updatedAt: true,
          } },
          userSettings: true, notificationPrefs: true,
        },
      });
      if (!user) throw new Error('User not found');

      const exportData = {
        exportedAt: new Date().toISOString(), platform: 'VANTA',
        account: {
          id: user.id, username: user.username, email: user.email, phone: user.phone,
          fullName: user.fullName, bio: user.bio, gender: user.gender, age: user.age,
          dateOfBirth: user.dateOfBirth, interestedIn: user.interestedIn, avatar: user.avatar,
          country: user.country, city: user.city, verified: user.verified, premium: user.premium,
          role: user.role, status: user.status, lastLoginAt: user.lastLoginAt,
          coins: user.coins, earnings: user.earnings, createdAt: user.createdAt,
        },
        profile: user.profile, wallet: user.wallet,
        settings: { userSettings: user.userSettings, notificationPrefs: user.notificationPrefs },
      };

      const datasets = [
        { file: 'photos.json', delegate: 'photo', where: { userId } },
        { file: 'posts.json', delegate: 'post', where: { authorId: userId } },
        { file: 'videos.json', delegate: 'video', where: { creatorId: userId } },
        { file: 'stories.json', delegate: 'story', where: { userId } },
        { file: 'messages.json', delegate: 'message', where: { senderId: userId } },
        { file: 'followers.json', delegate: 'follow', where: { followingId: userId } },
        { file: 'following.json', delegate: 'follow', where: { followerId: userId } },
        { file: 'post_likes.json', delegate: 'postLike', where: { OR: [{ userId }, { post: { authorId: userId } }] } },
        { file: 'post_comments.json', delegate: 'postComment', where: { OR: [{ userId }, { post: { authorId: userId } }] } },
        { file: 'post_comment_likes.json', delegate: 'postCommentLike', where: { OR: [{ userId }, { comment: { post: { authorId: userId } } }] } },
        { file: 'post_saves.json', delegate: 'postSave', where: { OR: [{ userId }, { post: { authorId: userId } }] } },
        { file: 'video_likes.json', delegate: 'videoLike', where: { OR: [{ userId }, { video: { creatorId: userId } }] } },
        { file: 'video_comments.json', delegate: 'videoComment', where: { OR: [{ userId }, { video: { creatorId: userId } }] } },
        { file: 'video_comment_likes.json', delegate: 'videoCommentLike', where: { OR: [{ userId }, { comment: { video: { creatorId: userId } } }] } },
        { file: 'video_saves.json', delegate: 'videoSave', where: { OR: [{ userId }, { video: { creatorId: userId } }] } },
        { file: 'watch_history.json', delegate: 'watchHistory', where: { userId } },
        { file: 'content_views.json', delegate: 'contentView', where: { userId } },
        { file: 'story_views.json', delegate: 'storyView', where: { OR: [{ userId }, { story: { userId } }] } },
        { file: 'story_likes.json', delegate: 'storyLike', where: { OR: [{ userId }, { story: { userId } }] } },
        { file: 'story_comments.json', delegate: 'storyComment', where: { OR: [{ userId }, { story: { userId } }] } },
        { file: 'message_reads.json', delegate: 'messageRead', where: { userId } },
        { file: 'message_reactions.json', delegate: 'messageReaction', where: { userId } },
        { file: 'group_messages.json', delegate: 'groupMessage', where: { authorId: userId } },
        { file: 'channel_messages.json', delegate: 'channelMessage', where: { authorId: userId } },
        { file: 'community_posts.json', delegate: 'communityPost', where: { authorId: userId } },
        { file: 'notifications.json', delegate: 'notification', where: { userId } },
        { file: 'interests.json', delegate: 'userInterest', where: { userId } },
        { file: 'interaction_events.json', delegate: 'interactionEvent', where: { userId } },
        { file: 'transactions.json', delegate: 'walletTransaction', where: { userId } },
        { file: 'gifts_sent.json', delegate: 'giftTransaction', where: { senderId: userId } },
        { file: 'gifts_received.json', delegate: 'giftTransaction', where: { receiverId: userId } },
        { file: 'communities.json', delegate: 'communityMember', where: { userId }, include: { community: true } },
        { file: 'channels.json', delegate: 'channelMember', where: { userId }, include: { channel: true } },
        { file: 'groups.json', delegate: 'groupMember', where: { userId }, include: { group: true } },
        { file: 'live_streams.json', delegate: 'liveStream', where: { hostId: userId }, select: {
          id: true, title: true, description: true, thumbnailUrl: true, playbackUrl: true,
          viewerCount: true, peakViewers: true, totalViewers: true, likes: true, gifts: true,
          allowGifts: true, allowPK: true, allowGuests: true, active: true, status: true,
          scheduledAt: true, categoryName: true, language: true, country: true,
          recordingEnabled: true, recordingUrl: true, duration: true, startedAt: true,
          endedAt: true, chatPaused: true, slowMode: true, slowModeInterval: true,
          createdAt: true, updatedAt: true,
        } },
        { file: 'live_chat_messages.json', delegate: 'liveChatMessage', where: { userId } },
        { file: 'live_reactions.json', delegate: 'liveReaction', where: { userId } },
        { file: 'stream_viewers.json', delegate: 'streamViewer', where: { userId } },
        { file: 'stream_follows.json', delegate: 'streamFollower', where: { followerId: userId } },
        { file: 'streamer_followers.json', delegate: 'streamFollower', where: { streamerId: userId } },
        { file: 'saved_properties.json', delegate: 'savedProperty', where: { userId } },
        { file: 'home_listings.json', delegate: 'propertyListing', where: { ownerId: userId } },
        { file: 'property_enquiries_sent.json', delegate: 'propertyEnquiry', where: { enquirerId: userId } },
        { file: 'property_enquiries_received.json', delegate: 'propertyEnquiry', where: { ownerId: userId } },
        { file: 'sessions.json', delegate: 'session', where: { userId }, select: {
          id: true, deviceFingerprint: true, isTrusted: true, expiresAt: true,
          refreshExpiresAt: true, userAgent: true, ipAddress: true, lastActiveAt: true, createdAt: true,
        } },
        { file: 'consent_records.json', delegate: 'consentRecord', where: { userId } },
      ];

      const exportDir = path.resolve(__dirname, '../../exports');
      if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
      filePath = path.join(exportDir, `vanta-export-${userId}-${Date.now()}.zip`);
      await this.createExportArchive(filePath, exportData, user, datasets);

      await prisma.dataExportRequest.update({
        where: { id: requestId },
        data: { status: 'COMPLETED', filePath, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });
      await this.createComplianceNotification(userId, 'DATA_EXPORT_READY', {
        title: 'Your data export is ready',
        message: 'Your requested data export has been generated and is available for download. The file will be available for 7 days.',
        actionUrl: '/privacy-center?tab=export',
      });
      await this.logComplianceAction(userId, 'DATA_EXPORT_COMPLETED', 'USER', userId, { requestId });
    } catch (error: any) {
      if (filePath) await fs.promises.unlink(filePath).catch(() => undefined);
      await prisma.dataExportRequest.update({ where: { id: requestId }, data: { status: 'FAILED' } });
      await this.createComplianceNotification(userId, 'DATA_EXPORT_FAILED', {
        title: 'Data export failed',
        message: 'Your data export request could not be processed. Please try again or contact support.',
        actionUrl: '/privacy-center?tab=export',
      });
      await this.logComplianceAction(userId, 'DATA_EXPORT_FAILED', 'USER', userId, {
        requestId, error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async createExportArchive(
    filePath: string, exportData: any, user: any,
    datasets: Array<{ file: string; delegate: string; where: Record<string, unknown>; include?: Record<string, unknown>; select?: Record<string, unknown> }>,
  ): Promise<void> {
    const archiver = require('archiver');
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        archive.destroy();
        output.destroy();
        reject(error);
      };
      output.on('error', fail);
      archive.on('error', fail);
      archive.on('warning', fail);
      output.on('close', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      archive.pipe(output);
      archive.append(JSON.stringify({ platform: exportData.platform, exportedAt: exportData.exportedAt }, null, 2), { name: 'export_metadata.json' });
      archive.append(JSON.stringify(exportData.account, null, 2), { name: 'account.json' });
      archive.append(JSON.stringify(exportData.profile, null, 2), { name: 'profile.json' });
      archive.append(JSON.stringify(exportData.wallet, null, 2), { name: 'wallet.json' });
      archive.append(JSON.stringify(exportData.settings, null, 2), { name: 'settings.json' });
      for (const dataset of datasets) archive.append(this.createExportJsonStream(dataset), { name: dataset.file });
      const readme = `VANTA Data Export
=======================
Exported on: ${exportData.exportedAt}
Account: ${user.username} (${user.id})

This archive contains your data from VANTA in JSON format.
Each dataset is streamed in bounded pages to avoid loading your full account history into memory.

For questions about your data, contact privacy@vanta.app
`;
      archive.append(readme, { name: 'README.txt' });
      archive.finalize().catch(fail);
    });
  }

  async getDataExports(userId: string) {
    return prisma.dataExportRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      // Never expose the server's absolute export path or internal ownership
      // fields through the public privacy-center listing endpoint.
      select: { id: true, status: true, createdAt: true, expiresAt: true },
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
    if (existing?.status === 'DEACTIVATED') throw new Error('Account is already deactivated.');
    if (existing?.status === 'SCHEDULED_FOR_DELETION') throw new Error('Account is already scheduled for deletion.');
    const now = new Date(); const recoveryPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); const recoveryToken = uuidv4();
    const deactivation = await prisma.$transaction(async (tx) => {
      const record = await tx.accountDeactivation.upsert({ where: { userId }, update: { deactivationType: 'TEMPORARY', reason, reasonDetail, status: 'DEACTIVATED', deactivatedAt: now, scheduledFor: null, recoveryPeriodEnd, recoveryToken, recoveredAt: null }, create: { userId, deactivationType: 'TEMPORARY', reason, reasonDetail, status: 'DEACTIVATED', deactivatedAt: now, recoveryPeriodEnd, recoveryToken } });
      await tx.user.update({ where: { id: userId }, data: { status: 'DEACTIVATED' } }); return record;
    });
    await this.logComplianceAction(userId, 'ACCOUNT_DEACTIVATED', 'USER', userId, { deactivationId: deactivation.id, reason }); return deactivation;
  }

  async scheduleAccountDeletion(userId: string, reason?: string, scheduledDate?: Date) {
    const deleteDate = scheduledDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (deleteDate <= new Date()) throw new Error('The scheduled deletion date must be in the future.');
    const existing = await prisma.accountDeactivation.findUnique({ where: { userId } });
    if (existing?.status === 'DELETED') throw new Error('Account has already been deleted.');
    if (existing?.status === 'SCHEDULED_FOR_DELETION') throw new Error('Account is already scheduled for deletion.');
    const now = new Date(); const recoveryToken = existing?.recoveryToken || uuidv4();
    const deactivation = await prisma.$transaction(async (tx) => {
      const record = await tx.accountDeactivation.upsert({ where: { userId }, update: { deactivationType: 'SCHEDULED', reason, status: 'SCHEDULED_FOR_DELETION', deactivatedAt: existing?.deactivatedAt || now, scheduledFor: deleteDate, recoveryPeriodEnd: deleteDate, recoveryToken, recoveredAt: null }, create: { userId, deactivationType: 'SCHEDULED', reason, status: 'SCHEDULED_FOR_DELETION', deactivatedAt: now, scheduledFor: deleteDate, recoveryPeriodEnd: deleteDate, recoveryToken } });
      await tx.user.update({ where: { id: userId }, data: { status: 'SCHEDULED_FOR_DELETION' } }); return record;
    });
    await this.logComplianceAction(userId, 'ACCOUNT_DELETION_SCHEDULED', 'USER', userId, { deactivationId: deactivation.id, scheduledFor: deleteDate, reason }); return deactivation;
  }

  async cancelDeletion(userId: string) {
    const deactivation = await prisma.accountDeactivation.findUnique({ where: { userId } });
    if (!deactivation) throw new Error('No deletion request found.');
    if (deactivation.status === 'DELETED') throw new Error('Account has already been deleted.');
    if (!['DEACTIVATED', 'SCHEDULED_FOR_DELETION'].includes(deactivation.status)) {
      throw new Error('There is no recoverable account action to cancel.');
    }
    if (deactivation.recoveryPeriodEnd && deactivation.recoveryPeriodEnd <= new Date()) {
      throw new Error('The account recovery period has expired.');
    }
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.accountDeactivation.update({ where: { userId }, data: { status: 'RECOVERED', recoveredAt: new Date(), scheduledFor: null, recoveryPeriodEnd: null, recoveryToken: null } });
      await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
      await tx.accountDeletionRequest.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'CANCELLED', processedAt: new Date() } });
      return record;
    });
    await this.logComplianceAction(userId, 'ACCOUNT_DELETION_CANCELLED', 'USER', userId, { deactivationId: deactivation.id }); return updated;
  }

  async recoverAccount(userId: string, recoveryToken: string) {
    if (!recoveryToken?.trim()) throw new Error('Recovery token is required.');
    const deactivation = await prisma.accountDeactivation.findUnique({ where: { userId } });
    if (!deactivation) throw new Error('No deactivation record found.');
    if (deactivation.status === 'DELETED') throw new Error('Account has already been deleted.');
    if (!['DEACTIVATED', 'SCHEDULED_FOR_DELETION'].includes(deactivation.status)) throw new Error('There is no recoverable account action.');
    if (deactivation.recoveryToken !== recoveryToken) throw new Error('Invalid recovery token.');
    if (deactivation.recoveryPeriodEnd && deactivation.recoveryPeriodEnd <= new Date()) throw new Error('Recovery period has expired. Account has been permanently deleted.');
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.accountDeactivation.update({ where: { userId }, data: { status: 'RECOVERED', recoveredAt: new Date(), scheduledFor: null, recoveryPeriodEnd: null, recoveryToken: null } });
      await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
      await tx.accountDeletionRequest.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'CANCELLED', processedAt: new Date() } });
      return record;
    });
    await this.logComplianceAction(userId, 'ACCOUNT_RECOVERED', 'USER', userId, { deactivationId: deactivation.id }); return updated;
  }

  async getDeactivationStatus(userId: string) { return prisma.accountDeactivation.findUnique({ where: { userId } }); }

  async permanentlyDeleteExpiredAccounts() {
    const now = new Date();
    const [scheduled, unrecovered] = await Promise.all([
      prisma.accountDeactivation.findMany({ where: { status: 'SCHEDULED_FOR_DELETION', scheduledFor: { lte: now } } }),
      prisma.accountDeactivation.findMany({ where: { status: 'DEACTIVATED', recoveryPeriodEnd: { lte: now } } }),
    ]);
    const [scheduledResults, unrecoveredResults] = await Promise.all([
      Promise.all(scheduled.map((record) => this.permanentlyDeleteUser(record.userId))),
      Promise.all(unrecovered.map((record) => this.permanentlyDeleteUser(record.userId))),
    ]);
    return {
      deleted: scheduledResults.filter(Boolean).length,
      unrecovered: unrecoveredResults.filter(Boolean).length,
      failed: [...scheduledResults, ...unrecoveredResults].filter((result) => !result).length,
    };
  }

  private async permanentlyDeleteUser(userId: string): Promise<boolean> {
    try {
      const deleted = await prisma.$transaction(async (tx) => {
        const record = await tx.accountDeactivation.findUnique({ where: { userId } });
        if (!record || record.status === 'DELETED') return false;
        const now = new Date();
        const scheduledExpired = record.status === 'SCHEDULED_FOR_DELETION' && !!record.scheduledFor && record.scheduledFor <= now;
        const deactivationExpired = record.status === 'DEACTIVATED' && !!record.recoveryPeriodEnd && record.recoveryPeriodEnd <= now;
        if (!scheduledExpired && !deactivationExpired) return false;
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user) {
          // Retain financial/audit records, but remove account credentials and non-essential social content atomically.
          await tx.user.update({
            where: { id: userId },
            data: {
              email: `deleted-${userId}@vanta.app`,
              phone: null, phoneNumber: null, passwordHash: null,
              fullName: 'Deleted Account', username: `deleted_${userId}`,
              bio: null, avatar: null, status: 'DELETED',
              gender: null, interestedIn: null, age: null, dateOfBirth: null,
              country: null, city: null, verified: false, emailVerified: false,
              googleId: null, appleId: null, twoFactorEnabled: false,
              twoFactorSecret: null, twoFactorLastUsedStep: null,
              backupCodes: null, rememberMeToken: null,
            },
          });
          // Remove authentication material, device identifiers and private
          // personalization data. The anonymized User row remains as the
          // stable owner of retained financial and compliance records.
          await tx.session.deleteMany({ where: { userId } });
          await tx.trustedDevice.deleteMany({ where: { userId } });
          await tx.providerAccount.deleteMany({ where: { userId } });
          await tx.twoFactorLoginChallenge.deleteMany({ where: { userId } });
          await tx.passwordResetToken.deleteMany({ where: { userId } });
          await tx.transferOtpChallenge.deleteMany({ where: { userId } });
          await tx.pushDevice.deleteMany({ where: { userId } });
          await tx.pushDelivery.deleteMany({ where: { userId } });
          await tx.uploadSession.deleteMany({ where: { userId } });
          await tx.userPresence.deleteMany({ where: { userId } });
          await tx.notificationPreferences.deleteMany({ where: { userId } });
          await tx.userSettings.deleteMany({ where: { userId } });
          await tx.notification.deleteMany({ where: { userId } });
          await tx.userEmbedding.deleteMany({ where: { userId } });
          await tx.userInterest.deleteMany({ where: { userId } });
          await tx.interactionEvent.deleteMany({ where: { userId } });
          await tx.aIContent.deleteMany({ where: { userId } });
          await tx.aIAnalytics.deleteMany({ where: { userId } });
          await tx.aISession.deleteMany({ where: { userId } });
          await tx.profile.deleteMany({ where: { userId } });
          await tx.photo.deleteMany({ where: { userId } });
          await tx.verificationRequest.deleteMany({ where: { userId } });
          await tx.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } });
          await tx.postLike.deleteMany({ where: { userId } });
          await tx.postComment.deleteMany({ where: { userId } });
          await tx.postCommentLike.deleteMany({ where: { userId } });
          await tx.postSave.deleteMany({ where: { userId } });
          await tx.videoLike.deleteMany({ where: { userId } });
          await tx.videoComment.deleteMany({ where: { userId } });
          await tx.videoCommentLike.deleteMany({ where: { userId } });
          await tx.videoSave.deleteMany({ where: { userId } });
          await tx.watchHistory.deleteMany({ where: { userId } });
          await tx.contentView.deleteMany({ where: { userId } });
          await tx.storyView.deleteMany({ where: { userId } });
          await tx.storyLike.deleteMany({ where: { userId } });
          await tx.storyComment.deleteMany({ where: { userId } });
          await tx.participant.deleteMany({ where: { userId } });
          await tx.communityMember.deleteMany({ where: { userId } });
          await tx.channelMember.deleteMany({ where: { userId } });
          await tx.groupMember.deleteMany({ where: { userId } });
          await tx.messageRead.deleteMany({ where: { userId } });
          await tx.messageReaction.deleteMany({ where: { userId } });
          await tx.streamViewer.deleteMany({ where: { userId } });
          await tx.liveReaction.deleteMany({ where: { userId } });
          await tx.streamFollower.deleteMany({ where: { OR: [{ streamerId: userId }, { followerId: userId }] } });
          await tx.blockedUser.deleteMany({ where: { OR: [{ userId }, { targetId: userId }] } });
          await tx.mutedUser.deleteMany({ where: { OR: [{ userId }, { targetId: userId }] } });

          await tx.propertyVerification.deleteMany({ where: { userId } });

          // Remove authored social content while retaining the groups,
          // channels and communities themselves for their other members.
          await tx.post.deleteMany({ where: { authorId: userId } });
          await tx.video.deleteMany({ where: { creatorId: userId } });
          await tx.story.deleteMany({ where: { userId } });
          await tx.message.deleteMany({ where: { senderId: userId } });
          await tx.communityPost.deleteMany({ where: { authorId: userId } });
          await tx.channelMessage.deleteMany({ where: { authorId: userId } });
          await tx.groupMessage.deleteMany({ where: { authorId: userId } });
          await tx.liveChatMessage.deleteMany({ where: { userId } });
          await tx.liveStream.updateMany({
            where: { hostId: userId, active: true },
            data: { active: false, status: 'ENDED', streamKey: null, liveKitToken: null, playbackUrl: null, endedAt: now },
          });
          await tx.liveStream.updateMany({
            where: { coHostId: userId },
            data: { coHostId: null },
          });
          await tx.liveStream.updateMany({
            where: { hostId: userId },
            data: { thumbnailUrl: null, recordingUrl: null },
          });
          await tx.community.updateMany({
            where: { ownerId: userId },
            data: { avatar: null, bannerUrl: null },
          });
          await tx.channel.updateMany({
            where: { ownerId: userId },
            data: { avatar: null },
          });
          await tx.group.updateMany({
            where: { ownerId: userId },
            data: { avatar: null },
          });

          // Stop recurring services without deleting payment/subscription
          // history. Keep wallet and ledger rows for financial reconciliation,
          // but remove reusable wallet authentication and payout destination.
          await tx.creatorSubscription.updateMany({
            where: { OR: [{ subscriberId: userId }, { creatorId: userId }], status: 'ACTIVE' },
            data: { status: 'CANCELLED', autoRenew: false, cancelledAt: now },
          });
          await tx.premiumMembership.updateMany({
            where: { userId, status: 'ACTIVE' },
            data: { status: 'CANCELLED', autoRenew: false },
          });
          await tx.creatorMembership.updateMany({
            where: { userId, status: 'ACTIVE' },
            data: { status: 'CANCELLED', autoRenew: false, cancelledAt: now },
          });
          await tx.walletPIN.deleteMany({ where: { wallet: { userId } } });
          await tx.wallet.updateMany({ where: { userId }, data: { usdtWalletAddress: null } });

          // A listing must stop being discoverable and must no longer expose
          // direct contact details after its owner requests account deletion.
          await tx.propertyListing.updateMany({
            where: { ownerId: userId },
            data: {
              availabilityStatus: 'ARCHIVED',
              contactWhatsApp: null,
              contactWhatsAppPublished: false,
              contactPhone: null,
              contactPhonePublished: false,
              streetAddress: null,
            },
          });
        }
        await tx.accountDeactivation.update({ where: { userId }, data: { status: 'DELETED', permanentlyDeletedAt: now, recoveryToken: null } });
        await tx.accountDeletionRequest.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'PROCESSED', processedAt: now } });
        return true;
      });
      if (deleted) {
        // UploadedFile is intentionally not FK-cascaded from User. Remove the
        // actual private/public media after the database transaction commits;
        // cleanup failures are logged and do not undo the completed deletion.
        try {
          // Only delete categories that are known disposable profile/content
          // media. Unknown, generic, property, message and verification uploads
          // may contain evidence or records subject to a separate retention
          // policy, so preserve them until their retention rules are explicit.
          const disposableMediaCategories = [
            'avatar', 'banner', 'profile-media', 'thumbnail',
            'group-avatar', 'channel-avatar', 'community-avatar',
            'community-banner', 'reel', 'post-media', 'story',
          ];
          const files = await prisma.uploadedFile.findMany({
            where: { userId, deletedAt: null, category: { in: disposableMediaCategories } },
            select: { id: true, filename: true },
          });
          const { uploadService } = require('./upload.service');
          for (const file of files) {
            try {
              await uploadService.deleteFile(file.filename, file.id);
            } catch (cleanupError) {
              console.error('[Compliance] Uploaded media cleanup failed:', file.id, cleanupError);
            }
          }
        } catch (cleanupError) {
          console.error('[Compliance] Could not enumerate uploaded media for cleanup:', cleanupError);
        }
        await this.logComplianceAction(userId, 'ACCOUNT_PERMANENTLY_DELETED', 'USER', userId, {});
      }
      return deleted;
    } catch (error) {
      console.error(`[Compliance] Error permanently deleting user ${userId}:`, error);
      return false;
    }
  }

  
  // ==========================================================================
  // REPORTING SYSTEM
  // ==========================================================================

  async createReport(reporterId: string, targetType: string, targetId: string, category: string, description?: string, targetUserId?: string, evidenceUrls?: string[]) {
    if (!targetType?.trim() || !targetId?.trim() || !category?.trim()) throw new Error('Report target and category are required.');
    const recentReport = await prisma.moderationQueue.findFirst({
      where: { reportedBy: reporterId, targetType, targetId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    if (recentReport) throw new Error('You have already reported this content. Please allow time for review.');
    const report = await prisma.moderationQueue.create({
      data: { reportedBy: reporterId, targetType, targetId, targetUserId: targetUserId || null, category, description: description || null, evidenceUrls: evidenceUrls?.length ? JSON.stringify(evidenceUrls) : null, reason: category, priority: this.calculateReportPriority(category), status: 'PENDING' },
    });
    await this.logComplianceAction(reporterId, 'REPORT_CREATED', 'REPORT', report.id, { targetType, targetId, category });
    return report;
  }

  private calculateReportPriority(category: string): number {
    const normalized = category.toLowerCase();
    if (['illegal_content', 'child_safety', 'violence', 'self_harm'].includes(normalized)) return 100;
    if (['harassment', 'hate_speech', 'impersonation'].includes(normalized)) return 50;
    return 10;
  }

  async getReports(userId: string, role: string, limit = 50, offset = 0) {
    const where: any = {};
    if (role === 'USER' || role === 'MODERATOR') where.reportedBy = userId;
    const items = await prisma.moderationQueue.findMany({
      where, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: Math.min(Math.max(limit, 1), 200), skip: Math.max(offset, 0),
      include: { actions: { orderBy: { createdAt: 'desc' }, take: 1 }, removal: true },
    });
    const reporterIds = [...new Set(items.map((item: any) => item.reportedBy).filter(Boolean))];
    const reporters = reporterIds.length ? await prisma.user.findMany({ where: { id: { in: reporterIds } }, select: { id: true, username: true, avatar: true } }) : [];
    const reporterById = new Map(reporters.map((reporter: any) => [reporter.id, reporter]));
    return items.map((item: any) => {
      const lastAction = item.actions?.[0]?.action;
      const status = item.status === 'REMOVED' ? 'REMOVED' : item.status === 'APPROVED' ? (lastAction === 'dismiss' ? 'DISMISSED' : 'ACTIONED') : item.status;
      return { ...item, status, category: item.category || item.reason || 'other', description: item.description || item.reason || null, priority: item.priority >= 100 ? 'URGENT' : item.priority >= 50 ? 'HIGH' : 'NORMAL', reporter: item.reportedBy ? reporterById.get(item.reportedBy) || null : null };
    });
  }

  async processReport(reportId: string, adminId: string, action: string, note?: string) {
    if (!['dismiss', 'warn', 'suspend', 'ban', 'remove'].includes(action)) throw new Error('Unsupported report action.');
    let removedFiles: Array<{ id: string; filename: string }> = [];
    const updated = await prisma.$transaction(async (tx) => {
      const report = await tx.moderationQueue.findUnique({ where: { id: reportId } });
      if (!report) throw new Error('Report not found.');
      if (report.status !== 'PENDING') throw new Error('Report has already been resolved.');
      if (action === 'remove') {
        if (!report.targetType || !report.targetId) throw new Error('Report has no supported content target.');
        removedFiles = await removeModeratedContent(tx, report.targetType, report.targetId);
        await tx.moderationRemoval.create({
          data: {
            queueId: reportId,
            sourceType: 'REPORT',
            sourceId: reportId,
            targetType: report.targetType,
            targetId: report.targetId,
            moderatorId: adminId,
            reason: note || null,
            mediaQuarantineStatus: 'PENDING',
          },
        });
      }
      const targetUserId = report.targetUserId || (report.targetType?.toUpperCase() === 'USER' ? report.targetId : null);
      if (['warn', 'suspend', 'ban'].includes(action) && !targetUserId) {
        throw new Error('This report has no target user for the requested account action.');
      }
      if (targetUserId && ['warn', 'suspend', 'ban'].includes(action)) {
        if (action === 'suspend' || action === 'ban') {
          await tx.user.update({
            where: { id: targetUserId },
            data: action === 'ban'
              ? { status: 'BANNED', bannedAt: new Date(), bannedReason: note || 'Moderation action', suspendedAt: null, suspendedReason: null, suspendedUntil: null }
              : { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: note || 'Moderation action', suspendedUntil: null },
          });
        }
        await tx.notification.create({
          data: {
            userId: targetUserId, actorId: adminId,
            type: action === 'warn' ? 'MODERATION_WARNING' : action === 'ban' ? 'ACCOUNT_BANNED' : 'ACCOUNT_SUSPENDED',
            title: action === 'warn' ? 'VANTA policy warning' : action === 'ban' ? 'Account banned' : 'Account suspended',
            message: note || (action === 'warn' ? 'Your account received a policy warning.' : action === 'ban' ? 'Your account has been banned following a moderation review.' : 'Your account has been suspended following a moderation review.'),
            entityType: 'COMPLIANCE', entityId: reportId,
            data: JSON.stringify({ action, targetType: report.targetType, targetId: report.targetId }),
          },
        });
      }
      const status = action === 'remove' ? 'REMOVED' : 'APPROVED';
      const resolution = await tx.moderationQueue.updateMany({ where: { id: reportId, status: 'PENDING' }, data: { status, reviewedBy: adminId, reviewedAt: new Date(), humanReview: true } });
      if (resolution.count !== 1) throw new Error('Report has already been resolved.');
      await tx.moderationAction.create({ data: { queueId: reportId, moderatorId: adminId, action, reason: note || null, automated: false } });
      return tx.moderationQueue.findUnique({ where: { id: reportId } });
    });
    if (action === 'remove') {
      const mediaQuarantined = await this.cleanupRemovedContent(removedFiles, 'Report');
      await prisma.moderationRemoval.update({
        where: { queueId: reportId },
        data: { mediaQuarantineStatus: mediaQuarantined ? 'COMPLETED' : 'FAILED' },
      });
    }
    await this.logComplianceAction(adminId, 'REPORT_PROCESSED', 'REPORT', reportId, { action, note, status: updated?.status });
    return updated;
  }

  async restoreReport(reportId: string, adminId: string, reason: string) {
    const restorationReason = typeof reason === 'string' ? reason.trim().slice(0, 2000) : '';
    if (!restorationReason) throw new Error('A restoration reason is required.');

    const removal = await prisma.moderationRemoval.findUnique({ where: { queueId: reportId } });
    if (!removal || removal.sourceType !== 'REPORT') throw new Error('No reversible moderation removal exists for this report.');
    if (removal.restoredAt) throw new Error('This moderation removal has already been restored.');

    const report = await prisma.moderationQueue.findUnique({ where: { id: reportId } });
    if (!report || report.status !== 'REMOVED') throw new Error('Only removed reports can be restored.');

    const claim = await prisma.moderationRemoval.updateMany({
      where: { id: removal.id, restoredAt: null, mediaQuarantineStatus: { not: 'RESTORING' } },
      data: { mediaQuarantineStatus: 'RESTORING' },
    });
    if (claim.count !== 1) throw new Error('This moderation removal is already being restored.');

    const recordTypesByTarget: Record<string, string[]> = {
      POST: ['Post'],
      VIDEO: ['Video', 'Reel'],
      REEL: ['Video', 'Reel'],
      STORY: ['Story'],
      POST_COMMENT: ['PostComment'],
      VIDEO_COMMENT: ['VideoComment'],
      COMMENT: ['PostComment', 'VideoComment'],
      MESSAGE: ['Message'],
      STREAM: ['LiveStream'],
      LIVE_STREAM: ['LiveStream'],
    };
    const recordTypes = recordTypesByTarget[removal.targetType.trim().toUpperCase()];
    if (!recordTypes) {
      await prisma.moderationRemoval.update({ where: { id: removal.id }, data: { mediaQuarantineStatus: 'FAILED' } });
      throw new Error('Unsupported moderation target type.');
    }

    const files = await prisma.uploadedFile.findMany({
      where: { recordType: { in: recordTypes }, recordId: removal.targetId, deletedAt: { not: null } },
      select: { id: true },
    });
    const { uploadService } = require('./upload.service');
    const restoredFileIds: string[] = [];
    try {
      for (const file of files) {
        const restored = await uploadService.restoreModeratedFile(file.id);
        if (!restored) throw new Error('A moderated media asset could not be restored.');
        restoredFileIds.push(file.id);
      }
    } catch (error) {
      if (restoredFileIds.length) {
        await prisma.uploadedFile.updateMany({ where: { id: { in: restoredFileIds } }, data: { deletedAt: new Date() } });
        await Promise.allSettled(restoredFileIds.map((id) => uploadService.quarantineModeratedFile(id)));
      }
      await prisma.moderationRemoval.update({ where: { id: removal.id }, data: { mediaQuarantineStatus: 'FAILED' } });
      throw new Error(error instanceof Error ? error.message : 'Media restoration failed; content remains hidden.');
    }

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const currentRemoval = await tx.moderationRemoval.findUnique({ where: { id: removal.id } });
        if (!currentRemoval || currentRemoval.restoredAt) throw new Error('This moderation removal has already been restored.');
        await restoreModeratedContent(tx, removal.targetType, removal.targetId);
        const resolution = await tx.moderationQueue.updateMany({
          where: { id: reportId, status: 'REMOVED' },
          data: { status: 'RESTORED', reviewedBy: adminId, reviewedAt: new Date(), humanReview: true },
        });
        if (resolution.count !== 1) throw new Error('Report is no longer in a restorable state.');
        await tx.moderationRemoval.update({
          where: { id: removal.id },
          data: {
            restoredAt: new Date(),
            restoredBy: adminId,
            restorationReason,
            mediaQuarantineStatus: 'RESTORED',
          },
        });
        await tx.moderationAction.create({
          data: { queueId: reportId, moderatorId: adminId, action: 'restore', reason: restorationReason, automated: false },
        });
        return tx.moderationQueue.findUnique({ where: { id: reportId } });
      });
    } catch (error) {
      if (restoredFileIds.length) {
        await prisma.uploadedFile.updateMany({ where: { id: { in: restoredFileIds } }, data: { deletedAt: new Date() } });
        await Promise.allSettled(restoredFileIds.map((id) => uploadService.quarantineModeratedFile(id)));
      }
      await prisma.moderationRemoval.update({ where: { id: removal.id }, data: { mediaQuarantineStatus: 'FAILED' } });
      throw error;
    }

    const cachesInvalidated = await this.cleanupRemovedContent([], 'Report restoration');
    if (!cachesInvalidated) {
      await prisma.moderationRemoval.update({
        where: { id: removal.id },
        data: { mediaQuarantineStatus: 'FAILED' },
      });
    }
    await this.logComplianceAction(adminId, 'REPORT_CONTENT_RESTORED', 'REPORT', reportId, {
      targetType: removal.targetType,
      targetId: removal.targetId,
      reason: restorationReason,
      cachesInvalidated,
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
    // The active schema supports account-restriction appeals. Content and
    // monetization appeals need their own persisted target model and are
    // rejected explicitly rather than written to a nonexistent delegate.
    if (!['SUSPENSION', 'BAN', 'ACCOUNT_RESTRICTION'].includes(appealType)) {
      throw new Error('Only account-restriction appeals are currently supported.');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user || !['SUSPENDED', 'BANNED'].includes(user.status)) {
      throw new Error('There is no active account restriction to appeal.');
    }

    const existingAppeal = await prisma.accountAppeal.findFirst({
      where: { userId, status: { in: ['PENDING', 'UNDER_REVIEW'] } },
    });
    if (existingAppeal) {
      throw new Error('You already have a pending account appeal. Please wait for a decision.');
    }

    const category = appealType === 'BAN' ? 'ACCOUNT_RESTRICTION' : 'ACCOUNT_RESTRICTION';
    const appeal = await prisma.accountAppeal.create({
      data: {
        userId,
        accountStatus: user.status,
        category,
        explanation: explanation || reason,
        supportingInfo: evidenceUrls?.length ? JSON.stringify(evidenceUrls) : null,
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

    return prisma.accountAppeal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      skip: Math.max(offset, 0),
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
  }

  async processAppeal(appealId: string, adminId: string, decision: string, reason?: string) {
    const appeal = await prisma.accountAppeal.findUnique({ where: { id: appealId } });
    if (!appeal) throw new Error('Appeal not found.');
    if (!['APPROVED', 'REJECTED', 'UNDER_REVIEW'].includes(decision)) {
      throw new Error('Invalid appeal decision.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.accountAppeal.update({
        where: { id: appealId },
        data: {
          status: decision,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          decisionNote: reason || null,
          accountRestored: decision === 'APPROVED',
        },
      });

      if (decision === 'APPROVED' && ['SUSPENDED', 'BANNED'].includes(appeal.accountStatus)) {
        await tx.user.update({
          where: { id: appeal.userId },
          data: {
            status: 'ACTIVE',
            suspendedAt: null,
            suspendedReason: null,
            suspendedUntil: null,
            bannedAt: null,
            bannedReason: null,
          },
        });
      }
      return result;
    });

    await this.createComplianceNotification(appeal.userId, 'APPEAL_DECISION', {
      title: `Appeal ${decision.toLowerCase().replace('_', ' ')}`,
      message: `Your account restriction appeal has been ${decision.toLowerCase().replace('_', ' ')}.${reason ? ` Reason: ${reason}` : ''}`,
      actionUrl: '/privacy-center?tab=appeals',
      metadata: { resourceId: appealId },
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
          data: { status: 'BANNED', bannedAt: new Date(), bannedReason: 'Repeat copyright infringement', suspendedAt: null, suspendedReason: null, suspendedUntil: null },
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
    if (!['remove', 'reject'].includes(action)) throw new Error('Supported copyright decisions are remove or reject. Copyright counter-notice restoration is not yet available.');
    let removedFiles: Array<{ id: string; filename: string }> = [];
    const updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.copyrightClaim.findUnique({ where: { id: claimId } });
      if (!claim) throw new Error('Copyright claim not found.');
      if (!['PENDING', 'UNDER_REVIEW', 'COUNTER_NOTICE'].includes(claim.status)) throw new Error('Copyright claim has already been resolved.');
      if (action === 'remove') {
        if (!claim.infringingContentId || !claim.infringingContentType) throw new Error('This claim has no supported content target; it cannot be marked removed.');
        removedFiles = await removeModeratedContent(tx, claim.infringingContentType, claim.infringingContentId);
        await tx.moderationRemoval.create({
          data: {
            sourceType: 'COPYRIGHT_CLAIM',
            sourceId: claimId,
            targetType: claim.infringingContentType,
            targetId: claim.infringingContentId,
            moderatorId: adminId,
            reason: note || 'Copyright takedown',
            mediaQuarantineStatus: 'PENDING',
          },
        });
      }
      return tx.copyrightClaim.update({
        where: { id: claimId },
        data: { status: action === 'remove' ? 'ACTIONED' : 'REJECTED', actionTaken: action === 'remove' ? 'CONTENT_REMOVED' : 'NO_ACTION', processedById: adminId, processedAt: new Date(), decisionNote: note },
      });
    });
    if (action === 'remove') {
      const mediaQuarantined = await this.cleanupRemovedContent(removedFiles, 'Copyright');
      await prisma.moderationRemoval.updateMany({
        where: { sourceType: 'COPYRIGHT_CLAIM', sourceId: claimId },
        data: { mediaQuarantineStatus: mediaQuarantined ? 'COMPLETED' : 'FAILED' },
      });
    }
    await this.logComplianceAction(adminId, 'COPYRIGHT_CLAIM_PROCESSED', 'COPYRIGHT_CLAIM', claimId, { action, note });
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

  async getChildSafetyFlags(limit = 50, offset = 0, status?: string) {
    const where = status ? { status } : {};
    const [flags, total] = await Promise.all([
      prisma.childSafetyFlag.findMany({
        where,
        include: {
          user: {
            select: { id: true, username: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.childSafetyFlag.count({ where }),
    ]);

    return { flags, total, limit, offset };
  }

  async processChildSafetyFlag(flagId: string, adminId: string, action: string, note?: string) {
    const statusByAction: Record<string, string> = {
      approve: 'APPROVED',
      dismiss: 'DISMISSED',
      escalate: 'ESCALATED',
      restrict: 'ESCALATED',
    };
    if (!Object.prototype.hasOwnProperty.call(statusByAction, action)) {
      throw new Error('Unsupported child-safety action.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const flag = await tx.childSafetyFlag.findUnique({ where: { id: flagId } });
      if (!flag) throw new Error('Flag not found.');
      if (flag.status !== 'PENDING_REVIEW') throw new Error('Child-safety flag has already been reviewed.');

      const result = await tx.childSafetyFlag.update({
        where: { id: flagId },
        data: {
          status: statusByAction[action],
          actionTaken: action,
          actionDetail: note,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });

      if (action === 'restrict') {
        await tx.user.update({
          where: { id: flag.userId },
          data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: note || 'Child safety review', suspendedUntil: null },
        });
      }
      return { result, userId: flag.userId };
    });

    await this.logComplianceAction(adminId, 'CHILD_SAFETY_FLAG_PROCESSED', 'USER', updated.userId, {
      flagId,
      action,
      note,
    });
    return updated.result;
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

    const [moderationRemovals, copyrightRemovals] = await Promise.all([
      prisma.moderationAction.count({ where: { action: 'remove', createdAt: { gte: monthStart, lte: monthEnd } } }),
      prisma.copyrightClaim.count({ where: { actionTaken: 'CONTENT_REMOVED', createdAt: { gte: monthStart, lte: monthEnd } } }),
    ]);

    const metrics = [
      {
        metricType: 'ENFORCEMENT_ACTIONS',
        totalCount: await prisma.moderationAction.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
      },
      {
        metricType: 'REPORT_VOLUME',
        totalCount: await prisma.moderationQueue.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
      },
      {
        metricType: 'APPEAL_OUTCOMES',
        totalCount: await prisma.accountAppeal.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
      },
      {
        metricType: 'CONTENT_REMOVALS',
        totalCount: moderationRemovals + copyrightRemovals,
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
    // Login events are recorded in the active, tamper-evident SecurityLog table.
    return prisma.securityLog.findMany({
      where: { userId, action: { contains: 'LOGIN' } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
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
    // Compliance alerts share the platform Notification table so they appear
    // in the same inbox and do not depend on a parallel, uninstalled model.
    return prisma.notification.create({
      data: {
        userId,
        type,
        title: data.title,
        message: data.message,
        entityType: 'COMPLIANCE',
        entityId: data.metadata?.resourceId || null,
        data: JSON.stringify({
          ...(data.metadata || {}),
          ...(data.actionUrl ? { actionUrl: data.actionUrl } : {}),
        }),
      },
    });
  }

  async getComplianceNotifications(userId: string, unreadOnly = false) {
    const notifications = await prisma.notification.findMany({
      where: { userId, entityType: 'COMPLIANCE', ...(unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return notifications.map((notification) => {
        let metadata: any = {};
        try { metadata = notification.data ? JSON.parse(notification.data) : {}; } catch { metadata = {}; }
        return { ...notification, actionUrl: metadata.actionUrl, metadata };
      });
  }

  async markNotificationRead(notificationId: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id: notificationId, userId, entityType: 'COMPLIANCE' },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllNotificationsRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, entityType: 'COMPLIANCE', read: false },
      data: { read: true, readAt: new Date() },
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
    return auditLog.log({
      userId,
      action,
      ipAddress,
      userAgent,
      severity: 'INFO',
      metadata: { resourceType, resourceId, ...(details === undefined ? {} : { details }) },
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
    const rows = await auditLog.query({
      userId: filters?.userId,
      action: filters?.action,
      startDate: filters?.startDate,
      endDate: filters?.endDate,
      // Apply resource filtering after parsing metadata because SecurityLog
      // intentionally stores structured audit context in its JSON metadata.
      limit: Math.min(Math.max(filters?.limit || 50, 1), 200),
      offset: Math.max(filters?.offset || 0, 0),
    });

    return rows.filter((row) => {
      if (!filters?.resourceType) return true;
      try {
        const metadata = row.metadata ? JSON.parse(row.metadata) : {};
        return metadata.resourceType === filters.resourceType;
      } catch {
        return false;
      }
    }).map((row) => {
      let metadata: any = {};
      try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch { metadata = {}; }
      return { ...row, resourceType: metadata.resourceType, resourceId: metadata.resourceId, details: metadata.details };
    });
  }

  // ==========================================================================
  // ADMIN COMPLIANCE DASHBOARD DATA
  // ==========================================================================

  async getComplianceDashboardStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      pendingReports,
      pendingAppeals,
      pendingExports,
      activeDeactivations,
      totalConsentRecords,
      reportsToday,
      pendingCopyrightClaims,
      pendingChildSafetyFlags,
    ] = await Promise.all([
      prisma.moderationQueue.count({ where: { status: 'PENDING' } }),
      prisma.accountAppeal.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } } }),
      prisma.dataExportRequest.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.accountDeactivation.count({ where: { status: { in: ['DEACTIVATED', 'SCHEDULED_FOR_DELETION'] } } }),
      prisma.consentRecord.count(),
      prisma.moderationQueue.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.copyrightClaim.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW', 'COUNTER_NOTICE'] } } }),
      prisma.childSafetyFlag.count({ where: { status: 'PENDING_REVIEW' } }),
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
      unavailableMetrics: [],
      timestamp: now.toISOString(),
    };
  }
}

export const complianceService = new ComplianceService();