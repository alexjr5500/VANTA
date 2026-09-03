import { Request, Response } from 'express';
import { adService } from '../services';
import { AuthRequest } from '../middleware/auth.middleware';

// ============================================================================
// CAMPAIGN MANAGEMENT
// ============================================================================

export const createCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const {
      name, description, mediaUrl, mediaType, ctaText, ctaUrl, ctaInternal,
      targetCountry, priority, startDate, endDate, maxImpressions, maxClicks,
    } = req.body;

    if (!name || !mediaUrl || !startDate) {
      res.status(400).json({ error: 'Name, mediaUrl, and startDate are required' });
      return;
    }

    const campaign = await adService.createCampaign({
      name, description, mediaUrl, mediaType, ctaText, ctaUrl, ctaInternal,
      targetCountry, priority, startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      maxImpressions, maxClicks, createdBy: userId,
    });

    res.status(201).json({ message: 'Campaign created', campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const updateCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const updates = req.body;
    if (updates.startDate) updates.startDate = new Date(updates.startDate);
    if (updates.endDate) updates.endDate = new Date(updates.endDate);

    const campaign = await adService.updateCampaign(campaignId, updates);
    res.status(200).json({ message: 'Campaign updated', campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const deleteCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const result = await adService.deleteCampaign(campaignId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const campaign = await adService.getCampaign(campaignId);
    res.status(200).json(campaign);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const getCampaigns = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await adService.getCampaigns({ status, limit, offset });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const pauseCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const campaign = await adService.pauseCampaign(campaignId);
    res.status(200).json({ message: 'Campaign paused', campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const resumeCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const campaign = await adService.resumeCampaign(campaignId);
    res.status(200).json({ message: 'Campaign resumed', campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// AD DELIVERY
// ============================================================================

export const getActiveAds = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const country = req.query.country as string;
    const limit = parseInt(req.query.limit as string) || 3;
    const ads = await adService.getActiveAds(userId, country, limit);
    res.status(200).json(ads);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// TRACKING
// ============================================================================

export const trackImpression = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.body;
    const userId = req.user?.userId;
    if (!campaignId) { res.status(400).json({ error: 'campaignId is required' }); return; }
    await adService.trackImpression(campaignId, userId, req.ip, req.headers['user-agent']);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(200).json({ success: true }); // Don't fail on impression tracking
  }
};

export const trackClick = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.body;
    const userId = req.user?.userId;
    if (!campaignId) { res.status(400).json({ error: 'campaignId is required' }); return; }
    await adService.trackClick(campaignId, userId, req.ip, req.headers['user-agent']);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(200).json({ success: true }); // Don't fail on click tracking
  }
};

// ============================================================================
// ANALYTICS
// ============================================================================

export const getCampaignAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const analytics = await adService.getCampaignAnalytics(campaignId);
    res.status(200).json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getAllAdsAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const analytics = await adService.getAllAdsAnalytics();
    res.status(200).json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};