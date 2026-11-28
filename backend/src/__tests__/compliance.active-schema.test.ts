import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('../prisma', () => ({
  prisma: {
    userSettings: { upsert: jest.fn() },
    accountDeactivation: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    accountDeletionRequest: { updateMany: jest.fn() },
    copyrightClaim: { findUnique: jest.fn(), update: jest.fn() },
    counterNotice: { create: jest.fn() },
    moderationQueue: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    moderationAction: { create: jest.fn(), count: jest.fn() },
    moderationRemoval: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    childSafetyFlag: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    notification: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
    user: { update: jest.fn(), findMany: jest.fn() },
    consentRecord: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    uploadedFile: { findMany: jest.fn(), updateMany: jest.fn() },
    dataExportRequest: { findMany: jest.fn(), update: jest.fn() },
    post: { findMany: jest.fn() },
  },
}));

jest.mock('../services/content-removal.service', () => ({ removeModeratedContent: jest.fn(), restoreModeratedContent: jest.fn() }));
jest.mock('../services/cache.service', () => ({ cacheService: { delPattern: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../services/upload.service', () => ({ uploadService: { deleteFile: jest.fn().mockResolvedValue(true), quarantineModeratedFile: jest.fn().mockResolvedValue(true), restoreModeratedFile: jest.fn().mockResolvedValue(true) } }));

jest.mock('../security/auditLog', () => ({
  auditLog: {
    log: jest.fn(),
    query: jest.fn(),
  },
}));

import { prisma } from '../prisma';
import { auditLog } from '../security/auditLog';
import { isDeactivatedAllowedRequest } from '../security/accountStatus';
import { complianceService } from '../services/compliance.service';
import { removeModeratedContent, restoreModeratedContent } from '../services/content-removal.service';
import { cacheService } from '../services/cache.service';
import { uploadService } from '../services/upload.service';

const consentRecord = (prisma as any).consentRecord;
const moderationRemoval = (prisma as any).moderationRemoval;
const audit = auditLog as any;

describe('child safety flag admin queue', () => {
  const flags = (prisma as any).childSafetyFlag;
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns paginated flags with only the user fields required by the review queue', async () => {
    const rows = [{
      id: 'flag-1',
      flagType: 'UNDERAGE_ACCOUNT',
      status: 'PENDING_REVIEW',
      escalationLevel: 'URGENT',
      user: { id: 'user-1', username: 'sample-user', status: 'ACTIVE' },
    }];
    flags.findMany.mockResolvedValue(rows);
    flags.count.mockResolvedValue(1);

    await expect(complianceService.getChildSafetyFlags(25, 5, 'PENDING_REVIEW')).resolves.toEqual({
      flags: rows,
      total: 1,
      limit: 25,
      offset: 5,
    });

    expect(flags.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING_REVIEW' },
      include: {
        user: { select: { id: true, username: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: 5,
      take: 25,
    });
    expect(flags.count).toHaveBeenCalledWith({ where: { status: 'PENDING_REVIEW' } });
  });
});

describe('compliance data export API privacy', () => {
  const exports = (prisma as any).dataExportRequest;
  beforeEach(() => { jest.clearAllMocks(); });
  test('lists only public export status fields and never exposes storage paths', async () => {
    exports.findMany.mockResolvedValue([{ id: 'export-1', status: 'COMPLETED', createdAt: new Date(), expiresAt: new Date(), filePath: '/srv/private/exports/export.zip', userId: 'user-1' }]);
    await complianceService.getDataExports('user-1');
    expect(exports.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, createdAt: true, expiresAt: true },
    });
  });
});

describe('privacy settings enforcement compatibility', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  test('maps private account type to the existing profile visibility enforcement field', async () => {
    (prisma as any).userSettings.upsert.mockResolvedValue({ userId: 'user-1', accountType: 'PRIVATE', privacyProfile: 'private', privacyReadReceipts: 'everyone' });
    await complianceService.updatePrivacySettings('user-1', { accountType: 'PRIVATE' });
    expect((prisma as any).userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ accountType: 'PRIVATE', privacyProfile: 'private' }),
      update: expect.objectContaining({ accountType: 'PRIVATE', privacyProfile: 'private' }),
    }));
  });
  test('maps followers-only message permissions to the recipient follower contract', async () => {
    (prisma as any).userSettings.upsert.mockResolvedValue({ userId: 'user-1', privacyReadReceipts: 'everyone' });
    await complianceService.updatePrivacySettings('user-1', { messagePermissions: 'followers' });
    expect((prisma as any).userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ messagePermissions: 'followers', privacyMessages: 'followers' }),
      update: expect.objectContaining({ messagePermissions: 'followers', privacyMessages: 'followers' }),
    }));
  });

  test('maps story, call, live-stream, and invite permissions to established fields', async () => {
    (prisma as any).userSettings.upsert.mockResolvedValue({ userId: 'user-1', privacyReadReceipts: 'everyone' });
    await complianceService.updatePrivacySettings('user-1', {
      storyVisibility: 'followers',
      callPermissions: 'nobody',
      liveStreamVisibility: 'followers',
      communityInvites: 'nobody',
      groupInvites: 'followers',
      tagPermissions: 'followers',
    });
    expect((prisma as any).userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        storyVisibility: 'followers', privacyStories: 'following',
        callPermissions: 'nobody', privacyCalls: 'noone',
        liveStreamVisibility: 'followers', privacyLiveStream: 'following',
        communityInvites: 'nobody', groupInvites: 'followers', privacyInvites: 'following',
        tagPermissions: 'followers', privacyTagging: 'following',
      }),
      update: expect.objectContaining({
        storyVisibility: 'followers', privacyStories: 'following',
        callPermissions: 'nobody', privacyCalls: 'noone',
        liveStreamVisibility: 'followers', privacyLiveStream: 'following',
        communityInvites: 'nobody', groupInvites: 'followers', privacyInvites: 'following',
        tagPermissions: 'followers', privacyTagging: 'following',
      }),
    }));
  });

  test('does not let community invite preferences overwrite group invitation rules', async () => {
    (prisma as any).userSettings.upsert.mockResolvedValue({ userId: 'user-1', communityInvites: 'nobody', groupInvites: 'everyone', privacyReadReceipts: 'everyone' });
    await complianceService.updatePrivacySettings('user-1', { communityInvites: 'nobody' });
    expect((prisma as any).userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ communityInvites: 'nobody' }),
      update: expect.objectContaining({ communityInvites: 'nobody' }),
    }));
    expect((prisma as any).userSettings.upsert.mock.calls[0][0].create).not.toHaveProperty('privacyInvites');
    expect((prisma as any).userSettings.upsert.mock.calls[0][0].update).not.toHaveProperty('privacyInvites');
  });

  test('maps new message permission values to the existing chat enforcement field', async () => {
    (prisma as any).userSettings.upsert.mockResolvedValue({ userId: 'user-1', messagePermissions: 'nobody', privacyMessages: 'noone', privacyReadReceipts: 'everyone' });
    await complianceService.updatePrivacySettings('user-1', { messagePermissions: 'nobody' });
    expect((prisma as any).userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ messagePermissions: 'nobody', privacyMessages: 'noone' }),
      update: expect.objectContaining({ messagePermissions: 'nobody', privacyMessages: 'noone' }),
    }));
  });
});

