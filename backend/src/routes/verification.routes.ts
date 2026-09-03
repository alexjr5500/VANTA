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
} from '../controllers/verification.controller';
import { authenticate, requireRole, Role } from '../security';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============================================================================
// USER ROUTES
// ============================================================================

// Get current user's verification status
router.get('/status', getVerificationStatus);

// Get available subscription plans
router.get('/plans', getSubscriptionPlans);

// Submit a verification request
router.post('/request', submitVerificationRequest);

// Subscribe to a creator membership plan
router.post('/subscribe', subscribeToPlan);

// Cancel current membership
router.post('/cancel', cancelMembership);

// Get verification history
router.get('/history', getVerificationHistory);

// Check creator studio access
router.get('/studio-access', checkStudioAccess);

// ============================================================================
// CRYPTO PAYMENT ROUTES
// ============================================================================

// Create a crypto payment
router.post('/crypto/payment', createCryptoPayment);

// Confirm a crypto payment
router.post('/crypto/confirm', confirmCryptoPayment);

// ============================================================================
// CRON / MAINTENANCE
// ============================================================================

// Expire overdue memberships (call via cron)
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

export default router;