import { Router } from 'express';
import {
  getDashboardStats,
  getUsers,
  getReports,
  banUser,
  unbanUser,
  verifyUser,
  suspendUser,
  restoreUser,
  getWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  getCreators,
  verifyCreator,
  toggleMonetization,
  approveSubscription,
  getCommunities,
  getLiveStreams,
  getWalletTransactions,
  getCoinManagement,
  getPlatformAnalytics,
  getPlatformSettings,
  updatePlatformSettings,
  getSystemLogs,
  getUserManagement,
  updateUserRole,
  deleteUser,
  // New wallet admin endpoints
  freezeWallet,
  unfreezeWallet,
  reverseTransaction,
  flagSuspiciousAccount,
  getWalletAnalytics,
  getAllTransactions,
  getAllDeposits,
  getAllTransfers,
  getAllGifts,
  getAllWithdrawals,
  searchUsers,
  getCoinPaymentsDashboard,
  listCoinPayments,
  refundCoinPurchase,
  // New ad admin endpoints
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaign,
  getCampaigns,
  pauseCampaign,
  resumeCampaign,
  getCampaignAnalytics,
  getAllAdsAnalytics,
  // Admin audit / infrastructure / finance / content / notifications / live / reports
  getAuditLogs,
  getInfrastructure,
  getFinanceTransactions,
  getContentItems,
  reviewContentItem,
  getNotificationCenter,
  endLiveStream,
  suspendLiveStream,
  resolveReport,
  // Gold Verified Follower Rewards (admin)
  getFollowerRewardStats,
  listFollowerRewardCampaigns,
  getFollowerRewardCampaign,
  getFollowerRewardClaims,
  getFollowerRewardTransactions,
} from '../controllers/admin.controller';
import { authenticate, requireRole, Role } from '../security';
import { giftService, GiftCatalogInput } from '../services/gift.service';

const router = Router();

// All admin routes require authentication + ADMIN role
router.use(authenticate);
router.use(requireRole(Role.ADMIN, Role.CEO, Role.SUPER_ADMIN));

// Dashboard
router.get('/stats', getDashboardStats);

// User Management
router.get('/users', getUsers);
router.get('/users/manage', getUserManagement);
router.put('/users/role', updateUserRole);
router.delete('/users/:userId', deleteUser);
router.get('/users/search', searchUsers);

// Creator Management
router.get('/creators', getCreators);
router.post('/creators/:creatorId/verify', verifyCreator);
router.post('/creators/:creatorId/monetization', toggleMonetization);
router.post('/creators/:creatorId/subscription-approve', approveSubscription);

// Community Management
router.get('/communities', getCommunities);

// Live Stream Moderation
router.get('/live', getLiveStreams);

// Wallet Management
router.get('/wallet/transactions', getWalletTransactions);
router.get('/wallet/all-transactions', getAllTransactions);
router.get('/wallet/deposits', getAllDeposits);
router.get('/wallet/transfers', getAllTransfers);
router.get('/wallet/gifts', getAllGifts);
router.get('/wallet/withdrawals', getAllWithdrawals);
router.post('/wallet/freeze', freezeWallet);
router.post('/wallet/unfreeze', unfreezeWallet);
router.post('/wallet/reverse', reverseTransaction);
router.post('/wallet/flag', flagSuspiciousAccount);
router.get('/wallet/analytics', getWalletAnalytics);

// Coin Management
router.get('/coins', getCoinManagement);

// Coin payment dashboard (VANTA Coin purchase analytics + refunds)
router.get('/coin-payments', getCoinPaymentsDashboard);
router.get('/coin-payments/list', listCoinPayments);
router.post('/coin-payments/:orderId/refund', refundCoinPurchase);

const giftTextFields = ['slug', 'name', 'icon', 'image', 'category', 'subcategory', 'description', 'animationUrl', 'animationType', 'thumbnailUrl', 'glowColor', 'particleColor', 'soundEffect', 'artworkType', 'rarity', 'tier', 'effectProfile', 'previewAssetUrl'] as const;
const giftBooleanFields = ['isActive', 'isFeatured', 'isTrending', 'isPopular', 'isLimited', 'isLegendary', 'comboEnabled'] as const;
const giftIntegerFields = ['price', 'sortOrder', 'animationDuration', 'impactLevel'] as const;