describe('deactivated account recovery allowlist', () => {
  test('allows only the owner recovery and sign-out endpoints', () => {
    expect(isDeactivatedAllowedRequest('GET', '/api/compliance/account/deactivation-status')).toBe(true);
    expect(isDeactivatedAllowedRequest('POST', '/api/compliance/account/cancel-deletion')).toBe(true);
    expect(isDeactivatedAllowedRequest('POST', '/api/compliance/account/recover')).toBe(true);
    expect(isDeactivatedAllowedRequest('POST', '/api/auth/logout')).toBe(true);
    expect(isDeactivatedAllowedRequest('GET', '/api/compliance/privacy-settings')).toBe(false);
    expect(isDeactivatedAllowedRequest('POST', '/api/posts')).toBe(false);
    expect(isDeactivatedAllowedRequest('POST', '/api/compliance/account/recover/extra')).toBe(false);
  });
});

describe('compliance consent storage on the active Prisma schema', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reads the latest consent state and preserves unset separately from denied', async () => {
    consentRecord.findMany.mockResolvedValue([
      { id: '3', type: 'cookies:NOT_SET', granted: false, createdAt: new Date('2026-11-15T03:00:00Z') },
      { id: '2', type: 'analytics', granted: false, createdAt: new Date('2026-11-15T02:00:00Z') },
      { id: '1', type: 'analytics', granted: true, createdAt: new Date('2026-11-15T01:00:00Z') },
    ]);

    await expect(complianceService.getConsentPreferences('user-1')).resolves.toEqual({
      analytics: 'denied',
      personalization: 'not_set',
      marketing: 'not_set',
      aiFeatures: 'not_set',
      notifications: 'not_set',
      cookies: 'not_set',
    });
  });

  test('appends consent changes to ConsentRecord and returns the current preferences', async () => {
    consentRecord.create.mockResolvedValue({});
    consentRecord.findMany.mockResolvedValue([
      { id: '1', type: 'analytics', granted: true, createdAt: new Date() },
      { id: '2', type: 'marketing', granted: false, createdAt: new Date() },
      { id: '3', type: 'cookies:NOT_SET', granted: false, createdAt: new Date() },
    ]);

    await expect(complianceService.updateConsentPreferences(
      'user-1',
      { analytics: 'granted', marketing: 'denied', cookies: 'not_set' },
      'privacy_center',
      '127.0.0.1',
      'VANTA test',
    )).resolves.toEqual({
      analytics: 'granted',
      personalization: 'not_set',
      marketing: 'denied',
      aiFeatures: 'not_set',
      notifications: 'not_set',
      cookies: 'not_set',
    });

    expect(consentRecord.create).toHaveBeenCalledTimes(3);
    expect(consentRecord.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', type: 'analytics', granted: true, ipAddress: '127.0.0.1' }),
    }));
    expect(consentRecord.create).toHaveBeenNthCalledWith(3, expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', type: 'cookies:NOT_SET', granted: false }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      action: 'CONSENT_UPDATE',
    }));
  });

  test('rejects unsupported consent values without writing a record', async () => {
    await expect(complianceService.updateConsentPreferences('user-1', {
      analytics: 'maybe',
    })).rejects.toThrow('Invalid consent value for analytics.');

    expect(consentRecord.create).not.toHaveBeenCalled();
  });
});

