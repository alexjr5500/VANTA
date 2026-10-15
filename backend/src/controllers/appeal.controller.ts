// ============================================================================
// VANTA ACCOUNT APPEAL CONTROLLER
// ----------------------------------------------------------------------------
// Restricted-scope endpoints for suspended and banned accounts. None of these
// expose administrative data: they only accept submissions, return the
// caller's own appeal state, and a minimal account overview. The actor is
// always resolved server-side (restricted session or verified appeal token)
// — never from the request body.
// ============================================================================
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest, authenticate } from '../security';
import { verifyAppealToken } from '../security/accountStatus';
import { prisma } from '../prisma';
import { appealService, AppealError } from '../services/appeal.service';

declare module 'express-serve-static-core' {
  interface Request {
    appealUserId?: string;
  }
}

const sendAppealError = (res: Response, error: unknown): void => {
  if (error instanceof AppealError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code, details: error.details });
    return;
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  res.status(400).json({ error: message });
};

/**
 * Dual authentication for appeal endpoints:
 *  1. Banned accounts present the short-lived appeal token issued at login.
 *     The token is only honored while the account is still BANNED and grants
 *     access to nothing except these appeal endpoints.
 *  2. Suspended accounts present their restricted session; the canonical
 *     `authenticate` middleware allowlist already permits only these routes.
 */
export const authenticateAppealRequest = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const token = header.split(' ')[1];
      const appealUserId = verifyAppealToken(token);
      if (appealUserId) {
        const user = await prisma.user.findUnique({
          where: { id: appealUserId },
          select: { id: true, status: true },
        });
        if (!user || user.status !== 'BANNED') {
          res.status(403).json({ error: 'Appeal token is no longer valid', code: 'APPEAL_TOKEN_INVALID' });
          return;
        }
        req.appealUserId = user.id;
        next();
        return;
      }
    }

    // Fall back to the canonical session authentication (suspended accounts).
    authenticate(req, res, (error?: unknown) => {
      if (error) { next(error); return; }
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      req.appealUserId = req.user.userId;
      next();
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/appeals — submit an appeal (suspended session or banned token). */
export const submitAppeal = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.appealUserId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const appeal = await appealService.submitAppeal(req.appealUserId, req.body || {});
    res.status(201).json({ appeal, message: 'Appeal submitted for review.' });
  } catch (error) {
    sendAppealError(res, error);
  }
};

/** GET /api/appeals/mine — the caller's own appeal history (newest first). */
export const getOwnAppeals = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.appealUserId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const appeals = await appealService.getOwnAppeals(req.appealUserId);
    res.status(200).json({ appeals });
  } catch (error) {
    sendAppealError(res, error);
  }
};

/**
 * GET /api/appeals/account — minimal account + latest-appeal overview for the
 * suspended/banned screens. Deliberately excludes internal decision notes of
 * other accounts, audit entries and any administrative data.
 */
export const getAccountOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.appealUserId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const overview = await appealService.getAccountOverview(req.appealUserId);
    res.status(200).json(overview);
  } catch (error) {
    sendAppealError(res, error);
  }
};
