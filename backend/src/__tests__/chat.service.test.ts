jest.mock('../prisma', () => ({ prisma: {
  conversation: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  participant: { findUnique: jest.fn(), findMany: jest.fn() },
  group: { findMany: jest.fn() }, channel: { findMany: jest.fn() },
  message: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  uploadedFile: { findMany: jest.fn(), updateMany: jest.fn() },
  messageRead: { createMany: jest.fn() }, user: { count: jest.fn() },
  blockedUser: { findFirst: jest.fn() },
  follow: { findUnique: jest.fn(), findMany: jest.fn() },
  userSettings: { findUnique: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(),
} }));

jest.mock('../services/private-media.service', () => ({
  createPrivateMediaUrl: jest.fn((fileId: string) => `/api/media/private/${fileId}?token=test-token`),
}));

import { prisma } from '../prisma';
import { ChatService } from '../services/chat.service';

const db = prisma as jest.Mocked<typeof prisma>;
const service = new ChatService();

describe('ChatService security and persistence', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-private-media-signing';
    jest.clearAllMocks();
    (db.userSettings.findMany as jest.Mock).mockResolvedValue([]);
    (db.follow.findMany as jest.Mock).mockResolvedValue([]);
    (db.$transaction as jest.Mock).mockImplementation((callback: any) => callback(db));
  });

  it('rejects message access for users outside a conversation', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ id: 'conversation', participants: [{ userId: 'member' }] });
    await expect(service.getMessages('conversation', 'attacker')).rejects.toThrow('unauthorized');
    expect(db.message.findMany).not.toHaveBeenCalled();
  });


  it('returns user-bound private URLs for message attachments after membership checks', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ id: 'conversation', participants: [{ userId: 'reader' }] });
    (db.message.findMany as jest.Mock).mockResolvedValue([{
      id: 'message-1',
      sender: { id: 'sender', username: 'sender' },
      reads: [],
      reactions: [],
      attachments: [{ id: 'attachment-1', url: 'https://cdn.test/private.jpg', fileType: 'IMAGE' }],
      replyTo: null,
    }]);
    (db.userSettings.findMany as jest.Mock).mockResolvedValue([]);
    (db.uploadedFile.findMany as jest.Mock).mockResolvedValue([{
      id: 'private-file-1', url: 'https://cdn.test/private.jpg', recordId: 'message-1',
    }]);

    const result = await service.getMessages('conversation', 'reader');
    expect(result.messages[0].attachments[0].url).toBe('/api/media/private/private-file-1?token=test-token');
  });

  it('omits expired replies and excludes old messages from history queries', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ id: 'conversation', permissions: JSON.stringify({autoDeleteSeconds: 3600}), participants: [{userId:'reader'}] });
    (db.message.findMany as jest.Mock).mockResolvedValue([{id:'fresh',createdAt:new Date(),senderId:'sender',reads:[],attachments:[],replyTo:{id:'old',createdAt:new Date(Date.now()-7200000),content:'expired',attachments:[]}}]);
    (db.uploadedFile.findMany as jest.Mock).mockResolvedValue([]);
    const result=await service.getMessages('conversation','reader');
    expect(result.messages[0].replyTo).toBeNull();
    expect(db.message.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({createdAt:{gte:expect.any(Date)}})}));
  });

  it('sanitizes content and persists attachment metadata', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ id: 'conversation', participants: [{ userId: 'sender' }] });
    (db.uploadedFile.findMany as jest.Mock).mockResolvedValue([{
      id: 'file', userId: 'sender', url: 'https://cdn.test/photo.jpg', fileType: 'IMAGE',
      originalName: 'photo.jpg', size: 42,
    }]);
    (db.uploadedFile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (db.message.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: 'message', ...data }));
    (db.conversation.update as jest.Mock).mockResolvedValue({});
    await service.sendMessage('conversation', 'sender', '  hello\u0000  ', 'IMAGE', [{ fileId: 'file' }]);
    expect(db.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      content: 'hello', type: 'IMAGE', attachments: { create: [{ url: 'https://cdn.test/photo.jpg', fileType: 'IMAGE', fileName: 'photo.jpg', fileSize: 42 }] },
    }) }));
    expect(db.uploadedFile.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['file'] }, userId: 'sender', category: 'message', recordType: 'Conversation', recordId: 'conversation', deletedAt: null },
      data: { recordType: 'Message', recordId: 'message' },
    });
  });

  it('persists a reply to another participant message in the same conversation', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', type: 'GROUP', participants: [{ userId: 'sender', role: 'MEMBER' }],
    });
    (db.message.findFirst as jest.Mock).mockResolvedValue({ id: 'other-message' });
    (db.message.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: 'reply', ...data }));
    (db.conversation.update as jest.Mock).mockResolvedValue({});

    await service.sendMessage('conversation', 'sender', 'I will be there.', 'TEXT', [], 'other-message');

    expect(db.message.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-message', conversationId: 'conversation', moderationRemovedAt: null, deletedAt: null, OR: [{ deletedFor: null }, { deletedFor: { not: 'sender' } }] },
      select: { id: true },
    });
    expect(db.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ replyToId: 'other-message' }),
    }));
  });

  it('stores multiple media attachments + caption as ONE logical message', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', type: 'DIRECT', participants: [{ userId: 'sender', role: 'MEMBER' }],
    });
    const files = [
      { id: 'f1', userId: 'sender', url: 'https://cdn/a.jpg', fileType: 'IMAGE', originalName: 'a.jpg', size: 11 },
      { id: 'f2', userId: 'sender', url: 'https://cdn/b.jpg', fileType: 'IMAGE', originalName: 'b.jpg', size: 22 },
      { id: 'f3', userId: 'sender', url: 'https://cdn/c.mp4', fileType: 'VIDEO', originalName: 'c.mp4', size: 33 },
    ];
    (db.uploadedFile.findMany as jest.Mock).mockResolvedValue(files);
    (db.uploadedFile.updateMany as jest.Mock).mockResolvedValue({count: files.length});
    (db.message.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: 'msg-1', ...data }));
    (db.conversation.update as jest.Mock).mockResolvedValue({});

    await service.sendMessage('conversation', 'sender', 'Look at these', 'TEXT', [
      { fileId: 'f1' }, { fileId: 'f2' }, { fileId: 'f3' },
    ]);

    // One Message row carrying the caption + 3 attachment children.
    expect(db.message.create).toHaveBeenCalledTimes(1);
    expect(db.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        content: 'Look at these',
        attachments: {
          create: [
            { url: 'https://cdn/a.jpg', fileType: 'IMAGE', fileName: 'a.jpg', fileSize: 11 },
            { url: 'https://cdn/b.jpg', fileType: 'IMAGE', fileName: 'b.jpg', fileSize: 22 },
            { url: 'https://cdn/c.mp4', fileType: 'VIDEO', fileName: 'c.mp4', fileSize: 33 },
          ],
        },
      }),
    }));
    expect(db.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conversation' }, data: expect.objectContaining({ updatedAt: expect.any(Date) }) })
    );
  });

  it('rejects a message when a competing send has already bound its attachment', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({id:'conversation',type:'GROUP',participants:[{userId:'sender',role:'MEMBER'}]});
    (db.uploadedFile.findMany as jest.Mock).mockResolvedValue([{id:'file',userId:'sender',url:'https://cdn/a.jpg',fileType:'IMAGE',originalName:'a.jpg',size:11}]);
    (db.message.create as jest.Mock).mockImplementation(({data}:any)=>Promise.resolve({id:'new-message',...data}));
    (db.uploadedFile.updateMany as jest.Mock).mockResolvedValue({count:0});
    await expect(service.sendMessage('conversation','sender','photo','IMAGE',[{fileId:'file'}])).rejects.toThrow('Attachment already used or no longer available');
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it('rejects a reply target from another conversation', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', type: 'GROUP', participants: [{ userId: 'sender', role: 'MEMBER' }],
    });
    (db.message.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.sendMessage('conversation', 'sender', 'Reply', 'TEXT', [], 'foreign-message'))
      .rejects.toThrow('Reply target not found');
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it('enforces group message permissions for regular members', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', type: 'GROUP', permissions: JSON.stringify({ sendMessages: false }),
      participants: [{ userId: 'sender', role: 'MEMBER' }],
    });

    await expect(service.sendMessage('conversation', 'sender', 'Blocked'))
      .rejects.toThrow('Members cannot send messages');
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it('creates a Story reply message with the Story reference stored as a private DM', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', type: 'DIRECT', participants: [{ userId: 'sender', role: 'MEMBER' }],
    });
    (db.message.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: 'story-reply', ...data }));
    (db.conversation.update as jest.Mock).mockResolvedValue({});

    await service.sendMessage('conversation', 'sender', 'Nice story!', 'TEXT', [], undefined, {
      storyId: 'story-abc',
      mediaUrl: 'https://cdn/story.jpg',
      caption: 'My trip to the coast',
      author: 'Alex (@alex)',
    });

    expect(db.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        content: 'Nice story!',
        type: 'STORY_REPLY',
        storyReplyStoryId: 'story-abc',
        storyReplyMediaUrl: 'https://cdn/story.jpg',
        storyReplyCaption: 'My trip to the coast',
        storyReplyAuthor: 'Alex (@alex)',
      }),
    }));
  });

  it('never publishes a story reply as a public StoryComment', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', type: 'DIRECT', participants: [{ userId: 'sender', role: 'MEMBER' }],
    });
    (db.message.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: 'story-reply', ...data }));
    (db.conversation.update as jest.Mock).mockResolvedValue({});

    await service.sendMessage('conversation', 'sender', 'Nice story!', 'TEXT', [], undefined, { storyId: 'story-abc', caption: 'My trip', author: 'Alex' });

    // A story reply touches ONLY the messaging layer — one Message row and the
    // conversation touch. No StoryComment / feed publish path is ever reached.
    expect(db.message.create).toHaveBeenCalledTimes(1);
    expect(db.conversation.update).toHaveBeenCalledTimes(1);
    const created = (db.message.create as jest.Mock).mock.calls[0][0] as any;
    expect(created.data.type).toBe('STORY_REPLY');
    expect(created.data.storyReplyStoryId).toBe('story-abc');
  });

  it('does not create duplicate read receipts', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ id: 'conversation', participants: [{ userId: 'reader' }] });
    (db.message.findMany as jest.Mock).mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
    (db.messageRead.createMany as jest.Mock).mockResolvedValue({ count: 2 });
    (db.userSettings.findUnique as jest.Mock).mockResolvedValue({ readReceipts: true });
    await expect(service.markMessagesAsRead('conversation', 'reader')).resolves.toEqual({ count: 2, receiptsHidden: false });
    expect(db.messageRead.createMany).toHaveBeenCalledWith({ data: [{ messageId: 'one', userId: 'reader' }, { messageId: 'two', userId: 'reader' }] });
  });

  it('hides the read receipt broadcast when the reader disabled read receipts', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ id: 'conversation', participants: [{ userId: 'reader' }] });
    (db.message.findMany as jest.Mock).mockResolvedValue([{ id: 'one' }]);
    (db.messageRead.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    (db.userSettings.findUnique as jest.Mock).mockResolvedValue({ readReceipts: true, privacyReadReceipts: 'nobody' });
    await expect(service.markMessagesAsRead('conversation', 'reader')).resolves.toEqual({ count: 1, receiptsHidden: true });
  });

  it('keeps read receipts private to the message sender and enforces followers-only visibility', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', participants: [{ userId: 'sender' }, { userId: 'reader' }, { userId: 'member' }],
    });
    (db.message.findMany as jest.Mock).mockResolvedValue([{
      id: 'message-1', senderId: 'sender', reads: [{ userId: 'reader' }, { userId: 'member' }],
    }]);
    (db.userSettings.findMany as jest.Mock).mockResolvedValue([
      { userId: 'reader', readReceipts: true, privacyReadReceipts: 'followers' },
      { userId: 'member', readReceipts: true, privacyReadReceipts: 'nobody' },
    ]);
    (db.follow.findMany as jest.Mock).mockResolvedValue([
      { followerId: 'sender', followingId: 'reader' },
    ]);

    const senderView = await service.searchMessages('conversation', 'sender', 'hello');
    expect(senderView[0].reads).toEqual([{ userId: 'reader' }]);

    const otherMemberView = await service.searchMessages('conversation', 'member', 'hello');
    expect(otherMemberView[0].reads).toEqual([{ userId: 'member' }]);
  });

  it('rejects a direct message when the recipient does not accept messages', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', isGroup: false, type: 'DIRECT',
      participants: [{ userId: 'sender', role: 'MEMBER' }, { userId: 'target', role: 'MEMBER' }],
    });
    (db.blockedUser.findFirst as jest.Mock).mockResolvedValue(null);
    (db.userSettings.findUnique as jest.Mock).mockResolvedValue({ privacyMessages: 'noone' });
    await expect(service.sendMessage('conversation', 'sender', 'hi')).rejects.toThrow('not accepting messages');
  });

  it('rejects a direct message from a blocked account', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', isGroup: false, type: 'DIRECT',
      participants: [{ userId: 'sender', role: 'MEMBER' }, { userId: 'target', role: 'MEMBER' }],
    });
    (db.blockedUser.findFirst as jest.Mock).mockResolvedValue({ id: 'block1' });
    await expect(service.sendMessage('conversation', 'sender', 'hi')).rejects.toThrow('Messaging with this account is not allowed');
  });

  it('requires the recipient to follow the sender when messages are limited to people they follow', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', isGroup: false, type: 'DIRECT',
      participants: [{ userId: 'sender', role: 'MEMBER' }, { userId: 'target', role: 'MEMBER' }],
    });
    (db.blockedUser.findFirst as jest.Mock).mockResolvedValue(null);
    (db.userSettings.findUnique as jest.Mock).mockResolvedValue({ privacyMessages: 'following' });
    (db.follow.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.sendMessage('conversation', 'sender', 'hi')).rejects.toThrow('only accepts messages from accounts it follows');
  });

  it('requires the sender to follow the recipient for Privacy Center followers-only messages', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', isGroup: false, type: 'DIRECT',
      participants: [{ userId: 'sender', role: 'MEMBER' }, { userId: 'target', role: 'MEMBER' }],
    });
    (db.blockedUser.findFirst as jest.Mock).mockResolvedValue(null);
    (db.userSettings.findUnique as jest.Mock).mockResolvedValue({ privacyMessages: 'followers' });
    (db.follow.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.sendMessage('conversation', 'sender', 'hi')).rejects.toThrow('only accepts messages from its followers');
    expect(db.follow.findUnique).toHaveBeenCalledWith({
      where: { followerId_followingId: { followerId: 'sender', followingId: 'target' } },
      select: { id: true },
    });
  });

  it('allows a direct message when the recipient accepts from everyone', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conversation', isGroup: false, type: 'DIRECT',
      participants: [{ userId: 'sender', role: 'MEMBER' }, { userId: 'target', role: 'MEMBER' }],
    });
    (db.blockedUser.findFirst as jest.Mock).mockResolvedValue(null);
    (db.userSettings.findUnique as jest.Mock).mockResolvedValue({ privacyMessages: 'everyone' });
    (db.message.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: 'm', ...data }));
    (db.conversation.update as jest.Mock).mockResolvedValue({});
    const result = await service.sendMessage('conversation', 'sender', 'hello');
    expect(result).toBeDefined();
  });
  it('does not let a removed sender edit their old message', async () => {
    (db.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'old-message',
      senderId: 'former-member',
      deletedAt: null,
      conversation: { type: 'GROUP', permissions: null, participants: [] },
    });

    await expect(service.editMessage('old-message', 'former-member', 'edited'))
      .rejects.toThrow('unauthorized');
    expect(db.message.update).not.toHaveBeenCalled();
  });

  it('does not let a removed sender delete their old message', async () => {
    (db.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'old-message',
      senderId: 'former-member',
      deletedAt: null,
      conversation: { type: 'GROUP', permissions: null, participants: [] },
    });

    await expect(service.deleteMessage('old-message', 'former-member'))
      .rejects.toThrow('unauthorized');
    expect(db.message.update).not.toHaveBeenCalled();
  });

  it('does not let a direct-chat creator delete the other participant messages', async () => {
    (db.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'direct-message',
      senderId: 'recipient',
      deletedAt: null,
      conversation: {
        type: 'DIRECT',
        permissions: null,
        participants: [
          { userId: 'creator', role: 'OWNER' },
          { userId: 'recipient', role: 'MEMBER' },
        ],
      },
    });

    await expect(service.deleteMessage('direct-message', 'creator', true))
      .rejects.toThrow('unauthorized');
    expect(db.message.update).not.toHaveBeenCalled();
  });

  it('allows an active group administrator to moderate group messages', async () => {
    (db.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'group-message',
      senderId: 'member',
      deletedAt: null,
      conversation: {
        type: 'GROUP',
        permissions: null,
        participants: [{ userId: 'admin', role: 'ADMIN' }],
      },
    });
    (db.message.update as jest.Mock).mockResolvedValue({ id: 'group-message', deletedAt: new Date() });

    await expect(service.deleteMessage('group-message', 'admin', true)).resolves.toBeDefined();
    expect(db.message.update).toHaveBeenCalled();
  });

  it('returns protected private attachment URLs from message mutation responses', async () => {
    (db.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'message-1',
      senderId: 'sender',
      deletedAt: null,
      conversation: { type: 'DIRECT', permissions: null, participants: [{ userId: 'sender', role: 'MEMBER' }] },
    });
    (db.message.update as jest.Mock).mockResolvedValue({
      id: 'message-1',
      senderId: 'sender',
      attachments: [{ url: 'https://cdn.test/private.jpg' }],
      replyTo: null,
    });
    (db.uploadedFile.findMany as jest.Mock).mockResolvedValue([
      { id: 'private-file-1', url: 'https://cdn.test/private.jpg' },
    ]);

    const result = await service.editMessage('message-1', 'sender', 'updated');
    expect(result.attachments[0].url).toBe('/api/media/private/private-file-1?token=test-token');
  });

  it('rejects multi-user direct conversations so groups cannot bypass group membership records', async () => {
    await expect(service.createConversation(['user1', 'user2', 'user3'], undefined, false, {
      type: 'DIRECT',
      createdById: 'user1',
    })).rejects.toThrow('exactly two participants');
    expect(db.user.count).not.toHaveBeenCalled();
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

  it('requires an explicit owner for group and channel conversation records', async () => {
    await expect(service.createConversation(['user1', 'user2'], 'fake channel', true, {
      type: 'CHANNEL',
    })).rejects.toThrow('explicit owner');
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

});

describe('ChatService conversation list batching', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (db.group.findMany as jest.Mock).mockResolvedValue([]);
    (db.channel.findMany as jest.Mock).mockResolvedValue([]);
    (db.message.groupBy as jest.Mock).mockResolvedValue([{ conversationId: 'c1', _count: { _all: 3 } }]);
    (db.follow.findMany as jest.Mock).mockResolvedValueOnce([{ followingId: 'allowed' }]);
    (db.userSettings.findMany as jest.Mock).mockResolvedValue([
      { userId: 'allowed', readReceipts: false },
      { userId: 'hidden', readReceipts: true, privacyReadReceipts: 'everyone' },
    ]);
  });
  it('batches counts and privacy lookups without exposing hidden presence or receipts', async () => {
    const conv = (id: string, partner: string, senderId: string) => ({
      id, type: 'DIRECT', participants: [
        { userId: 'viewer', role: 'MEMBER', user: { id: 'viewer' } },
        { userId: partner, role: 'MEMBER', user: { id: partner, userPresence: { isOnline: true, lastActive: new Date() },
          userSettings: { onlineStatus: 'followers', lastSeen: 'nobody' } } },
      ], messages: [{ id: 'm-' + id, senderId, reads: [{ userId: partner }, { userId: 'viewer' }] }],
    });
    (db.conversation.findMany as jest.Mock).mockResolvedValue([conv('c1', 'allowed', 'viewer'), conv('c2', 'hidden', 'hidden'), conv('lookahead', 'other', 'viewer')]);
    const result = await service.getConversations('viewer', 2);
    expect(result.nextCursor).toBe('c2');
    expect(result.conversations.map(c => c.unreadCount)).toEqual([3, 0]);
    expect(result.conversations[0].partner.isOnline).toBe(true);
    expect(result.conversations[1].partner.isOnline).toBe(false);
    expect(result.conversations[0].partner.lastActive).toBeUndefined();
    expect(result.conversations[0].lastMessage.reads).toEqual([{ userId: 'viewer' }]);
    expect(result.conversations[1].lastMessage.reads).toEqual([{ userId: 'viewer' }]);
    expect(db.message.count).not.toHaveBeenCalled();
    expect(db.message.groupBy).toHaveBeenCalledTimes(1);
    expect(db.message.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: { in: ['c1', 'c2'] }, deletedAt: null, moderationRemovedAt: null,
        OR: [{ deletedFor: null }, { deletedFor: { not: 'viewer' } }], senderId: { not: 'viewer' }, reads: { none: { userId: 'viewer' } } },
    }));
    expect(db.follow.findMany).toHaveBeenCalledTimes(1);
    expect(db.userSettings.findMany).toHaveBeenCalledTimes(1);
  });
  it('does not query enrichment data for an empty page', async () => {
    (db.conversation.findMany as jest.Mock).mockResolvedValue([]);
    await expect(service.getConversations('viewer')).resolves.toEqual({ conversations: [], nextCursor: null });
    expect(db.message.groupBy).not.toHaveBeenCalled();
    expect(db.group.findMany).not.toHaveBeenCalled();
  });
});