describe('compliance privacy settings on the active Prisma schema', () => {
  const userSettings = (prisma as any).userSettings;
  beforeEach(() => {
    jest.clearAllMocks();
    userSettings.upsert.mockResolvedValue({ userId: 'user-1', accountType: 'PUBLIC', onlineStatus: 'everyone', privacyReadReceipts: 'followers', readReceipts: true, profileSearchVisibility: true });
  });
  test('reads privacy center settings without overwriting the legacy chat read-receipts flag', async () => {
    await expect(complianceService.getPrivacySettings('user-1')).resolves.toMatchObject({ accountType: 'PUBLIC', readReceipts: 'followers', privacyReadReceipts: 'followers' });
    expect(userSettings.upsert).toHaveBeenCalledWith({ where: { userId: 'user-1' }, create: { userId: 'user-1' }, update: {} });
  });
  test('persists validated privacy controls to UserSettings', async () => {
    await complianceService.updatePrivacySettings('user-1', { accountType: 'PRIVATE', onlineStatus: 'followers', readReceipts: 'nobody', discoverability: false });
    expect(userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' }, update: { accountType: 'PRIVATE', privacyProfile: 'private', onlineStatus: 'followers', privacyReadReceipts: 'nobody', readReceipts: false, discoverability: false } }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', action: 'PRIVACY_SETTINGS_UPDATE' }));
  });
  test('keeps essential functional cookies enabled and rejects disabling them', async () => {
    (prisma as any).userSettings.upsert.mockResolvedValue({ userId: 'user-1', cookieFunctional: true, privacyReadReceipts: 'everyone' });
    await expect(complianceService.updatePrivacySettings('user-1', { cookieFunctional: false }))
      .rejects.toThrow('Functional cookies are required for essential platform operation.');
    expect((prisma as any).userSettings.upsert).not.toHaveBeenCalled();
    await expect(complianceService.getPrivacySettings('user-1')).resolves.toMatchObject({ cookieFunctional: true });
  });

  test('rejects invalid privacy values without writing settings', async () => {
    await expect(complianceService.updatePrivacySettings('user-1', { onlineStatus: 'anyone' })).rejects.toThrow('Invalid privacy value for onlineStatus.');
    expect(userSettings.upsert).not.toHaveBeenCalled();
  });
});

