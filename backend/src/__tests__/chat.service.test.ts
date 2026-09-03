jest.mock('../prisma', () => ({ prisma: {
  conversation: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  participant: { findUnique: jest.fn(), findMany: jest.fn() },
  message: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  uploadedFile: { findMany: jest.fn(), updateMany: jest.fn() },
  messageRead: { createMany: jest.fn() }, user: { count: jest.fn() },
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

  it('does not create duplicate read receipts', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ id: 'conversation', participants: [{ userId: 'reader' }] });
    (db.message.findMany as jest.Mock).mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
    (db.messageRead.createMany as jest.Mock).mockResolvedValue({ count: 2 });
    await expect(service.markMessagesAsRead('conversation', 'reader')).resolves.toEqual({ count: 2 });
    expect(db.messageRead.createMany).toHaveBeenCalledWith({ data: [{ messageId: 'one', userId: 'reader' }, { messageId: 'two', userId: 'reader' }] });
  });
});