import { Router } from 'express';
import { rateLimiter, AuthenticatedRequest } from '../security';
import { treasuryDashboard, authorizeTreasuryTransfer, recordTreasuryBroadcast, verifyTreasuryTransfer } from '../services/shop-treasury.service';
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
  // Verification plan management
  getVerificationState,
  assignVerification,
  removeVerification,
  // Appeal review
  getAppeals,
  getAppealsForUser,
  reviewAppealStatus,
  decideAppeal,
} from '../controllers/admin.controller';
import { authenticate, requireRole, requirePermission, requireAdminTwoFactorVerified, Permission, Role } from '../security';
import { giftService, GiftCatalogInput } from '../services/gift.service';
import { secureExistingPrivateCloudinaryAssets } from '../services/upload.service';

const router = Router();

// All admin routes require authentication + ADMIN role
router.use(authenticate);
router.use(requireRole(Role.ADMIN, Role.CEO, Role.SUPER_ADMIN, Role.MODERATOR));
router.use(requireAdminTwoFactorVerified);
const treasuryRole = requireRole(Role.CEO, Role.SUPER_ADMIN);
router.get('/treasury', treasuryRole, requirePermission(Permission.VIEW_WALLET), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(await treasuryDashboard(typeof req.query.cursor === 'string' ? req.query.cursor : undefined)); }
  catch { res.status(503).json({ error: 'Treasury data unavailable' }); }
});
router.post('/treasury/authorize', treasuryRole, requirePermission(Permission.MANAGE_PAYMENTS), rateLimiter.otp, async (req: AuthenticatedRequest, res) => {
  try { res.status(201).json(await authorizeTreasuryTransfer(req.user!.userId, req.body || {})); }
  catch (e) { res.status(400).json({ error: e instanceof Error && e.message.length < 160 && !/prisma|database|constraint/i.test(e.message) ? e.message : 'Treasury authorization failed' }); }
});
router.post('/treasury/:id/broadcast', treasuryRole, requirePermission(Permission.MANAGE_PAYMENTS), rateLimiter.otp, async (req: AuthenticatedRequest, res) => {
  try { res.json(await recordTreasuryBroadcast(req.user!.userId, req.params.id, req.body || {})); }
  catch (e) { res.status(400).json({ error: e instanceof Error && e.message.length < 160 && !/prisma|database|constraint/i.test(e.message) ? e.message : 'Broadcast record failed' }); }
});
router.post('/treasury/:id/verify', treasuryRole, requirePermission(Permission.MANAGE_PAYMENTS), rateLimiter.otp, async (req: AuthenticatedRequest, res) => {
  try { res.json(await verifyTreasuryTransfer(req.user!.userId, req.params.id)); }
  catch { res.status(400).json({ error: 'Transfer not independently verified. Retry or reconcile externally.' }); }
});