describe('compliance account lifecycle transactions', () => {
  const account = (prisma as any).accountDeactivation;
  const transaction = (prisma as any).$transaction;
  beforeEach(() => { jest.clearAllMocks(); });
  test('deactivation persists its recovery window and user status atomically', async () => {
    account.findUnique.mockResolvedValue(null);
    const tx = { accountDeactivation: { upsert: jest.fn().mockResolvedValue({ id: 'deactivation-1', userId: 'user-1', status: 'DEACTIVATED' }) }, user: { update: jest.fn().mockResolvedValue({}) } };
    transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(complianceService.deactivateAccount('user-1', 'privacy', 'details')).resolves.toMatchObject({ id: 'deactivation-1', status: 'DEACTIVATED' });
    expect(tx.accountDeactivation.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' }, create: expect.objectContaining({ userId: 'user-1', status: 'DEACTIVATED', deactivationType: 'TEMPORARY', recoveryToken: expect.any(String) }) }));
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { status: 'DEACTIVATED' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', action: 'ACCOUNT_DEACTIVATED' }));
  });
  test('reactivates a temporarily deactivated account through the cancel endpoint', async () => {
    account.findUnique.mockResolvedValue({ userId: 'user-1', status: 'DEACTIVATED', recoveryToken: 'recovery-token' });
    const tx = {
      accountDeactivation: { update: jest.fn().mockResolvedValue({ status: 'RECOVERED' }) },
      user: { update: jest.fn().mockResolvedValue({}) },
      accountDeletionRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(complianceService.cancelDeletion('user-1')).resolves.toMatchObject({ status: 'RECOVERED' });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { status: 'ACTIVE' } });
    expect(tx.accountDeletionRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
  });
  test('does not reactivate an account after its recovery deadline', async () => {
    account.findUnique.mockResolvedValue({
      userId: 'user-1',
      status: 'DEACTIVATED',
      recoveryPeriodEnd: new Date(Date.now() - 1000),
    });
    await expect(complianceService.cancelDeletion('user-1')).rejects.toThrow('The account recovery period has expired.');
    expect(transaction).not.toHaveBeenCalled();
  });
  test('does not allow scheduling deletion in the past', async () => {
    await expect(complianceService.scheduleAccountDeletion('user-1', 'reason', new Date(Date.now() - 1000))).rejects.toThrow('The scheduled deletion date must be in the future.');
    expect(account.findUnique).not.toHaveBeenCalled();
  });
  test('permanent deletion anonymizes profile identifiers and revokes sessions atomically', async () => {
    account.findMany.mockResolvedValueOnce([{ userId: 'user-1' }]).mockResolvedValueOnce([]);
    const tx = {
      accountDeactivation: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'user-1', status: 'SCHEDULED_FOR_DELETION', scheduledFor: new Date(Date.now() - 1000) }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }), update: jest.fn().mockResolvedValue({}) },
      session: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      trustedDevice: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      providerAccount: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      twoFactorLoginChallenge: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      passwordResetToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      transferOtpChallenge: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      pushDevice: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      pushDelivery: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      uploadSession: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      userPresence: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      notificationPreferences: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      userSettings: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      userEmbedding: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      userInterest: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      interactionEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      aIContent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      aIAnalytics: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      aISession: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      profile: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      photo: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      follow: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postLike: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postComment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postCommentLike: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postSave: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      videoLike: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      videoComment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      videoCommentLike: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      videoSave: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      watchHistory: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      contentView: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      storyView: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      storyLike: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      storyComment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      participant: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      communityMember: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      channelMember: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      groupMember: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      messageRead: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      messageReaction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      streamViewer: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      liveReaction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      streamFollower: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      blockedUser: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      mutedUser: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      verificationRequest: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      propertyVerification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      post: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      video: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      story: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      message: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      communityPost: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      channelMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      groupMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      liveChatMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      liveStream: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      community: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      channel: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      group: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      creatorSubscription: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      premiumMembership: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      creatorMembership: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      walletPIN: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      wallet: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      propertyListing: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      accountDeletionRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    transaction.mockImplementation(async (callback: any) => callback(tx));
    (prisma as any).uploadedFile.findMany.mockResolvedValue([{ id: 'file-1', filename: 'avatar.png' }]);
    await expect(complianceService.permanentlyDeleteExpiredAccounts()).resolves.toMatchObject({ deleted: 1, unrecovered: 0, failed: 0 });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        status: 'DELETED', age: null, dateOfBirth: null, country: null, city: null,
        gender: null, interestedIn: null, emailVerified: false, verified: false,
        twoFactorSecret: null, backupCodes: null,
      }),
    }));
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.providerAccount.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.pushDevice.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.profile.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.communityPost.deleteMany).toHaveBeenCalledWith({ where: { authorId: 'user-1' } });
    expect(tx.follow.deleteMany).toHaveBeenCalledWith({ where: { OR: [{ followerId: 'user-1' }, { followingId: 'user-1' }] } });
    expect(tx.messageReaction.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.communityMember.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.community.updateMany).toHaveBeenCalledWith({ where: { ownerId: 'user-1' }, data: { avatar: null, bannerUrl: null } });
    expect(tx.creatorSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ subscriberId: 'user-1' }, { creatorId: 'user-1' }], status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'CANCELLED', autoRenew: false }),
    }));
    expect(tx.walletPIN.deleteMany).toHaveBeenCalledWith({ where: { wallet: { userId: 'user-1' } } });
    expect(tx.propertyListing.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 'user-1' },
      data: expect.objectContaining({ availabilityStatus: 'ARCHIVED', contactWhatsApp: null, contactPhone: null }),
    }));
    expect((prisma as any).uploadedFile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', deletedAt: null, category: { in: ['avatar', 'banner', 'profile-media', 'thumbnail', 'group-avatar', 'channel-avatar', 'community-avatar', 'community-banner', 'reel', 'post-media', 'story'] } },
    }));
    expect(uploadService.deleteFile).toHaveBeenCalledWith('avatar.png', 'file-1');
    expect(tx.accountDeactivation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' }, data: expect.objectContaining({ status: 'DELETED', recoveryToken: null }) }));
  });
});

