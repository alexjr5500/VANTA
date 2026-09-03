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
 * Subscribe to a creator membership plan
 */
export const subscribeToPlan = async (
  token: string,
  data: { planId: string; paymentMethod?: string; paymentTxHash?: string }
): Promise<{ membership: CreatorMembership; plan: SubscriptionPlan }> => {
  return apiPost('/api/verification/subscribe', data, token);
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