import { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import {
  followerRewardService,
  FollowerRewardError,
  type CreateCampaignInput,
} from '../services/follower-reward.service';
import { prisma } from '../prisma';
import { getParamString } from '../utils/params';

// ============================================================================
// GOLD VERIFIED FOLLOWER REWARDS — HTTP CONTROLLER
// ============================================================================
// Thin layer over the service. Every creator endpoint enforces the Gold gate
// SERVER-SIDE (never trusts the frontend) and maps errors to clean statuses.
// ============================================================================

type AsyncHandler = (req: Request, res: Response, next?: (err?: unknown) => void) => Promise<void>;

function wrap(handler: AsyncHandler): AsyncHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof FollowerRewardError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof Error && (error as any).code === 'P2002') {
        res.status(409).json({ error: 'Reward already claimed.', code: 'ALREADY_CLAIMED' });
        return;
      }
      const message = error instanceof Error ? error.message : 'Internal server error';
      console.error('[follower-rewards]', error);
      res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL' });
    }
  };
}

const requireUser = (req: AuthRequest, res: Response): string | null => {
  if (!req.user?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return req.user.userId;
};

// GET /api/follower-rewards/me — creator dashboard
export const getMe = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const dashboard = await followerRewardService.getDashboard(userId);
  res.status(200).json(dashboard);
});

// POST /api/follower-rewards — create campaign (Gold required server-side)
export const createCampaign = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const body = (req.body || {}) as CreateCampaignInput;
  const created = await followerRewardService.createCampaign(
    userId,
    {
      rewardType: String(body.rewardType || '').toUpperCase() as 'COINS' | 'GIFT',
      totalCoins: body.totalCoins,
      giftId: body.giftId,
      targetUsers: Number(body.targetUsers),
      eligibilityType: String(body.eligibilityType || '').toUpperCase() as 'NEW' | 'EXISTING' | 'ALL',
      expiresInHours: Number(body.expiresInHours),
    },
    req.ip
  );
  res.status(201).json(created);
});

// GET /api/follower-rewards/history — creator history
export const getHistory = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const history = await followerRewardService.getHistory(userId);
  res.status(200).json({ history });
});

// GET /api/follower-rewards/availability/:creatorUsername — profile gift box
// (optionally authenticated: a signed-out viewer always gets not-authenticated)
export const getAvailability = wrap(async (req: Request, res: Response) => {
  const viewerId = (req as AuthRequest).user?.userId || null;
  const username = getParamString(req.params.creatorUsername).replace(/^@/, '').toLowerCase();
  const creator = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true },
  });
  if (!creator) {
    res.status(404).json({ error: 'Creator not found' });
    return;
  }
  const availability = await followerRewardService.getRewardAvailability(creator.id, viewerId);
  res.status(200).json({ username: creator.username, ...availability });
});

// GET /api/follower-rewards/:campaignId — creator campaign detail
export const getCampaignDetail = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const campaignId = getParamString(req.params.campaignId);
  const detail = await followerRewardService.getCampaignDetail(campaignId, userId);
  res.status(200).json(detail);
});

// GET /api/follower-rewards/:campaignId/status — claim status (auth)
export const getClaimStatus = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const campaignId = getParamString(req.params.campaignId);
  const status = await followerRewardService.getClaimStatus(campaignId, userId);
  res.status(200).json(status);
});

// POST /api/follower-rewards/:campaignId/claim — follower claim (authoritative)
export const claimReward = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const campaignId = getParamString(req.params.campaignId);
  const result = await followerRewardService.claimReward(campaignId, userId, req.ip);
  res.status(201).json({ success: true, ...result });
});

// GET /api/follower-rewards/:campaignId/claims — creator claim ledger
export const getCampaignClaims = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const campaignId = getParamString(req.params.campaignId);
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const claims = await followerRewardService.getCampaignClaims(campaignId, userId, { page, limit });
  res.status(200).json(claims);
});

// POST /api/follower-rewards/:campaignId/pause
export const pauseCampaign = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const campaignId = getParamString(req.params.campaignId);
  const result = await followerRewardService.pauseCampaign(userId, campaignId, req.ip);
  res.status(200).json(result);
});

// POST /api/follower-rewards/:campaignId/resume
export const resumeCampaign = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const campaignId = getParamString(req.params.campaignId);
  const result = await followerRewardService.resumeCampaign(userId, campaignId, req.ip);
  res.status(200).json(result);
});

// POST /api/follower-rewards/:campaignId/end
export const endCampaign = wrap(async (req: Request, res: Response) => {
  const userId = requireUser(req as AuthRequest, res);
  if (!userId) return;
  const campaignId = getParamString(req.params.campaignId);
  const result = await followerRewardService.endCampaign(userId, campaignId, req.ip);
  res.status(200).json(result);
});