import { apiGet, apiPost } from './apiClient';

// ============================================================================
// GOLD VERIFIED FOLLOWER REWARDS — API CLIENT
// ============================================================================
// Typed client for the backend /api/follower-rewards surface. Every endpoint
// re-validates the Gold gate and wallet availability server-side; this module
// only mirrors the wire shapes (see backend follower-reward.service.ts).

export type FollowerRewardType = 'COINS' | 'GIFT';
export type FollowerRewardEligibility = 'NEW' | 'EXISTING' | 'ALL';
export type FollowerRewardStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'ENDED'
  | 'CANCELLED';

export interface FollowerRewardGiftRef {
  id: string;
  slug?: string | null;
  name: string;
  emoji?: string | null;
  price: number;
  thumbnailUrl?: string | null;
  animationUrl?: string | null;
  rarity?: string | null;
  tier?: string | null;
  isActive?: boolean;
}

export interface FollowerRewardCampaign {
  id: string;
  creatorId: string;
  creatorUsername?: string | null;
  rewardType: FollowerRewardType;
  status: FollowerRewardStatus;
  eligibilityType: FollowerRewardEligibility;
  totalAllocation: number;
  rewardPerUser: number;
  coinAmount: number | null;
  gift: FollowerRewardGiftRef | null;
  reservedAmount: number;
  distributedAmount: number;
  remainingAmount: number;
  claimedUsers: number;
  targetUsers: number;
  startsAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  endedAt: string | null;
  pausedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  computed: { availableClaims: number; progressPct: number };
}

export type RewardUnavailableReason =
  | 'not-authenticated'
  | 'own-profile'
  | 'no-active-reward'
  | 'not-following'
  | 'not-eligible'
  | 'already-claimed'
  | null;

export interface RewardAvailability {
  available: boolean;
  reason: RewardUnavailableReason;
  campaign: FollowerRewardCampaign | null;
}

export interface FollowerRewardClaimUser {
  id: string;
  username: string;
  fullName: string | null;
  avatar: string | null;
}

export interface FollowerRewardClaimRecord {
  id: string;
  campaignId: string;
  userId?: string;
  user?: FollowerRewardClaimUser | null;
  rewardType: FollowerRewardType;
  coinAmount: number | null;
  giftId: string | null;
  giftSnapshot: {
    name?: string;
    emoji?: string | null;
    slug?: string | null;
    price?: number;
    thumbnailUrl?: string | null;
  } | null;
  walletTransactionId: string | null;
  status: string;
  createdAt: string;
}

export interface FollowerRewardClaimStatus {
  claimed: boolean;
  claim: FollowerRewardClaimRecord | null;
}

export interface FollowerRewardDashboard {
  verified: unknown;
  wallet: { coinBalance: number; lockedCoins: number; availableCoins: number };
  activeCampaign: FollowerRewardCampaign | null;
  history: FollowerRewardCampaign[];
}

export interface CreateFollowerRewardInput {
  rewardType: FollowerRewardType;
  /** COINS: total allocation (must divide evenly across targetUsers). */
  totalCoins?: number;
  /** GIFT: existing catalog gift id (server resolves price). */
  giftId?: string;
  targetUsers: number;
  eligibilityType: FollowerRewardEligibility;
  /** 24 | 72 | 168 | 720 (server-authoritative whitelist). */
  expiresInHours: number;
}

export interface RewardClaimsPage {
  claims: FollowerRewardClaimRecord[];
  total: number;
  page: number;
  pages: number;
}

// ============================================================================
// PROFILE GIFT BOX (viewer-facing)
// ============================================================================

/** Whether the current viewer can claim this creator's ACTIVE reward right now. */
export const getRewardAvailability = (
  token: string | null | undefined,
  creatorUsername: string,
): Promise<RewardAvailability> => {
  return apiGet<RewardAvailability>(
    `/api/follower-rewards/availability/${encodeURIComponent(creatorUsername.replace(/^@/, ''))}`,
    token || undefined,
    { skipCache: true },
  );
};

/** Idempotent claim status for a campaign (safe to poll). */
export const getRewardClaimStatus = (
  token: string,
  campaignId: string,
): Promise<FollowerRewardClaimStatus> => {
  return apiGet<FollowerRewardClaimStatus>(`/api/follower-rewards/${campaignId}/status`, token, {
    skipCache: true,
  });
};

