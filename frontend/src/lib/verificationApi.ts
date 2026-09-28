import { apiGet, apiPost } from './apiClient';
import type { ApiResponse } from './api';

export interface VerificationStatus {
  hasBlueBadge: boolean;
  hasGoldBadge: boolean;
  badgeType: 'BLUE' | 'GOLD' | 'NONE';
  badgeStatus: 'ACTIVE' | 'REVOKED' | 'SUSPENDED' | 'EXPIRED' | null;
  membershipStatus: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED' | null;
  membershipPlan: string | null;
  expiryDate: string | null;
  renewalDate: string | null;
  canAccessCreatorStudio: boolean;
  subscriptionEndDate: string | null;
  // Paid Verified Badge info (server-authoritative)
  verificationExpiryDate: string | null;
  plan: {
    id: string;
    name: string;
    badgeType: string;
    durationMonths: number;
    price: number;
  } | null;
  purchaseReference: string | null;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  durationMonths: number;
  price: number;
  currency: string;
  description: string | null;
  benefits: string[];
  isActive: boolean;
  sortOrder: number;
  badgeType: string;
  savings: string | null;
}

export interface VerificationRequest {
  id: string;
  userId: string;
  requestType: string;
  status: string;
  documents?: string;
  notes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface CreatorMembership {
  id: string;
  userId: string;
  planId: string;
  status: string;
  startDate: string;
  endDate: string;
  renewalDate?: string;
  autoRenew: boolean;
  paymentMethod?: string;
  paymentTxHash?: string;
  plan?: SubscriptionPlan;
}

export interface VerificationHistory {
  id: string;
  userId: string;
  action: string;
  performedBy?: string;
  details?: string;
  createdAt: string;
}

export interface StudioAccess {
  allowed: boolean;
  status: VerificationStatus;
}

/**
 * Get current user's verification status
 */
export const getVerificationStatus = async (token: string): Promise<VerificationStatus> => {
  return apiGet<VerificationStatus>('/api/verification/status', token);
};

/**
 * Get available subscription plans
 */
export const getSubscriptionPlans = async (token: string): Promise<SubscriptionPlan[]> => {
  return apiGet<SubscriptionPlan[]>('/api/verification/plans', token);
};

/**
 * Submit a verification request
 */
export const submitVerificationRequest = async (
  token: string,
  data: { requestType: string; documents?: string; notes?: string }
): Promise<VerificationRequest> => {
  return apiPost<VerificationRequest>('/api/verification/request', data, token);
};

/**
 * Activate a creator/badge plan entitlement ONLY from a server-verified,
 * fully-paid purchase (idempotent replay is safe). A badge never activates
 * from a mere click — it requires purchaseId of a COMPLETED purchase.
 */
export const subscribeToPlan = async (
  token: string,
  purchaseId: string
): Promise<{ success: boolean; badge?: any; membership?: any; alreadyCompleted?: boolean }> => {
  return apiPost('/api/verification/subscribe', { purchaseId }, token);
};

/**
 * Cancel current membership
 */
export const cancelMembership = async (token: string): Promise<CreatorMembership> => {
  return apiPost<CreatorMembership>('/api/verification/cancel', {}, token);
};

/**
 * Get verification history
 */
export const getVerificationHistory = async (token: string): Promise<VerificationHistory[]> => {
  return apiGet<VerificationHistory[]>('/api/verification/history', token);
};

/**
 * Check creator studio access
 */
export const checkStudioAccess = async (token: string): Promise<StudioAccess> => {
  return apiGet<StudioAccess>('/api/verification/studio-access', token);
};

/**
 * Create a crypto payment
 */
export const createCryptoPayment = async (
  token: string,
  data: { planId: string; currency: 'USDT' | 'USDC'; network: 'BNB_SMART_CHAIN' | 'BASE'; walletAddress: string; amount: number }
): Promise<any> => {
  return apiPost('/api/verification/crypto/payment', data, token);
};

/**
 * Confirm a crypto payment
 */
export const confirmCryptoPayment = async (
  token: string,
  data: { paymentId: string; txHash: string }
): Promise<any> => {
  return apiPost('/api/verification/crypto/confirm', data, token);
};

// ============================================================================
// VERIFIED BADGE PURCHASE FLOW
// ============================================================================

export interface BadgePurchasePlan {
  id: string;
  name: string;
  badgeType: 'BLUE' | 'GOLD';
  durationMonths: number;
  durationLabel: string;
  priceUSD: number;
  description: string;
  benefits: string[];
  sortOrder: number;
}

export interface VerificationPurchaseInit {
  address: string;
  orderId: string;
  network: string;
  amount: number;
  currency: string;
  planId: string;
  planName: string;
  badgeType: 'BLUE' | 'GOLD';
  durationMonths: number;
  expiresIn: number;
  expiresAt: string;
  mode: 'test' | 'live';
  simulateToken?: string;
}

export interface VerificationPurchaseRecord {
  id: string;
  userId: string;
  planId: string;
  amount: number;
  currency: string;
  network: string | null;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';
  providerOrderId: string | null;
  providerReference: string | null;
  paymentMode: string | null;
  expiresAt: string;
  confirmedAt: string | null;
  createdAt: string;
  plan?: {
    id: string;
    name: string;
    badgeType: string;
    durationMonths: number;
    price: number;
  };
}

/**
 * Verified Badge purchase catalog (server-authoritative pricing).
 */
export const getBadgePurchasePlans = async (token: string): Promise<BadgePurchasePlan[]> => {
  return apiGet<BadgePurchasePlan[]>('/api/verification/badge-plans', token);
};

/**
 * Start a Verified Badge purchase (creates a PENDING order — never activates).
 */
export const initializeVerificationPurchase = async (
  token: string,
  data: { planId: string; network: string }
): Promise<VerificationPurchaseInit> => {
  return apiPost<VerificationPurchaseInit>('/api/verification/purchase/init', data, token);
};

/**
 * Confirm / poll a Verified Badge purchase.
 * Test mode: requires `testConfirmation: true` + the backend-issued
 * simulateToken. Live mode: returns `pending` until the provider webhook
 * verifies the payment server-side.
 */
export const verifyVerificationPurchase = async (
  token: string,
  data: { orderId: string; testConfirmation?: boolean; simulateToken?: string }
): Promise<any> => {
  return apiPost('/api/verification/purchase/verify', data, token);
};

/**
 * The authenticated user's Verified Badge purchase history.
 */
export const getVerificationPurchases = async (token: string): Promise<{
  purchases: VerificationPurchaseRecord[];
  total: number;
}> => {
  return apiGet('/api/verification/purchases', token);
};

/**
 * Re-activate the entitlement from one of the user's COMPLETED purchases
 * (idempotent; only a server-verified payment can reach COMPLETED).
 */
export const confirmVerificationPurchase = async (
  token: string,
  purchaseId: string
): Promise<any> => {
  return apiPost('/api/verification/subscribe', { purchaseId }, token);
};