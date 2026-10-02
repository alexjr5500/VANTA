jest.mock('../prisma', () => ({ prisma: {
  conversation: { findUnique: jest.fn(), update: jest.fn() },
  message: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  uploadedFile: { findMany: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
} }));

import { prisma } from '../prisma';
import { ChatService } from '../services/chat.service';

const db = prisma as jest.Mocked<typeof prisma>;
const service = new ChatService();

const makeChannelConversation = (permissions: string, participantRole = 'MEMBER') => ({
  id: 'conv-1',
  type: 'CHANNEL',
  isGroup: true,
  permissions,
  participants: [{ userId: 'user-1', role: participantRole }],
});

describe('ChatService channel permission enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.$transaction as jest.Mock).mockImplementation((callback: any) => callback(db));
  });

  it('blocks channel members from posting unless postMessages is enabled', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue(makeChannelConversation('{"postMessages":false}'));
    await expect(service.sendMessage('conv-1', 'user-1', 'hello', 'TEXT')).rejects.toThrow(
      'Only channel administrators can publish posts'
    );
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it('allows channel members to post when postMessages is enabled', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue(makeChannelConversation('{"postMessages":true}'));
    (db.message.create as jest.Mock).mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1', content: 'hello' });
    (db.conversation.update as jest.Mock).mockResolvedValue({});
    await service.sendMessage('conv-1', 'user-1', 'hello', 'TEXT');
    expect(db.message.create).toHaveBeenCalled();
  });

  it('always allows administrators to post regardless of the toggle', async () => {
    (db.conversation.findUnique as jest.Mock).mockResolvedValue(makeChannelConversation('{}', 'ADMIN'));
    (db.message.create as jest.Mock).mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1', content: 'hello' });
    (db.conversation.update as jest.Mock).mockResolvedValue({});
    await service.sendMessage('conv-1', 'user-1', 'hello', 'TEXT');
    expect(db.message.create).toHaveBeenCalled();
  });

  it('lets administrators edit any message only when editMessages is enabled', async () => {
    (db.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'msg-1',
      senderId: 'other-user',
      conversation: {
        type: 'CHANNEL',
        permissions: '{"editMessages":true}',
        participants: [
          { userId: 'admin-1', role: 'ADMIN' },
          { userId: 'other-user', role: 'MEMBER' },
        ],
      },
    });
    (db.message.update as jest.Mock).mockResolvedValue({ id: 'msg-1' });
    await service.editMessage('msg-1', 'admin-1', 'edited by admin');
    expect(db.message.update).toHaveBeenCalled();

    jest.clearAllMocks();
    (db.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'msg-1',
      senderId: 'other-user',
      conversation: {
        type: 'CHANNEL',
        permissions: '{}',
        participants: [
          { userId: 'admin-1', role: 'ADMIN' },
          { userId: 'other-user', role: 'MEMBER' },
        ],
      },
    });
    await expect(service.editMessage('msg-1', 'admin-1', 'nope')).rejects.toThrow('Message not found or unauthorized');
  });

  it('prevents admins from force-deleting posts when deleteMessages is disabled', async () => {
    (db.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'msg-1',
      senderId: 'other-user',
      conversation: {
        type: 'CHANNEL',
        permissions: '{"deleteMessages":false}',
        participants: [
          { userId: 'admin-1', role: 'ADMIN' },
          { userId: 'other-user', role: 'MEMBER' },
        ],
      },
    });
    await expect(service.deleteMessage('msg-1', 'admin-1', true)).rejects.toThrow('Message not found or unauthorized');
    expect(db.message.update).not.toHaveBeenCalled();
  });

  it('allows owners to force-delete posts even when deleteMessages is disabled', async () => {
    (db.message.findUnique as jest.Mock).mockResolvedValue({
      id: 'msg-1',
      senderId: 'other-user',
      conversation: {
        type: 'CHANNEL',
        permissions: '{"deleteMessages":false}',
        participants: [
          { userId: 'owner-1', role: 'OWNER' },
          { userId: 'other-user', role: 'MEMBER' },
        ],
      },
    });
    (db.message.update as jest.Mock).mockResolvedValue({ id: 'msg-1' });
    await service.deleteMessage('msg-1', 'owner-1', true);
    expect(db.message.update).toHaveBeenCalled();
  });
});