// One-time migration: convert legacy public message assets to authenticated Cloudinary assets.
router.post('/security/secure-private-media', requirePermission(Permission.SYSTEM_MAINTENANCE), async (_req, res, next) => {
  try {
    const result = await secureExistingPrivateCloudinaryAssets();
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// Dashboard
router.get('/stats', requirePermission(Permission.VIEW_ADMIN_DASHBOARD), getDashboardStats);

// User Management
router.get('/users', requirePermission(Permission.READ_USER), getUsers);
router.get('/users/manage', requirePermission(Permission.UPDATE_USER), getUserManagement);
router.put('/users/role', requirePermission(Permission.MANAGE_ROLES), updateUserRole);
router.delete('/users/:userId', requirePermission(Permission.DELETE_USER), deleteUser);
router.get('/users/search', requirePermission(Permission.READ_USER), searchUsers);

// Creator Management
router.get('/creators', requirePermission(Permission.READ_CREATORS), getCreators);
router.post('/creators/:creatorId/verify', requirePermission(Permission.MANAGE_CREATORS), verifyCreator);
router.post('/creators/:creatorId/monetization', requirePermission(Permission.MANAGE_CREATORS), toggleMonetization);
router.post('/creators/:creatorId/subscription-approve', requirePermission(Permission.MANAGE_CREATORS), approveSubscription);

// Community Management
router.get('/communities', requirePermission(Permission.READ_COMMUNITIES), getCommunities);

// Live Stream Moderation
router.get('/live', requirePermission(Permission.MODERATE_STREAM), getLiveStreams);

// Wallet Management
router.get('/wallet/transactions', requirePermission(Permission.VIEW_WALLET), getWalletTransactions);
router.get('/wallet/all-transactions', requirePermission(Permission.VIEW_WALLET), getAllTransactions);
router.get('/wallet/deposits', requirePermission(Permission.VIEW_WALLET), getAllDeposits);
router.get('/wallet/transfers', requirePermission(Permission.VIEW_WALLET), getAllTransfers);
router.get('/wallet/gifts', requirePermission(Permission.VIEW_WALLET), getAllGifts);
router.get('/wallet/withdrawals', requirePermission(Permission.VIEW_WALLET), getAllWithdrawals);
router.post('/wallet/freeze', requirePermission(Permission.MANAGE_WALLET), freezeWallet);
router.post('/wallet/unfreeze', requirePermission(Permission.MANAGE_WALLET), unfreezeWallet);
router.post('/wallet/reverse', requirePermission(Permission.MANAGE_WALLET), reverseTransaction);
router.post('/wallet/flag', requirePermission(Permission.MANAGE_WALLET), flagSuspiciousAccount);
router.get('/wallet/analytics', requirePermission(Permission.VIEW_WALLET), getWalletAnalytics);

// Coin Management
router.get('/coins', requirePermission(Permission.READ_COINS), getCoinManagement);

// Coin payment dashboard (VANTA Coin purchase analytics + refunds)
router.get('/coin-payments', requirePermission(Permission.VIEW_WALLET), getCoinPaymentsDashboard);
router.get('/coin-payments/list', requirePermission(Permission.VIEW_WALLET), listCoinPayments);
router.post('/coin-payments/:orderId/refund', requirePermission(Permission.MANAGE_PAYMENTS), refundCoinPurchase);

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
router.get('/gifts', requirePermission(Permission.READ_GIFTS), async (_req, res) => {
  try { res.json(await giftService.listAllGifts()); } catch (error: any) { res.status(400).json({ error: error.message }); }
});
router.post('/gifts', requirePermission(Permission.MANAGE_GIFTS), async (req, res) => {
  try {
    const input = parseGiftInput(req.body || {}, true) as GiftCatalogInput & { slug: string; name: string; price: number };
    res.status(201).json(await giftService.createGift(input));
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});
router.put('/gifts/:giftId', requirePermission(Permission.MANAGE_GIFTS), async (req, res) => {
  try { res.json(await giftService.updateGift(req.params.giftId, parseGiftInput(req.body || {}))); } catch (error: any) { res.status(400).json({ error: error.message }); }
});
router.post('/gifts/:giftId/toggle', requirePermission(Permission.MANAGE_GIFTS), async (req, res) => {
  try { res.json(await giftService.toggleGift(req.params.giftId)); } catch (error: any) { res.status(400).json({ error: error.message }); }
});
router.delete('/gifts/:giftId', requirePermission(Permission.MANAGE_GIFTS), async (req, res) => {
  try { res.json(await giftService.deleteGift(req.params.giftId)); } catch (error: any) { res.status(400).json({ error: error.message }); }
});

// Reports & Moderation
router.get('/reports', requirePermission(Permission.VIEW_REPORTS), getReports);
router.post('/reports/:reportId/resolve', requirePermission(Permission.RESOLVE_REPORTS), resolveReport);
router.post('/users/ban', requirePermission(Permission.MODERATE_USERS), banUser);
router.post('/users/unban', requirePermission(Permission.MODERATE_USERS), unbanUser);
router.post('/users/verify', requirePermission(Permission.MANAGE_VERIFICATION), verifyUser);
router.post('/users/suspend', requirePermission(Permission.MODERATE_USERS), suspendUser);
router.post('/users/restore', requirePermission(Permission.MODERATE_USERS), restoreUser);

// Verification plan management (admin-only). Verification badges and account
// moderation are separate concerns: these endpoints never change user.status.
router.get('/users/verification/:userId', requirePermission(Permission.MANAGE_VERIFICATION), getVerificationState);
router.get('/users/verification', requirePermission(Permission.MANAGE_VERIFICATION), getVerificationState);
router.post('/users/verification', requirePermission(Permission.MANAGE_VERIFICATION), assignVerification);
router.post('/users/verification/remove', requirePermission(Permission.MANAGE_VERIFICATION), removeVerification);

// Appeal review (admin-only). Decisions persist to the database; approval
// restores an account only when the admin explicitly requests it.
router.get('/appeals', requirePermission(Permission.VIEW_REPORTS), getAppeals);
router.get('/appeals/user/:userId', requirePermission(Permission.VIEW_REPORTS), getAppealsForUser);
router.post('/appeals/:appealId/under-review', requirePermission(Permission.RESOLVE_REPORTS), reviewAppealStatus);
router.post('/appeals/:appealId/decision', requirePermission(Permission.MODERATE_USERS), decideAppeal);

// Withdrawals
router.get('/withdrawals', requirePermission(Permission.VIEW_WALLET), getWithdrawals);
router.post('/withdrawals/approve', requirePermission(Permission.PROCESS_WITHDRAWALS), approveWithdrawal);
router.post('/withdrawals/reject', requirePermission(Permission.PROCESS_WITHDRAWALS), rejectWithdrawal);

// Ad Campaign Management
router.post('/ads/campaigns', requirePermission(Permission.MANAGE_ADS), createCampaign);
router.put('/ads/campaigns/:campaignId', requirePermission(Permission.MANAGE_ADS), updateCampaign);
router.delete('/ads/campaigns/:campaignId', requirePermission(Permission.MANAGE_ADS), deleteCampaign);
router.get('/ads/campaigns/:campaignId', requirePermission(Permission.READ_ADS), getCampaign);
router.get('/ads/campaigns', requirePermission(Permission.READ_ADS), getCampaigns);
router.post('/ads/campaigns/:campaignId/pause', requirePermission(Permission.MANAGE_ADS), pauseCampaign);
router.post('/ads/campaigns/:campaignId/resume', requirePermission(Permission.MANAGE_ADS), resumeCampaign);
router.get('/ads/analytics', requirePermission(Permission.VIEW_ANALYTICS), getAllAdsAnalytics);
router.get('/ads/analytics/:campaignId', requirePermission(Permission.VIEW_ANALYTICS), getCampaignAnalytics);

// Platform Analytics
router.get('/analytics', requirePermission(Permission.VIEW_ANALYTICS), getPlatformAnalytics);

// Platform Settings
router.get('/settings', requirePermission(Permission.MANAGE_SETTINGS), getPlatformSettings);
router.put('/settings', requirePermission(Permission.MANAGE_SETTINGS), updatePlatformSettings);

// System Logs
router.get('/system-logs', requirePermission(Permission.VIEW_SYSTEM_LOGS), getSystemLogs);

// Audit Logs
router.get('/audit', requirePermission(Permission.VIEW_AUDIT_LOGS), getAuditLogs);

// Infrastructure
router.get('/infrastructure', requirePermission(Permission.VIEW_SYSTEM_HEALTH), getInfrastructure);

// Finance
router.get('/finance/transactions', requirePermission(Permission.VIEW_TRANSACTIONS), getFinanceTransactions);

// Content moderation
router.get('/content', requirePermission(Permission.MODERATE_CONTENT), getContentItems);
router.post('/content/:queueId/review', requirePermission(Permission.MODERATE_CONTENT), reviewContentItem);

// Notification center
router.get('/notifications', requirePermission(Permission.MANAGE_NOTIFICATIONS), getNotificationCenter);

// Live stream moderation
router.post('/live/:streamId/end', requirePermission(Permission.MODERATE_STREAM), endLiveStream);
router.post('/live/:streamId/suspend', requirePermission(Permission.MODERATE_STREAM), suspendLiveStream);

// Gold Verified Follower Rewards — admin dashboard + audit ledgers.
router.get('/follower-rewards/stats', requirePermission(Permission.VIEW_FOLLOWER_REWARDS), getFollowerRewardStats);
router.get('/follower-rewards', requirePermission(Permission.VIEW_FOLLOWER_REWARDS), listFollowerRewardCampaigns);
router.get('/follower-rewards/:campaignId', requirePermission(Permission.VIEW_FOLLOWER_REWARDS), getFollowerRewardCampaign);
router.get('/follower-rewards/:campaignId/claims', requirePermission(Permission.VIEW_FOLLOWER_REWARDS), getFollowerRewardClaims);
router.get('/follower-rewards/:campaignId/transactions', requirePermission(Permission.VIEW_FOLLOWER_REWARDS), getFollowerRewardTransactions);

export default router;
