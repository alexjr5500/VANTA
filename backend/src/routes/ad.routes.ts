import { Router } from 'express';
import {
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaign,
  getCampaigns,
  pauseCampaign,
  resumeCampaign,
  getActiveAds,
  trackImpression,
  trackClick,
  getCampaignAnalytics,
  getAllAdsAnalytics,
} from '../controllers/ad.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// Public routes (no auth needed for ad delivery)
router.get('/active', getActiveAds);
router.post('/impression', trackImpression);
router.post('/click', trackClick);

// Protected routes
router.use(authenticateJWT);

// Campaign management
router.post('/campaigns', createCampaign);
router.put('/campaigns/:campaignId', updateCampaign);
router.delete('/campaigns/:campaignId', deleteCampaign);
router.get('/campaigns/:campaignId', getCampaign);
router.get('/campaigns', getCampaigns);
router.post('/campaigns/:campaignId/pause', pauseCampaign);
router.post('/campaigns/:campaignId/resume', resumeCampaign);

// Analytics
router.get('/analytics', getAllAdsAnalytics);
router.get('/analytics/:campaignId', getCampaignAnalytics);

export default router;