describe('copyright claim enforcement', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  test('removes the actual reported content before resolving the copyright claim', async () => {
    const claim = { id: 'claim-1', status: 'PENDING', infringingContentId: 'post-1', infringingContentType: 'POST' };
    const tx = { copyrightClaim: { findUnique: jest.fn().mockResolvedValue(claim), update: jest.fn().mockResolvedValue({ ...claim, status: 'ACTIONED' }) }, moderationRemoval: { create: jest.fn().mockResolvedValue({}) } };
    (prisma as any).$transaction.mockImplementation(async (callback: any) => callback(tx));
    (removeModeratedContent as jest.Mock).mockResolvedValue([{ id: 'file-1', filename: 'media.jpg' }]);
    await expect(complianceService.processCopyrightClaim('claim-1', 'admin-1', 'remove', 'copyright confirmed')).resolves.toMatchObject({ status: 'ACTIONED' });
    expect(removeModeratedContent).toHaveBeenCalledWith(tx, 'POST', 'post-1');
    expect(tx.copyrightClaim.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'claim-1' }, data: expect.objectContaining({ status: 'ACTIONED', actionTaken: 'CONTENT_REMOVED' }) }));
    expect(uploadService.quarantineModeratedFile).toHaveBeenCalledWith('file-1');
    expect(uploadService.deleteFile).not.toHaveBeenCalled();
    expect(cacheService.delPattern).toHaveBeenCalledWith('feed:*');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'COPYRIGHT_CLAIM_PROCESSED' }));
  });
  test('refuses to mark a claim removed when it has no supported content target', async () => {
    const claim = { id: 'claim-2', status: 'PENDING', infringingContentId: null, infringingContentType: null };
    const tx = { copyrightClaim: { findUnique: jest.fn().mockResolvedValue(claim), update: jest.fn() } };
    (prisma as any).$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(complianceService.processCopyrightClaim('claim-2', 'admin-1', 'remove')).rejects.toThrow('This claim has no supported content target');
    expect(tx.copyrightClaim.update).not.toHaveBeenCalled();
    expect(removeModeratedContent).not.toHaveBeenCalled();
  });
});

