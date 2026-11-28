import { prisma } from '../prisma';
import { assertChatContactApproved, getChatUploadUsage } from '../services/chat-contact.service';

jest.mock('../prisma', () => ({ prisma: {
  userSettings: { findUnique: jest.fn() }, follow: { findUnique: jest.fn() },
  chatContactRequest: { findFirst: jest.fn() }, message: { findFirst: jest.fn() },
  uploadedFile: { groupBy: jest.fn() },
} }));

describe('chat contact approval and storage', () => {
  beforeEach(() => { jest.resetAllMocks(); });
  test('new contact is denied when approval is required and absent', async () => {
    (prisma.userSettings.findUnique as jest.Mock).mockResolvedValue({ requireChatRequest: true });
    await expect(assertChatContactApproved('sender','recipient')).rejects.toThrow('Contact approval required');
    expect(prisma.chatContactRequest.findFirst).toHaveBeenCalledWith({ where: { senderId: 'sender', recipientId: 'recipient', status: 'ACCEPTED' }, select: { id: true } });
  });
  test('accepted requests and previously messaged conversations remain usable', async () => {
    (prisma.userSettings.findUnique as jest.Mock).mockResolvedValue({ requireChatRequest: true });
    (prisma.chatContactRequest.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'accepted' });
    await expect(assertChatContactApproved('sender','recipient')).resolves.toBeUndefined();
    (prisma.message.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'prior' });
    await expect(assertChatContactApproved('sender','recipient','existing')).resolves.toBeUndefined();
  });
  test('storage only sums owned active chat uploads', async () => {
    (prisma.uploadedFile.groupBy as jest.Mock).mockResolvedValue([{ fileType: 'IMAGE', _sum: { size: 100 }, _count: { _all: 2 } }, { fileType: 'VIDEO', _sum: { size: 200 }, _count: { _all: 1 } }]);
    expect(await getChatUploadUsage('owner')).toMatchObject({ totalBytes: 300, fileCount: 3 });
    expect(prisma.uploadedFile.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner', category: 'message', deletedAt: null } }));
  });
});
