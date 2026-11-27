import { Router } from 'express';
import {
  getVerificationStatus,
  getSubscriptionPlans,
  cancelMembership,
  getVerificationHistory,
  checkStudioAccess,
  expireOverdue,
  getBadgePurchasePlans,
  initializeVerificationPurchase, verifyVerificationPurchase,
  getVerificationPurchases,
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
import { authenticate, requireRole, requirePermission, requireAdminTwoFactorVerified, Permission, Role } from '../security';
import { rateLimiter } from '../security/rateLimiter';

import { shopSandboxEnabled } from '../config/shop-sandbox.config';

const router = Router();

// ============================================================================
// PUBLIC PROVIDER WEBHOOK (NO session — the provider authenticates via HMAC).
// The ONLY path that can activate a badge for a LIVE payment. Must be mounted
// BEFORE the authenticate guard below.
// ============================================================================
router.post('/purchase/webhook', rateLimiter.coinWebhook, (_req, res) => res.status(503).json({ code: 'VERIFICATION_UNDER_MAINTENANCE', error: 'Verification payments are temporarily under maintenance.' }));

// All remaining routes require authentication
router.use(authenticate);

const verificationUnderMaintenance = (_req: any, res: any) => res.status(503).json({
  code: 'VERIFICATION_UNDER_MAINTENANCE',
  error: 'Verification is temporarily under maintenance. Please try again later.',
});

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
router.post('/request', verificationUnderMaintenance);

// Activate a creator/badge plan from a server-VERIFIED completed purchase
router.post('/subscribe', verificationUnderMaintenance);

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
router.post('/purchase/init', rateLimiter.otp, (req, res) => shopSandboxEnabled() ? initializeVerificationPurchase(req, res) : verificationUnderMaintenance(req, res));

// Confirm / check a Verified Badge purchase payment
router.post('/purchase/verify', rateLimiter.otp, (req, res) => shopSandboxEnabled() ? verifyVerificationPurchase(req, res) : verificationUnderMaintenance(req, res));

// The authenticated user's Verified Badge purchase history
router.get('/purchases', getVerificationPurchases);

// ============================================================================
// CRYPTO PAYMENT ROUTES (legacy aliases that delegate to the secure flow)
// ============================================================================

// Create a crypto payment
router.post('/crypto/payment', verificationUnderMaintenance);

// Confirm a crypto payment
router.post('/crypto/confirm', verificationUnderMaintenance);

// ============================================================================
// CRON / MAINTENANCE
// ============================================================================

// ============================================================================
// ADMIN ROUTES
// ============================================================================

// All admin routes require ADMIN role
router.use(requireRole(Role.ADMIN, Role.CEO, Role.SUPER_ADMIN));
router.use(requireAdminTwoFactorVerified);
router.use(requirePermission(Permission.MANAGE_VERIFICATION));

// Maintenance is privileged; scheduled callers must use an admin service identity.
router.post('/expire-overdue', expireOverdue);

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