describe('content reports use the active moderation queue', () => {
  const queue = (prisma as any).moderationQueue;
  beforeEach(() => { jest.clearAllMocks(); });
  test('creates a content report with active ModerationQueue fields', async () => {
    queue.findFirst.mockResolvedValue(null);
    queue.create.mockResolvedValue({ id: 'queue-1', targetType: 'POST', targetId: 'post-1', status: 'PENDING' });
    await expect(complianceService.createReport('user-1', 'POST', 'post-1', 'harassment', 'details', 'creator-1', ['evidence'])).resolves.toMatchObject({ id: 'queue-1', status: 'PENDING' });
    expect(queue.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reportedBy: 'user-1', targetType: 'POST', targetId: 'post-1', targetUserId: 'creator-1', category: 'harassment', description: 'details', evidenceUrls: '[\"evidence\"]' }) }));
  });
  test('rejects a duplicate report for the same content within 24 hours', async () => {
    queue.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(complianceService.createReport('user-1', 'POST', 'post-1', 'harassment')).rejects.toThrow('already reported this content');
    expect(queue.create).not.toHaveBeenCalled();
  });
});

describe('content report moderation', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  test('records a reversible removal audit linked to the moderation queue item', async () => {
    const report = { id: 'queue-restore', status: 'PENDING', targetType: 'POST', targetId: 'post-restore', targetUserId: null };
    const tx = {
      moderationQueue: { findUnique: jest.fn().mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, status: 'REMOVED' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      moderationAction: { create: jest.fn().mockResolvedValue({}) },
      moderationRemoval: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn() },
    };
    (prisma as any).$transaction.mockImplementation(async (callback: any) => callback(tx));
    (removeModeratedContent as jest.Mock).mockResolvedValue([]);
    moderationRemoval.update.mockResolvedValue({});
    await complianceService.processReport('queue-restore', 'admin-1', 'remove', 'policy violation');
    expect(tx.moderationRemoval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        queueId: 'queue-restore',
        sourceType: 'REPORT',
        sourceId: 'queue-restore',
        targetType: 'POST',
        targetId: 'post-restore',
        moderatorId: 'admin-1',
        reason: 'policy violation',
      }),
    });
    expect(moderationRemoval.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { queueId: 'queue-restore' },
      data: { mediaQuarantineStatus: 'COMPLETED' },
    }));
  });

  test('removes reported content and records the moderation action atomically', async () => {
    const report = { id: 'queue-2', status: 'PENDING', targetType: 'POST', targetId: 'post-2', targetUserId: null };
    const tx = { moderationQueue: { findUnique: jest.fn().mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, status: 'REMOVED' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, moderationAction: { create: jest.fn().mockResolvedValue({}) }, moderationRemoval: { create: jest.fn().mockResolvedValue({}) }, user: { update: jest.fn() } };
    (prisma as any).$transaction.mockImplementation(async (callback: any) => callback(tx));
    (removeModeratedContent as jest.Mock).mockResolvedValue([]);
    await expect(complianceService.processReport('queue-2', 'admin-1', 'remove', 'policy violation')).resolves.toMatchObject({ status: 'REMOVED' });
    expect(removeModeratedContent).toHaveBeenCalledWith(tx, 'POST', 'post-2');
    expect(tx.moderationQueue.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'queue-2', status: 'PENDING' }, data: expect.objectContaining({ status: 'REMOVED', humanReview: true }) }));
    expect(tx.moderationAction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ queueId: 'queue-2', moderatorId: 'admin-1', action: 'remove' }) }));
  });
});

describe('moderation content restoration', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  test('restores content only with a reason and records a separate restore action', async () => {
    moderationRemoval.findUnique.mockResolvedValue({
      id: 'removal-1', queueId: 'queue-restore', sourceType: 'REPORT',
      targetType: 'POST', targetId: 'post-restore', restoredAt: null,
    });
    (prisma as any).moderationQueue.findUnique.mockResolvedValue({
      id: 'queue-restore', status: 'REMOVED',
    });
    moderationRemoval.updateMany.mockResolvedValue({ count: 1 });
    (prisma as any).uploadedFile.findMany.mockResolvedValue([]);
    const tx = {
      moderationRemoval: {
        findUnique: jest.fn().mockResolvedValue({ id: 'removal-1', restoredAt: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      moderationQueue: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'queue-restore', status: 'RESTORED' }),
      },
      moderationAction: { create: jest.fn().mockResolvedValue({}) },
      post: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    (prisma as any).$transaction.mockImplementation(async (callback: any) => callback(tx));
    (restoreModeratedContent as jest.Mock).mockResolvedValue(undefined);

    await expect(complianceService.restoreReport('queue-restore', 'admin-2', 'Appeal approved')).resolves.toMatchObject({ status: 'RESTORED' });
    expect(restoreModeratedContent).toHaveBeenCalledWith(tx, 'POST', 'post-restore');
    expect(tx.moderationAction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ queueId: 'queue-restore', moderatorId: 'admin-2', action: 'restore', reason: 'Appeal approved' }),
    }));
    expect(tx.moderationRemoval.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'removal-1' },
      data: expect.objectContaining({ restoredBy: 'admin-2', restorationReason: 'Appeal approved', mediaQuarantineStatus: 'RESTORED' }),
    }));
  });

  test('rejects a restoration request without a reason', async () => {
    await expect(complianceService.restoreReport('queue-restore', 'admin-2', ' ')).rejects.toThrow('A restoration reason is required');
    expect(moderationRemoval.findUnique).not.toHaveBeenCalled();
  });
});

