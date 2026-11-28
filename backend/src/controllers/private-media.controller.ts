import { messageIsVisible, retentionCutoff } from '../services/chat-retention';
import { Request, Response } from 'express';
import path from 'path';
import { prisma } from '../prisma';
import { uploadStorageDir, getPrivateCloudinaryDownloadUrl } from '../services/upload.service';
import { verifyPrivateMediaToken } from '../services/private-media.service';

const notFound = (res: Response) => res.status(404).json({ error: 'Not found' });
export async function getPrivateMedia(req: Request, res: Response): Promise<void> {
  try {
    const fileId = req.params.fileId;
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!fileId || !token) { notFound(res); return; }
    const userId = verifyPrivateMediaToken(token, fileId);
    const [file, user] = await Promise.all([
      prisma.uploadedFile.findUnique({ where: { id: fileId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { status: true } }),
    ]);
    if (!file || file.category !== 'message' || file.deletedAt || user?.status !== 'ACTIVE') { notFound(res); return; }
    let allowed = false;
    if (file.recordType === 'Conversation' && file.recordId) {
      const conversation = await prisma.conversation.findUnique({ where: { id: file.recordId }, include: { participants: { select: { userId: true } } } });
      allowed = Boolean(conversation?.participants.some((participant: any) => participant.userId === userId));
    } else if (file.recordType === 'Message' && file.recordId) {
      const message = await prisma.message.findUnique({ where: { id: file.recordId, moderationRemovedAt: null }, include: { conversation: { include: { participants: { select: { userId: true } } } } } });
      allowed = Boolean(message && messageIsVisible(message, userId, retentionCutoff(message.conversation.permissions)) && message.conversation.participants.some((participant: any) => participant.userId === userId));
    }
    if (!allowed) { notFound(res); return; }
    const storagePath = String(file.path || '');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (storagePath.startsWith('cloudinary:')) {
      res.redirect(302, getPrivateCloudinaryDownloadUrl(storagePath, file.filename));
      return;
    }
    const root = path.resolve(uploadStorageDir);
    const resolved = path.resolve(storagePath);
    if (!resolved.startsWith(root + path.sep)) { notFound(res); return; }
    res.type(file.mimeType || 'application/octet-stream');
    res.sendFile(resolved, (error) => { if (error && !res.headersSent) notFound(res); });
  } catch {
    notFound(res);
  }
}
