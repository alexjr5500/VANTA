import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { creatorService } from '../services/creator.service';
import { verificationService } from '../services/verification.service';

/**
 * Creator Studio controllers.
 *
 * SECURITY: every handler resolves the target creator from the authenticated
 * session (`req.user.userId`) ONLY. There is no accepted userId query/body
 * parameter, so a user cannot change a URL to read another creator's private
 * analytics or earnings.
 */

// GET /api/creator/stats — the authenticated creator's overview metrics
export const getCreatorStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const stats = await creatorService.getCreatorStats(req.user.userId);
    res.status(200).json({ stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load creator stats';
    res.status(400).json({ error: message });
  }
};

// GET /api/creator/content — the authenticated creator's recent content
export const getCreatorContent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 20;
    const content = await creatorService.getCreatorContent(req.user.userId, limit);
    res.status(200).json({ content });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load creator content';
    res.status(400).json({ error: message });
  }
};

// GET /api/creator/access — whether the authenticated user may open the Studio.
// Reuses the existing verification service and additionally honours the
// server-controlled `verified` flag and privileged roles so real accounts
// (e.g. verified creators, admins) are not forced through the paid upgrade.
export const getCreatorAccess = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const access = await verificationService.checkCreatorStudioAccess(req.user.userId);
    res.status(200).json(access);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to check creator access';
    res.status(400).json({ error: message });
  }
};