function parseGiftInput(body: Record<string, unknown>, creating = false): GiftCatalogInput {
  const input: Record<string, unknown> = {};
  for (const field of giftTextFields) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== 'string') throw new Error(`${field} must be a string`);
    input[field] = typeof body[field] === 'string' ? body[field].trim() : null;
  }
  for (const field of giftBooleanFields) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'boolean') throw new Error(`${field} must be a boolean`);
    input[field] = body[field];
  }
  for (const field of giftIntegerFields) {
    if (body[field] === undefined) continue;
    if (!Number.isSafeInteger(body[field])) throw new Error(`${field} must be an integer`);
    input[field] = body[field];
  }
  if (body.comboMultiplier !== undefined) {
    if (typeof body.comboMultiplier !== 'number' || !Number.isFinite(body.comboMultiplier) || body.comboMultiplier <= 0) throw new Error('comboMultiplier must be a positive number');
    input.comboMultiplier = body.comboMultiplier;
  }
  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === '') input.expiresAt = null;
    else {
      const expiresAt = new Date(String(body.expiresAt));
      if (Number.isNaN(expiresAt.getTime())) throw new Error('expiresAt must be a valid date');
      input.expiresAt = expiresAt;
    }
  }
  if (input.price !== undefined && (input.price as number) < 1) throw new Error('price must be at least 1');
  if (input.animationDuration !== undefined && (input.animationDuration as number) < 1) throw new Error('animationDuration must be at least 1');
  if (creating && (!input.slug || !input.name || input.price === undefined)) throw new Error('slug, name, and price are required');
  return input as GiftCatalogInput;
}

// Gift catalog management. Transactional history is preserved by archiving
// gifts that have already been purchased instead of deleting referenced rows.
router.get('/gifts', async (_req, res) => {
  try { res.json(await giftService.listAllGifts()); } catch (error: any) { res.status(400).json({ error: error.message }); }
});
router.post('/gifts', async (req, res) => {
  try {
    const input = parseGiftInput(req.body || {}, true) as GiftCatalogInput & { slug: string; name: string; price: number };
    res.status(201).json(await giftService.createGift(input));
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});
router.put('/gifts/:giftId', async (req, res) => {
  try { res.json(await giftService.updateGift(req.params.giftId, parseGiftInput(req.body || {}))); } catch (error: any) { res.status(400).json({ error: error.message }); }
});
router.post('/gifts/:giftId/toggle', async (req, res) => {
  try { res.json(await giftService.toggleGift(req.params.giftId)); } catch (error: any) { res.status(400).json({ error: error.message }); }
});
router.delete('/gifts/:giftId', async (req, res) => {
  try { res.json(await giftService.deleteGift(req.params.giftId)); } catch (error: any) { res.status(400).json({ error: error.message }); }
});

// Reports & Moderation
router.get('/reports', getReports);
router.post('/reports/:reportId/resolve', resolveReport);
router.post('/users/ban', banUser);
router.post('/users/unban', unbanUser);
router.post('/users/verify', verifyUser);
router.post('/users/suspend', suspendUser);
router.post('/users/restore', restoreUser);

// Withdrawals
router.get('/withdrawals', getWithdrawals);
router.post('/withdrawals/approve', approveWithdrawal);
router.post('/withdrawals/reject', rejectWithdrawal);

// Ad Campaign Management
router.post('/ads/campaigns', createCampaign);
router.put('/ads/campaigns/:campaignId', updateCampaign);
router.delete('/ads/campaigns/:campaignId', deleteCampaign);
router.get('/ads/campaigns/:campaignId', getCampaign);
router.get('/ads/campaigns', getCampaigns);
router.post('/ads/campaigns/:campaignId/pause', pauseCampaign);
router.post('/ads/campaigns/:campaignId/resume', resumeCampaign);
router.get('/ads/analytics', getAllAdsAnalytics);
router.get('/ads/analytics/:campaignId', getCampaignAnalytics);

// Platform Analytics
router.get('/analytics', getPlatformAnalytics);

// Platform Settings
router.get('/settings', getPlatformSettings);
router.put('/settings', updatePlatformSettings);

// System Logs
router.get('/system-logs', getSystemLogs);

// Audit Logs
router.get('/audit', getAuditLogs);

// Infrastructure
router.get('/infrastructure', getInfrastructure);

// Finance
router.get('/finance/transactions', getFinanceTransactions);

// Content moderation
router.get('/content', getContentItems);
router.post('/content/:queueId/review', reviewContentItem);

// Notification center
router.get('/notifications', getNotificationCenter);

// Live stream moderation
router.post('/live/:streamId/end', endLiveStream);
router.post('/live/:streamId/suspend', suspendLiveStream);

// Gold Verified Follower Rewards — admin dashboard + audit ledgers.
router.get('/follower-rewards/stats', getFollowerRewardStats);
router.get('/follower-rewards', listFollowerRewardCampaigns);
router.get('/follower-rewards/:campaignId', getFollowerRewardCampaign);
router.get('/follower-rewards/:campaignId/claims', getFollowerRewardClaims);
router.get('/follower-rewards/:campaignId/transactions', getFollowerRewardTransactions);

export default router;
