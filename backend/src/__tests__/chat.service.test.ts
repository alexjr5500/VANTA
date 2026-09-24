jest.mock('../prisma', () => ({ prisma: {
  conversation: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  participant: { findUnique: jest.fn(), findMany: jest.fn() },
  message: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  uploadedFile: { findMany: jest.fn(), updateMany: jest.fn() },
  messageRead: { createMany: jest.fn() }, user: { count: jest.fn() },
  blockedUser: { findFirst: jest.fn() },
  follow: { findUnique: jest.fn() },
  userSettings: { findUnique: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(),
} }));

import { prisma } from '../prisma';
import { ChatService } from '../services/chat.service';

const db = prisma as jest.Mocked<typeof prisma>;
const service = new ChatService();

describe('ChatService security and persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.$transaction as jest.Mock).mockImplementation((callback: any) => callback(db));
  });

  it('rejects message access for users outside a conversation', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ id: 'conversation', participants: [{ userId: 'member' }] });
    await expect(service.getMessages('conversation', 'attacker')).rejects.toThrow('unauthorized');
    expect(db.message.findMany).not.toHaveBeenCalled();
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
      where: { id: { in: ['file'] }, userId: 'sender' },
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
      where: { id: 'other-message', conversationId: 'conversation' },
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
    (db.userSettings.findUnique as jest.Mock).mockResolvedValue({ readReceipts: false });
    await expect(service.markMessagesAsRead('conversation', 'reader')).resolves.toEqual({ count: 1, receiptsHidden: true });
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
});