import { prisma } from '../prisma';

// A request grants contact approval only. Blocking and normal DM permissions
// are still checked independently by chat.service before any message is sent.
export async function assertChatContactApproved(senderId: string, recipientId: string, conversationId?: string) {
  const prefs = await prisma.userSettings.findUnique({
    where: { userId: recipientId }, select: { requireChatRequest: true },
  });
  if (!prefs?.requireChatRequest) return;
  const followed = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: recipientId, followingId: senderId } }, select: { id: true },
  });
  if (followed) return;
  const accepted = await prisma.chatContactRequest.findFirst({
    where: { senderId, recipientId, status: 'ACCEPTED' }, select: { id: true },
  });
  if (accepted) return;
  // A recipient who already sent a real message to this sender has initiated
  // contact. Established conversations also remain usable after opting in.
  if (conversationId) {
    const previous = await prisma.message.findFirst({
      where: { conversationId, senderId: { in: [senderId, recipientId] }, type: { not: 'CALL' }, deletedAt: null, moderationRemovedAt: null },
      select: { id: true },
    });
    if (previous) return;
  }
  throw new Error('Contact approval required. Open Chat > Requests to send a contact request.');
}

export async function getChatUploadUsage(userId: string) {
  const grouped = await prisma.uploadedFile.groupBy({
    by: ['fileType'],
    where: { userId, category: 'message', deletedAt: null },
    _sum: { size: true }, _count: { _all: true },
  });
  const categories = grouped.map(row => ({ type: row.fileType, bytes: row._sum.size || 0, count: row._count._all }));
  return { categories, totalBytes: categories.reduce((sum, row) => sum + row.bytes, 0), fileCount: categories.reduce((sum, row) => sum + row.count, 0) };
}
