import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
    sessionId?: string;
  };
  token?: string;
}

export const authenticateJWT = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header missing or invalid' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    if (!process.env.JWT_SECRET) {
      res.status(500).json({ error: 'Server configuration error: JWT_SECRET not set' });
      return;
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const decodedPayload = decoded as { userId?: string; role?: string; type?: string };

    if (!decodedPayload || !decodedPayload.userId || decodedPayload.type !== 'access') {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const session = await prisma.session.findUnique({ where: { token } });
    if (!session || session.expiresAt < new Date()) {
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }

    if (session.userId !== decodedPayload.userId) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decodedPayload.userId },
      select: { role: true, status: true },
    });
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    if (user.status !== 'ACTIVE') {
      res.status(403).json({ error: user.status === 'SUSPENDED' ? 'Account suspended' : 'Account restricted' });
      return;
    }

    await prisma.session.update({ where: { id: session.id }, data: { lastActiveAt: new Date() } });

    req.user = {
      userId: decodedPayload.userId,
      role: user.role,
      sessionId: session.id,
    };
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionallyAuthenticateJWT = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !process.env.JWT_SECRET) {
    next();
    return;
  }

  const token = authHeader.slice('Bearer '.length);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as { userId?: string; role?: string; type?: string };
    if (!decoded.userId || decoded.type !== 'access') {
      next();
      return;
    }

    const session = await prisma.session.findUnique({ where: { token } });
    if (!session || session.userId !== decoded.userId || session.expiresAt < new Date()) {
      next();
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      next();
      return;
    }

    req.user = { userId: decoded.userId, role: user.role, sessionId: session.id };
    req.token = token;
  } catch {
    // Public routes remain accessible when an optional credential is invalid.
  }
  next();
};
