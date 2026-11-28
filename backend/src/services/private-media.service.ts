import jwt from 'jsonwebtoken';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { isVerificationDocument } from './cloudinary-storage-config';

type PrivateMediaClaims = { userId: string; fileId: string; scope: 'private-media' };
function signingSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for private media access');
  return secret;
}
export function createPrivateMediaUrl(fileId: string, userId: string): string {
  const token = jwt.sign({ userId, fileId, scope: 'private-media' } satisfies PrivateMediaClaims, signingSecret(), { expiresIn: '30m', algorithm: 'HS256' });
  return `/api/media/private/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`;
}
export function verifyPrivateMediaToken(token: string, fileId: string): string {
  const claims = jwt.verify(token, signingSecret(), { algorithms: ['HS256'] }) as jwt.JwtPayload & Partial<PrivateMediaClaims>;
  if (claims.scope !== 'private-media' || claims.fileId !== fileId || typeof claims.userId !== 'string' || !claims.userId) throw new Error('Invalid private media token');
  return claims.userId;
}
export async function privateMediaStaticGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filename = path.basename(decodeURIComponent(req.path));
    const baseName = path.parse(filename).name.replace(/_(AVATAR|THUMBNAIL|SMALL|MEDIUM|LARGE|BANNER)$/i, '');
    const file = await prisma.uploadedFile.findFirst({
      where: {
        AND: [
          { OR: [
            { filename },
            ...(baseName ? [{ filename: { startsWith: `${baseName}.` } }] : []),
          ] },
          { OR: [
            { category: { in: ['message', 'verification', 'identity', 'kyc'], mode: 'insensitive' } },
            { recordType: { equals: 'VerificationRequest', mode: 'insensitive' } },
            { deletedAt: { not: null } },
          ] },
        ],
      },
      select: { id: true, category: true, recordType: true, deletedAt: true },
    });
    // Message media is private by design; moderated/deleted uploads must also
    // stop resolving through the public static path, including optimized URLs.
    if (file && (file.category.toLowerCase() === 'message' || isVerificationDocument(file.category, file.recordType) || file.deletedAt)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  } catch (error) {
    console.error('Private media static guard failed:', error instanceof Error ? error.message : 'unknown error');
    res.status(503).json({ error: 'Media authorization is temporarily unavailable' });
  }
}
