import { Router } from 'express';
import {
  getVerificationStatus,
  getSubscriptionPlans,
  submitVerificationRequest,
  subscribeToPlan,
  cancelMembership,
  getVerificationHistory,
  checkStudioAccess,
  createCryptoPayment,
  confirmCryptoPayment,
  expireOverdue,
  getBadgePurchasePlans,
  initializeVerificationPurchase,
  verifyVerificationPurchase,
  getVerificationPurchases,
  verificationPurchaseWebhook,
  adminGetAllBadges,
  adminGetAllMemberships,
  adminGetPendingRequests,
  adminApproveVerification,
  adminRejectVerification,
  adminGrantBadge,
  adminRevokeBadge,
  adminSuspendSubscription,
  adminUpsertPlan,
  adminGetUserVerificationHistory,
  adminGetVerificationPurchases,
  adminVerificationPurchaseDashboard,
  adminRefundVerificationPurchase,
} from '../controllers/verification.controller';
import { authenticate, requireRole, Role } from '../security';
import { rateLimiter } from '../security/rateLimiter';

const router = Router();

// ============================================================================
// PUBLIC PROVIDER WEBHOOK (NO session — the provider authenticates via HMAC).
// The ONLY path that can activate a badge for a LIVE payment. Must be mounted
// BEFORE the authenticate guard below.
// ============================================================================
router.post('/purchase/webhook', rateLimiter.coinWebhook, verificationPurchaseWebhook);

// All remaining routes require authentication
router.use(authenticate);

// ============================================================================
// USER ROUTES
// ============================================================================

// Get current user's verification status
router.get('/status', getVerificationStatus);

// Get available subscription plans
router.get('/plans', getSubscriptionPlans);

// Get the Verified Badge purchase catalog (server-authoritative pricing)
router.get('/badge-plans', getBadgePurchasePlans);

// Submit a verification request
router.post('/request', submitVerificationRequest);

// Activate a creator/badge plan from a server-VERIFIED completed purchase
router.post('/subscribe', subscribeToPlan);

// Cancel current membership
router.post('/cancel', cancelMembership);

// Get verification history
router.get('/history', getVerificationHistory);

// Check creator studio access
router.get('/studio-access', checkStudioAccess);

// ============================================================================
// VERIFIED BADGE PURCHASE ROUTES (secure payment flow)
// ============================================================================

// Start a Verified Badge purchase (PENDING — never activates anything)
router.post('/purchase/init', rateLimiter.coinPurchase, initializeVerificationPurchase);

// Confirm / check a Verified Badge purchase payment
router.post('/purchase/verify', rateLimiter.coinPurchase, verifyVerificationPurchase);

// The authenticated user's Verified Badge purchase history
router.get('/purchases', getVerificationPurchases);

// ============================================================================
// CRYPTO PAYMENT ROUTES (legacy aliases that delegate to the secure flow)
// ============================================================================

// Create a crypto payment
router.post('/crypto/payment', createCryptoPayment);

// Confirm a crypto payment
router.post('/crypto/confirm', confirmCryptoPayment);

// ============================================================================
// CRON / MAINTENANCE
// ============================================================================

// Expire overdue memberships / paid badges / stale purchases (call via cron)
router.post('/expire-overdue', expireOverdue);

// ============================================================================
// ADMIN ROUTES
// ============================================================================

// All admin routes require ADMIN role
router.use(requireRole(Role.ADMIN, Role.SUPER_ADMIN));

// Get all badges
router.get('/admin/badges', adminGetAllBadges);

// Get all memberships
router.get('/admin/memberships', adminGetAllMemberships);

// Get pending verification requests
router.get('/admin/requests', adminGetPendingRequests);

// Approve a verification request
router.post('/admin/approve', adminApproveVerification);

// Reject a verification request
router.post('/admin/reject', adminRejectVerification);

// Grant a badge (blue or gold)
router.post('/admin/grant-badge', adminGrantBadge);

// Revoke a badge
router.post('/admin/revoke-badge', adminRevokeBadge);

// Suspend a subscription
router.post('/admin/suspend', adminSuspendSubscription);

// Create or update a subscription plan
router.post('/admin/plan', adminUpsertPlan);

// Get verification history for a specific user
router.get('/admin/history/:userId', adminGetUserVerificationHistory);

// Verified Badge purchase administration
router.get('/admin/purchases', adminGetVerificationPurchases);
router.get('/admin/purchases/dashboard', adminVerificationPurchaseDashboard);
router.post('/admin/purchases/:purchaseId/refund', adminRefundVerificationPurchase);

export default router;