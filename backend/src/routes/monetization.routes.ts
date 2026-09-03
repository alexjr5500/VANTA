import { Router, Request, Response } from 'express';
import { monetizationService } from '../services/monetization.service';
import { giftService } from '../services/gift.service';
import { authenticateJWT, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// ==========================================
// VANTA COINS
// ==========================================

// GET /api/monetization/packages - List coin packages
router.get('/packages', async (req: Request, res: Response) => {
  try {
    const packages = await monetizationService.getPackages();
    res.json(packages);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/monetization/purchase - Create purchase order
router.post('/purchase', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { packageId } = req.body;
    if (!packageId) return res.status(400).json({ error: 'packageId is required' });
    const order = await monetizationService.createPurchaseOrder(userId, packageId);
    res.status(201).json(order);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/monetization/purchase/complete - Complete purchase
router.post('/purchase/complete', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, providerOrderId, paymentMethod } = req.body;
    if (!orderId || !providerOrderId) return res.status(400).json({ error: 'orderId and providerOrderId required' });
    const order = await monetizationService.completePurchase(orderId, providerOrderId, paymentMethod);
    res.json(order);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// GIFTS
// ==========================================

// GET /api/monetization/gifts - List gifts
router.get('/gifts', async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const gifts = await giftService.listGifts(search, category);
    res.json(gifts);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/monetization/gifts/send - Send a gift
router.post('/gifts/send', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const senderId = req.user!.userId;
    const { receiverId, giftId, streamId, quantity, message, isAnon, requestId } = req.body;
    if (!receiverId || !giftId) return res.status(400).json({ error: 'receiverId and giftId required' });
    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)) return res.status(400).json({ error: 'quantity must be an integer between 1 and 99' });
    if (message !== undefined && typeof message !== 'string') return res.status(400).json({ error: 'message must be a string' });
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) return res.status(400).json({ error: 'A valid requestId is required' });

    const result = await giftService.sendGift(senderId, receiverId, giftId, streamId, { quantity, message, isAnon: Boolean(isAnon), requestId });
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/monetization/gifts/validate-wallet - Validate the spendable balance
router.get('/gifts/validate-wallet', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const amount = Number(req.query.amount);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      return res.status(400).json({ error: 'amount must be a positive integer' });
    }
    res.json(await giftService.validateWallet(req.user!.userId, amount));
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/monetization/gifts/:id - Get gift details
router.get('/gifts/:id', async (req: Request, res: Response) => {
  try {
    const gift = await monetizationService.getGiftById(req.params.id);
    if (!gift) return res.status(404).json({ error: 'Gift not found' });
    res.json(gift);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// WALLET
// ==========================================

// GET /api/monetization/wallet - Get wallet
router.get('/wallet', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const wallet = await monetizationService.getWallet(req.user!.userId);
    res.json(wallet);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/monetization/wallet/transactions - Get transactions
router.get('/wallet/transactions', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const transactions = await monetizationService.getTransactions(req.user!.userId, type, limit);
    res.json(transactions);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/monetization/gift-history - Get gift history
router.get('/gift-history', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const history = await giftService.getGiftHistory(req.user!.userId, Math.min(100, Math.max(1, limit)));
    res.json(history);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// CREATOR EARNINGS
// ==========================================

// GET /api/monetization/earnings - Get creator earnings
router.get('/earnings', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const earnings = await monetizationService.getCreatorEarnings(req.user!.userId);
    res.json(earnings);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// SUBSCRIPTIONS
// ==========================================

// POST /api/monetization/subscribe - Subscribe to a creator
router.post('/subscribe', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { creatorId, tier } = req.body;
    if (!creatorId || !tier) return res.status(400).json({ error: 'creatorId and tier required' });
    const subscription = await monetizationService.subscribe(req.user!.userId, creatorId, tier);
    res.status(201).json(subscription);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/monetization/subscribe/cancel - Cancel subscription
router.post('/subscribe/cancel', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { creatorId } = req.body;
    if (!creatorId) return res.status(400).json({ error: 'creatorId required' });
    const result = await monetizationService.cancelSubscription(req.user!.userId, creatorId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/monetization/subscribers - Get creator's subscribers
router.get('/subscribers', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const subscribers = await monetizationService.getCreatorSubscribers(req.user!.userId);
    res.json(subscribers);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// PREMIUM MEMBERSHIP
// ==========================================

// GET /api/monetization/premium/plans - Get premium plans
router.get('/premium/plans', async (req: Request, res: Response) => {
  try {
    const plans = await monetizationService.getPremiumPlans();
    res.json(plans);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/monetization/premium/purchase - Purchase premium
router.post('/premium/purchase', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { planSlug } = req.body;
    if (!planSlug) return res.status(400).json({ error: 'planSlug required' });
    const membership = await monetizationService.purchasePremium(req.user!.userId, planSlug);
    res.status(201).json(membership);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/monetization/premium/status - Get premium status
router.get('/premium/status', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const status = await monetizationService.getPremiumStatus(req.user!.userId);
    res.json(status);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// LEADERBOARD
// ==========================================

// GET /api/monetization/leaderboard - Get leaderboard
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'WEEKLY';
    const type = (req.query.type as string) || 'TOP_SPENDER';
    const limit = parseInt(req.query.limit as string) || 20;
    const leaderboard = await monetizationService.getLeaderboard(period, type, limit);
    res.json(leaderboard);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/monetization/top-supporters/:creatorId - Get top supporters
router.get('/top-supporters/:creatorId', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const supporters = await monetizationService.getTopSupporters(req.params.creatorId, limit);
    res.json(supporters);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// DAILY REWARDS removed - replaced by Welcome Reward
// ==========================================
// LOYALTY
// ==========================================

// GET /api/monetization/loyalty - Get loyalty level
router.get('/loyalty', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const level = await monetizationService.getLoyaltyLevel(req.user!.userId);
    res.json(level);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/monetization/milestones/check - Check milestones
router.post('/milestones/check', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const achieved = await monetizationService.checkMilestones(req.user!.userId);
    res.json(achieved);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;