import { Router } from 'express';
import { authenticateJWT, optionallyAuthenticateJWT } from '../middleware/auth.middleware';
import {
  getMe,
  createCampaign,
  getHistory,
  getAvailability,
  getCampaignDetail,
  getClaimStatus,
  claimReward,
  getCampaignClaims,
  pauseCampaign,
  resumeCampaign,
  endCampaign,
} from '../controllers/follower-reward.controller';

const router = Router();

// ============================================================================
// GOLD VERIFIED FOLLOWER REWARDS — ROUTES
// ============================================================================
// Note: static/segment prefixes (/me, /history, /availability/...) are
// registered BEFORE the parametric /:campaignId routes so Express matches the
// intended handler.
// ============================================================================

// Profile gift-box availability check (viewer optional — never trusts client).
router.get('/availability/:creatorUsername', optionallyAuthenticateJWT, getAvailability);

// Creator-facing routes (authenticated; Gold gate enforced in the service).
router.get('/me', authenticateJWT, getMe);
router.get('/history', authenticateJWT, getHistory);
router.post('/', authenticateJWT, createCampaign);

// Follower claim endpoints.
router.get('/:campaignId/status', authenticateJWT, getClaimStatus);
router.post('/:campaignId/claim', authenticateJWT, claimReward);

// Creator campaign management.
router.get('/:campaignId', authenticateJWT, getCampaignDetail);
router.get('/:campaignId/claims', authenticateJWT, getCampaignClaims);
router.post('/:campaignId/pause', authenticateJWT, pauseCampaign);
router.post('/:campaignId/resume', authenticateJWT, resumeCampaign);
router.post('/:campaignId/end', authenticateJWT, endCampaign);

export default router;