/** Claim the reward. Server re-checks follow + eligibility + allocation. */
export const claimFollowerReward = (
  token: string,
  campaignId: string,
): Promise<{
  success: boolean;
  claimId: string;
  campaignId: string;
  rewardType: FollowerRewardType;
  rewardPerUser: number;
  gift?: FollowerRewardGiftRef | null;
}> => {
  return apiPost(`/api/follower-rewards/${campaignId}/claim`, {}, token);
};
// ============================================================================
// CREATOR STUDIO (Gold-gated server-side)
// ============================================================================

/** Creator dashboard: wallet + active campaign + recent history. */
export const getFollowerRewardDashboard = (token: string): Promise<FollowerRewardDashboard> => {
  return apiGet<FollowerRewardDashboard>('/api/follower-rewards/me', token, { skipCache: true });
};

/** Create + activate a campaign (atomic reservation + ledger). */
export const createFollowerRewardCampaign = (
  token: string,
  input: CreateFollowerRewardInput,
): Promise<{ campaign: FollowerRewardCampaign }> => {
  return apiPost('/api/follower-rewards', input, token);
};

export const getFollowerRewardHistory = (
  token: string,
): Promise<{ history: FollowerRewardCampaign[] }> => {
  return apiGet('/api/follower-rewards/history', token, { skipCache: true });
};

export const getFollowerRewardCampaign = (
  token: string,
  campaignId: string,
): Promise<FollowerRewardCampaign> => {
  return apiGet(`/api/follower-rewards/${campaignId}`, token);
};

export const getFollowerRewardClaims = (
  token: string,
  campaignId: string,
  page = 1,
  limit = 50,
): Promise<RewardClaimsPage> => {
  return apiGet(
    `/api/follower-rewards/${campaignId}/claims?page=${page}&limit=${limit}`,
    token,
    { skipCache: true },
  );
};

export const pauseFollowerRewardCampaign = (token: string, campaignId: string) => {
  return apiPost(`/api/follower-rewards/${campaignId}/pause`, {}, token);
};

export const resumeFollowerRewardCampaign = (token: string, campaignId: string) => {
  return apiPost(`/api/follower-rewards/${campaignId}/resume`, {}, token);
};

export const endFollowerRewardCampaign = (token: string, campaignId: string) => {
  return apiPost(`/api/follower-rewards/${campaignId}/end`, {}, token);
};

// ============================================================================
// ADMIN (read-only audit surfaces)
// ============================================================================

export interface FollowerRewardAdminStats {
  activeCampaigns: number;
  pausedCampaigns: number;
  coinsReserved: number;
  coinsDistributed: number;
  giftsDistributed: number;
  totalClaims: number;
  completedCampaigns: number;
  expiredCampaigns: number;
}

export interface FollowerRewardAdminCampaignPage {
  campaigns: FollowerRewardCampaign[];
  total: number;
  page: number;
  pages: number;
}

export interface FollowerRewardTransactionRow {
  id: string;
  userId: string;
  type: string;
  amount: number;
  balance: number;
  balanceBefore: number;
  status: string;
  description: string;
  reference: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export const getAdminFollowerRewardStats = (token: string): Promise<FollowerRewardAdminStats> => {
  return apiGet('/api/admin/follower-rewards/stats', token, { skipCache: true });
};

export const listAdminFollowerRewardCampaigns = (
  token: string,
  params: { search?: string; rewardType?: string; status?: string; page?: number; limit?: number } = {},
): Promise<FollowerRewardAdminCampaignPage> => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== '') as [string, string][],
  ).toString();
  return apiGet(`/api/admin/follower-rewards${query ? `?${query}` : ''}`, token, { skipCache: true });
};

export const getAdminFollowerRewardCampaign = (
  token: string,
  campaignId: string,
): Promise<FollowerRewardCampaign> => {
  return apiGet(`/api/admin/follower-rewards/${campaignId}`, token, { skipCache: true });
};

export const getAdminFollowerRewardClaims = (
  token: string,
  campaignId: string,
): Promise<RewardClaimsPage> => {
  return apiGet(`/api/admin/follower-rewards/${campaignId}/claims`, token, { skipCache: true });
};

export const getAdminFollowerRewardTransactions = (
  token: string,
  campaignId: string,
): Promise<{ transactions: FollowerRewardTransactionRow[] }> => {
  return apiGet(`/api/admin/follower-rewards/${campaignId}/transactions`, token, { skipCache: true });
};