describe('report account actions notify the affected user', () => {
  test('warn action sends a moderation notification without changing account status', async () => {
    const report = { id: 'queue-3', status: 'PENDING', targetType: 'USER', targetId: 'target-user', targetUserId: null };
    const tx = { moderationQueue: { findUnique: jest.fn().mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, status: 'APPROVED' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, moderationAction: { create: jest.fn().mockResolvedValue({}) }, user: { update: jest.fn() }, notification: { create: jest.fn().mockResolvedValue({}) } };
    (prisma as any).$transaction.mockImplementation(async (callback: any) => callback(tx));
    await complianceService.processReport('queue-3', 'admin-1', 'warn', 'Please review the community rules.');
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'target-user', type: 'MODERATION_WARNING', entityId: 'queue-3' }) }));
  });
});

describe('child-safety moderation is validated and atomic', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  test('restricts the account and resolves the flag in one transaction', async () => {
    const flag = { id: 'flag-1', userId: 'user-1', status: 'PENDING_REVIEW' };
    const tx = {
      childSafetyFlag: { findUnique: jest.fn().mockResolvedValue(flag), update: jest.fn().mockResolvedValue({ ...flag, status: 'ESCALATED' }) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    (prisma as any).$transaction.mockImplementation(async (callback: any) => callback(tx));
    await expect(complianceService.processChildSafetyFlag('flag-1', 'admin-1', 'restrict', 'age verification required')).resolves.toMatchObject({ status: 'ESCALATED' });
    expect(tx.childSafetyFlag.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'flag-1' }, data: expect.objectContaining({ status: 'ESCALATED', actionTaken: 'restrict' }) }));
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: expect.objectContaining({ status: 'SUSPENDED', suspendedAt: expect.any(Date), suspendedReason: 'age verification required', suspendedUntil: null }) });
  });
  test('rejects unknown actions before opening a transaction', async () => {
    await expect(complianceService.processChildSafetyFlag('flag-1', 'admin-1', 'delete')).rejects.toThrow('Unsupported child-safety action.');
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});


describe('streamed data export pagination', () => {
  const post = (prisma as any).post;

  beforeEach(() => {
    jest.clearAllMocks();
    (complianceService as any).exportPageSize = 2;
  });

  test('streams a complete JSON array across bounded cursor pages', async () => {
    post.findMany
      .mockResolvedValueOnce([{ id: 'post-1', content: 'one' }, { id: 'post-2', content: 'two' }])
      .mockResolvedValueOnce([{ id: 'post-3', content: 'three' }]);

    const stream = (complianceService as any).createExportJsonStream({
      delegate: 'post',
      where: { authorId: 'user-1' },
    });
    let json = '';
    for await (const chunk of stream) json += chunk.toString();

    expect(JSON.parse(json)).toEqual([
      { id: 'post-1', content: 'one' },
      { id: 'post-2', content: 'two' },
      { id: 'post-3', content: 'three' },
    ]);
    expect(post.findMany).toHaveBeenNthCalledWith(1, {
      where: { authorId: 'user-1' }, orderBy: { id: 'asc' }, take: 2,
    });
    expect(post.findMany).toHaveBeenNthCalledWith(2, {
      where: { authorId: 'user-1' }, orderBy: { id: 'asc' }, take: 2,
      cursor: { id: 'post-2' }, skip: 1,
    });
  });
});
