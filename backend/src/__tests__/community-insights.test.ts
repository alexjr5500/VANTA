jest.mock('../prisma', () => ({ prisma: { group: { findUnique: jest.fn() }, channel: { findUnique: jest.fn() }, message: { count: jest.fn() }, participant: { count: jest.fn() }, securityLog: { findMany: jest.fn() } } }));
jest.mock('../security/auditLog', () => ({ auditLog: { log: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../security/config', () => ({ config: { auditLog: { enabled: true } } }));
import { prisma } from '../prisma';
import { canViewCommunityInsights, getCommunityInsights, safeCommunityAction, logCommunityUpdate } from '../services/community-insights';
import { auditLog } from '../security/auditLog';

describe('Community insights', () => {
  beforeEach(() => jest.clearAllMocks());
  it('requires current membership and owner or administrator status', () => {
    expect(canViewCommunityInsights('owner', 'owner', undefined)).toBe(false);
    expect(canViewCommunityInsights('owner', 'owner', 'MEMBER')).toBe(true);
    expect(canViewCommunityInsights('owner', 'member', 'MEMBER')).toBe(false);
    expect(canViewCommunityInsights('owner', 'admin', 'ADMIN')).toBe(true);
  });
  it('does not query statistics or audit data for an unauthorized member', async () => {
    (prisma.group.findUnique as jest.Mock).mockResolvedValue({ ownerId: 'owner', conversationId: 'chat', members: [{ role: 'MEMBER' }], _count: { members: 8 } });
    expect(await getCommunityInsights('group', 'g1', 'member')).toBeNull();
    expect(prisma.message.count).not.toHaveBeenCalled();
    expect(prisma.securityLog.findMany).not.toHaveBeenCalled();
  });
  it('returns only explicitly scoped and redacted audit rows', () => {
    const row = { id: 'a', action: 'GROUP_SETTINGS_UPDATED', metadata: JSON.stringify({ groupId: 'g1', ip: 'secret', other: 'private' }), createdAt: new Date(), user: { username: 'admin' }, ipAddress: 'secret' };
    expect(safeCommunityAction('group', 'g2', row)).toBeNull();
    expect(safeCommunityAction('channel', 'g1', row)).toBeNull();
    expect(safeCommunityAction('group', 'g1', row)).toEqual({ id: 'a', label: 'Community settings updated', actor: 'admin', createdAt: row.createdAt });
    expect(safeCommunityAction('group', 'g1', { ...row, metadata: 'invalid' })).toBeNull();
  });
  it('queries actual counts and scopes recent actions', async () => {
    (prisma.channel.findUnique as jest.Mock).mockResolvedValue({ ownerId: 'owner', conversationId: 'c1', members: [{ role: 'ADMIN' }], _count: { members: 10 } });
    (prisma.message.count as jest.Mock).mockResolvedValue(12);
    (prisma.participant.count as jest.Mock).mockResolvedValue(3);
    (prisma.securityLog.findMany as jest.Mock).mockResolvedValue([]);
    expect(await getCommunityInsights('channel', 'channel1', 'admin')).toMatchObject({ members: 10, messagesLast7Days: 12, currentMembersJoinedLast7Days: 3, recentActions: [] });
    expect(prisma.message.count).toHaveBeenCalledWith({ where: expect.objectContaining({ conversationId: 'c1', deletedAt: null, moderationRemovedAt: null }) });
    expect(prisma.securityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50, where: expect.objectContaining({ metadata: { contains: '"channelId":"channel1"' } }) }));
  });
  it('logs categories of successful updates without copying content or member lists', async () => {
    await logCommunityUpdate('group', 'g1', 'admin', { description: 'private text', memberIds: ['person'] });
    expect(auditLog.log).toHaveBeenCalledTimes(2);
    expect(auditLog.log).toHaveBeenCalledWith({ userId: 'admin', action: 'GROUP_SETTINGS_UPDATED', metadata: { groupId: 'g1' } });
  });
});
