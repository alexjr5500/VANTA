import { prisma } from '../prisma';
import { verificationService } from './verification.service';
import { walletService, resolveAvailableCoins } from './wallet.service';
import { notificationService } from './notification.service';
import { auditLog } from '../security';

// ============================================================================
// GOLD VERIFIED FOLLOWER REWARDS â€” SERVICE
// ============================================================================
// Creator-side follower reward campaigns backed by the real wallet/ledger:
//   - Campaign creation is GOLD-gated, validated and ATOMIC: either the full
//     reservation + campaign + ledger row commit, or nothing does.
//   - Wallet reservation uses the existing `Wallet.lockedCoins` accounting
//     (available = coinBalance - lockedCoins) so reserved coins can never be
//     spent elsewhere (gift.service already follows this convention).
//   - Claims are IMMUTABLE and enforced at the database level:
//     UNIQUE(campaignId, userId). Unfollow -> refollow, double clicks,
//     multiple tabs/devices, network retries and concurrent requests can never
//     produce two rewards.
// ============================================================================

export const FOLLOWER_REWARD = {
  REWARD_TYPES: { COINS: 'COINS', GIFT: 'GIFT' },
  ELIGIBILITY: { NEW: 'NEW', EXISTING: 'EXISTING', ALL: 'ALL' },
  STATUS: {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    PAUSED: 'PAUSED',
    COMPLETED: 'COMPLETED',
    EXPIRED: 'EXPIRED',
    ENDED: 'ENDED',
    CANCELLED: 'CANCELLED',
  },
  /** Supported expiration windows (hours). Server-authoritative whitelist. */
  EXPIRATION_HOURS: [24, 72, 168, 720],
  /** Absolute upper bound for any integer allocation (overflow protection). */
  MAX_ALLOCATION: 100_000_000,
  MAX_TARGET_USERS: 1_000_000,
} as const;

export class FollowerRewardError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'FollowerRewardError';
  }
}

/** Internal retryable race â€” the claim collided with a concurrent claim. */
class RetryableClaimError extends Error {
  constructor() {
    super('Claim conflict, retrying');
    this.name = 'RetryableClaimError';
  }
}

export interface CreateCampaignInput {
  rewardType: 'COINS' | 'GIFT';
  totalCoins?: number;          // COINS: total allocation
  giftId?: string;              // GIFT: existing catalog gift id
  targetUsers: number;          // number of eligible followers
  eligibilityType: 'NEW' | 'EXISTING' | 'ALL';
  expiresInHours: number;       // 24 | 72 | 168 | 720
}
// ============================================================================
// SERIALIZATION
// ============================================================================

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** Campaign summary shape consumed by creator dashboards + admin. */
export function serializeCampaign(campaign: any) {
  const gift = campaign.gift
    ? {
        id: campaign.gift.id,
        slug: campaign.gift.slug,
        name: campaign.gift.name,
        emoji: campaign.gift.emoji,
        price: campaign.gift.price,
        thumbnailUrl: campaign.gift.thumbnailUrl,
        animationUrl: campaign.gift.animationUrl,
        animationType: campaign.gift.animationType,
        rarity: campaign.gift.rarity,
        tier: campaign.gift.tier,
        isActive: campaign.gift.isActive,
      }
    : null;
  return {
    id: campaign.id,
    creatorId: campaign.creatorId,
    creatorUsername: campaign.creator?.username || null,
    rewardType: campaign.rewardType,
    status: campaign.status,
    eligibilityType: campaign.eligibilityType,
    totalAllocation: campaign.totalAllocation,
    rewardPerUser: campaign.rewardPerUser,
    coinAmount: campaign.coinAmount,
    gift: gift,
    reservedAmount: campaign.reservedAmount,
    distributedAmount: campaign.distributedAmount,
    remainingAmount: campaign.remainingAmount,
    claimedUsers: campaign.claimedUsers,
    targetUsers: campaign.totalAllocation,
    startsAt: campaign.startsAt?.toISOString?.() || null,
    expiresAt: campaign.expiresAt?.toISOString?.() || null,
    completedAt: campaign.completedAt?.toISOString?.() || null,
    endedAt: campaign.endedAt?.toISOString?.() || null,
    pausedAt: campaign.pausedAt?.toISOString?.() || null,
    createdAt: campaign.createdAt?.toISOString?.() || null,
    updatedAt: campaign.updatedAt?.toISOString?.() || null,
    computed: {
      availableClaims: Math.max(0, Math.floor(campaign.remainingAmount / Math.max(1, campaign.rewardPerUser || 1))),
      progressPct: campaign.totalAllocation > 0
        ? Math.min(100, Math.round((campaign.claimedUsers / campaign.totalAllocation) * 100))
        : 0,
    },
  };
}

const CAMPAIGN_INCLUDE = {
  creator: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
  gift: { select: { id: true, slug: true, name: true, emoji: true, price: true, thumbnailUrl: true, animationUrl: true, animationType: true, rarity: true, tier: true, isActive: true } },
} as const;
// ============================================================================
// GOLD VERIFICATION GATE
// ============================================================================

/**
 * Follower Rewards is a GOLD-ONLY creator capability. A caller is treated as
 * Gold when the SAME server-side rule that gates Creator Studio grants it:
 * an ACTIVE (non-expired) GOLD VerificationBadge, a legacy server-verified
 * account (user.verified), or a privileged role. This reuses the existing
 * verification architecture instead of creating a parallel authorization
 * system, and is enforced on EVERY endpoint â€” never on the frontend.
 */
export async function requireGoldVerified(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      verified: true,
      role: true,
      verificationBadge: { select: { badgeType: true, status: true, expiresAt: true } },
    },
  });
  if (!user) {
    throw new FollowerRewardError(401, 'Account not found', 'UNAUTHENTICATED');
  }
  if (user.status !== 'ACTIVE') {
    throw new FollowerRewardError(403, user.status === 'SUSPENDED' ? 'Account suspended' : 'Account restricted', 'ACCOUNT_RESTRICTED');
  }

  const badgeActive =
    user.verificationBadge?.badgeType === 'GOLD' &&
    user.verificationBadge?.status === 'ACTIVE' &&
    (!user.verificationBadge?.expiresAt || new Date(user.verificationBadge.expiresAt).getTime() > Date.now());
  const role = (user.role || '').toUpperCase();
  const privilegedRole = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(role);

  if (!badgeActive && !user.verified && !privilegedRole) {
    throw new FollowerRewardError(403, 'Follower Rewards requires an active Gold Verified badge.', 'GOLD_REQUIRED');
  }
}

export class FollowerRewardService {
  // ================================================================
  // ATOMIC CAMPAIGN CREATION
  // ================================================================

  private async assertNoLiveCampaign(tx: any, creatorId: string): Promise<void> {
    const existing = await tx.followerRewardCampaign.findFirst({
      where: { creatorId, status: { in: ['DRAFT', 'ACTIVE', 'PAUSED'] } },
      select: { id: true },
    });
    if (existing) {
      throw new FollowerRewardError(
        409,
        'You already have an active reward. End or let it expire before creating a new one.',
        'ACTIVE_CAMPAIGN_EXISTS'
      );
    }
  }

  private resolveExpiry(expiresInHours: number): Date {
    if (!Number.isInteger(expiresInHours) || !FOLLOWER_REWARD.EXPIRATION_HOURS.includes(expiresInHours as any)) {
      throw new FollowerRewardError(400, 'Expiration must be 24, 72, 168 or 720 hours.', 'INVALID_EXPIRATION');
    }
    return new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  }

  private validateTargetUsers(targetUsers: unknown): number {
    const value = Number(targetUsers);
    if (!Number.isInteger(value) || value < 1) {
      throw new FollowerRewardError(400, 'Number of followers must be at least 1.', 'INVALID_RECIPIENT_COUNT');
    }
    if (value > FOLLOWER_REWARD.MAX_TARGET_USERS) {
      throw new FollowerRewardError(
        400,
        `Number of followers cannot exceed ${FOLLOWER_REWARD.MAX_TARGET_USERS.toLocaleString()}.`,
        'INVALID_RECIPIENT_COUNT'
      );
    }
    return value;
  }

  private validateCoins(totalCoins: unknown): number {
    const value = Number(totalCoins);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new FollowerRewardError(400, 'Total coins must be a positive whole number.', 'INVALID_ALLOCATION');
    }
    if (value > FOLLOWER_REWARD.MAX_ALLOCATION) {
      throw new FollowerRewardError(
        400,
        `Allocation cannot exceed ${FOLLOWER_REWARD.MAX_ALLOCATION.toLocaleString()} coins.`,
        'INVALID_ALLOCATION'
      );
    }
    return value;
  }

  private validateEligibility(value: unknown): 'NEW' | 'EXISTING' | 'ALL' {
    if (value !== 'NEW' && value !== 'EXISTING' && value !== 'ALL') {
      throw new FollowerRewardError(400, 'Eligibility must be NEW, EXISTING or ALL.', 'INVALID_ELIGIBILITY');
    }
    return value;
  }

  private resolveReward(input: CreateCampaignInput): {
    rewardPerUser: number;
    coinAmount: number | null;
    giftId: string | null;
  } {
    if (input.rewardType === 'COINS') {
      const totalCoins = this.validateCoins(input.totalCoins);
      const targetUsers = this.validateTargetUsers(input.targetUsers);
      // Integer reward rule: coins must divide EXACTLY across followers.
      // Never round, never lose coins, never create fractional rewards.
      if (totalCoins % targetUsers !== 0) {
        throw new FollowerRewardError(
          400,
          'Your total reward must divide evenly across the selected number of followers.',
          'FRACTIONAL_REWARD'
        );
      }
      return { rewardPerUser: totalCoins / targetUsers, coinAmount: totalCoins, giftId: null };
    }

    // GIFT reward â€” reuse the existing catalog (id/name/price/rarity/assets).
    const giftId = typeof input.giftId === 'string' && input.giftId.trim() ? input.giftId.trim() : null;
    if (!giftId) {
      throw new FollowerRewardError(400, 'A gift must be selected from the catalog.', 'GIFT_REQUIRED');
    }
    return { rewardPerUser: 0, coinAmount: null, giftId };
  }
// ================================================================
  // ATOMIC CAMPAIGN CREATION
  // ================================================================
  // Everything (gold check -> wallet availability -> reservation ->
  // campaign row -> ledger row) commits in ONE transaction. A failure at any
  // step leaves no partial state: no funds reserved without a campaign and no
  // campaign without its reservation.

  /**
   * Create + activate a campaign in one atomic transaction. The creator's
   * wallet must hold the full allocation in AVAILABLE coins (coinBalance -
   * lockedCoins); the allocation is then reserved via Wallet.lockedCoins so
   * those coins can never be spent elsewhere.
   */
  async createCampaign(userId: string, input: CreateCampaignInput, ipAddress?: string) {
    await requireGoldVerified(userId);

    const rewardType = String(input.rewardType || '').toUpperCase();
    if (rewardType !== 'COINS' && rewardType !== 'GIFT') {
      throw new FollowerRewardError(400, 'Reward type must be COINS or GIFT.', 'INVALID_REWARD_TYPE');
    }
    const normalized: CreateCampaignInput = { ...input, rewardType };
    const targetUsers = this.validateTargetUsers(normalized.targetUsers);
    const eligibilityType = this.validateEligibility(normalized.eligibilityType);
    const expiresAt = this.resolveExpiry(normalized.expiresInHours);
    const { rewardPerUser, coinAmount, giftId } = this.resolveReward(normalized);

    // Resolve gift cost from the REAL catalog (never trust the client price).
    let reservedAmount = rewardType === 'COINS' ? coinAmount! : 0;
    let rewardPerUserFinal = rewardPerUser;
    if (rewardType === 'GIFT') {
      const gift = await prisma.gift.findUnique({ where: { id: giftId } });
      if (!gift) throw new FollowerRewardError(400, 'Gift not found.', 'GIFT_UNAVAILABLE');
      if (!gift.isActive) throw new FollowerRewardError(400, 'This gift is no longer available.', 'GIFT_UNAVAILABLE');
      const cost = Number(gift.price);
      if (!Number.isSafeInteger(cost) || cost < 1 || cost > FOLLOWER_REWARD.MAX_ALLOCATION) {
        throw new FollowerRewardError(400, 'This gift cannot be used for a reward.', 'GIFT_UNAVAILABLE');
      }
      const total = cost * targetUsers;
      if (!Number.isSafeInteger(total) || total > FOLLOWER_REWARD.MAX_ALLOCATION) {
        throw new FollowerRewardError(400, 'This gift cannot be delivered to that many followers.', 'INVALID_ALLOCATION');
      }
      reservedAmount = total;
      rewardPerUserFinal = cost;
    }

    // Ensure the wallet exists and pre-check availability (authoritative
    // balance check â€” the client never decides how many coins exist).
    const wallet = await walletService.ensureWallet(userId);
    if (wallet.isFrozen) {
      throw new FollowerRewardError(403, 'Your wallet is frozen. Contact support.', 'WALLET_FROZEN');
    }
    const available = resolveAvailableCoins(wallet);
    if (available < reservedAmount) {
      throw new FollowerRewardError(
        400,
        `Insufficient balance. You have ${available.toLocaleString()} available but this reward needs ${reservedAmount.toLocaleString()}.`,
        'INSUFFICIENT_BALANCE'
      );
    }
const campaign = await prisma.$transaction(async (tx) => {
      await this.assertNoLiveCampaign(tx, userId);

      // Re-validate availability INSIDE the transaction with a compare-and-swap
      // so a concurrent spender cannot invalidate the reservation between the
      // pre-check and the write.
      const currentWallet = await tx.wallet.findUnique({ where: { userId } });
      if (!currentWallet || currentWallet.isFrozen) {
        throw new FollowerRewardError(403, 'Your wallet is unavailable.', 'WALLET_FROZEN');
      }
      if (resolveAvailableCoins(currentWallet) < reservedAmount) {
        throw new FollowerRewardError(400, 'Insufficient available coins.', 'INSUFFICIENT_BALANCE');
      }

      const reserved = await tx.wallet.updateMany({
        where: { id: currentWallet.id, isFrozen: false, coinBalance: currentWallet.coinBalance },
        data: { lockedCoins: { increment: reservedAmount } },
      });
      if (reserved.count !== 1) {
        throw new FollowerRewardError(409, 'Your balance changed while creating the reward. Please try again.', 'BALANCE_CHANGED');
      }

      const now = new Date();
      const created = await tx.followerRewardCampaign.create({
        data: {
          creatorId: userId,
          rewardType,
          status: 'ACTIVE',
          eligibilityType,
          totalAllocation: targetUsers,
          rewardPerUser: rewardPerUserFinal,
          coinAmount: rewardType === 'COINS' ? reservedAmount : null,
          giftId: rewardType === 'GIFT' ? giftId : null,
          reservedAmount,
          distributedAmount: 0,
          remainingAmount: reservedAmount,
          claimedUsers: 0,
          startsAt: now,
          expiresAt,
        },
      });

      // Traceable ledger entry documenting the reservation event.
      await tx.walletTransaction.create({
        data: {
          walletId: currentWallet.id,
          userId,
          type: 'FOLLOWER_REWARD_RESERVE',
          amount: reservedAmount,
          fee: 0,
          balanceBefore: currentWallet.coinBalance,
          balance: currentWallet.coinBalance,
          status: 'COMPLETED',
          description: `Reserved ${reservedAmount.toLocaleString()} VANTA Coins for a Follower Reward`,
          reference: created.id,
          metadata: JSON.stringify({ campaignId: created.id, rewardType, totalAllocation: targetUsers, side: 'creator' }),
        },
      });

      return created;
    });

    // Best-effort audit (never rollback on failure).
    try {
      await auditLog.log({
        userId,
        action: 'FOLLOWER_REWARD_CREATED',
        ipAddress,
        severity: 'INFO',
        metadata: { campaignId: campaign.id, rewardType, reservedAmount, totalAllocation: targetUsers, eligibilityType, expiresAt: expiresAt.toISOString() },
      });
    } catch (auditError) {
      console.error('Failed to write follower reward audit log', auditError);
    }

    return { campaign: await this.getCampaignDetail(campaign.id, userId) };
  }
// ================================================================
  // ELIGIBILITY (server-authoritative, powers the profile gift box)
  // ================================================================
  // Efficient: one indexed campaign lookup, one follow lookup, one claim
  // lookup. Never iterates follower sets and never trusts the client.

  /** True when the follow row satisfies the campaign's audience rule. */
  private eligibilityWindowOk(eligibilityType: string, follow: { createdAt: Date }, startsAt: Date | null): boolean {
    if (eligibilityType === 'ALL' || !startsAt) return true;
    const followedAt = follow.createdAt.getTime();
    const startedAt = startsAt.getTime();
    return eligibilityType === 'NEW' ? followedAt >= startedAt : followedAt <= startedAt;
  }

  /** Whether `viewerId` may claim the creator's active reward right now. */
  async getRewardAvailability(creatorId: string, viewerId?: string | null) {
    if (!viewerId) {
      return { available: false, reason: 'not-authenticated', campaign: null };
    }
    if (viewerId === creatorId) {
      return { available: false, reason: 'own-profile', campaign: null };
    }

    const now = new Date();
    const campaign = await prisma.followerRewardCampaign.findFirst({
      where: { creatorId, status: 'ACTIVE', expiresAt: { gt: now }, remainingAmount: { gt: 0 } },
      include: CAMPAIGN_INCLUDE,
    });
    if (!campaign) {
      return { available: false, reason: 'no-active-reward', campaign: null };
    }

    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: viewerId, followingId: creatorId } },
    });
    if (!follow) {
      return { available: false, reason: 'not-following', campaign: null };
    }
    if (!this.eligibilityWindowOk(campaign.eligibilityType, follow, campaign.startsAt)) {
      return { available: false, reason: 'not-eligible', campaign: null };
    }

    const claim = await prisma.followerRewardClaim.findUnique({
      where: { campaignId_userId: { campaignId: campaign.id, userId: viewerId } },
    });
    if (claim) {
      return { available: false, reason: 'already-claimed', campaign: null };
    }

    return { available: true, reason: null, campaign: serializeCampaign(campaign) };
  }

  /** Claim status for the current viewer (idempotent read). */
  async getClaimStatus(campaignId: string, userId: string) {
    const claim = await prisma.followerRewardClaim.findUnique({
      where: { campaignId_userId: { campaignId, userId } },
    });
    return {
      claimed: Boolean(claim),
      claim: claim
        ? {
            id: claim.id,
            campaignId: claim.campaignId,
            rewardType: claim.rewardType,
            coinAmount: claim.coinAmount,
            giftId: claim.giftId,
            giftSnapshot: parseJson<any>(claim.giftSnapshot),
            walletTransactionId: claim.walletTransactionId,
            status: claim.status,
            createdAt: claim.createdAt.toISOString(),
          }
        : null,
    };
  }
// ================================================================
  // ATOMIC CLAIM (double-claim proof)
  // ================================================================
  // A single database transaction does EVERYTHING:
  //   1. re-read campaign (fresh inside the tx)
  //   2. validate ACTIVE + not expired + remaining allocation
  //   3. CAS-decrement the remaining allocation (serializes two concurrent
  //      claimants reaching for the last reward)
  //   4. insert the claim row â€” UNIQUE(campaignId, userId) makes a second
  //      claim structurally impossible (unfollow -> refollow included)
  //   5. move the coins / create the GiftTransaction (existing inventory)
  //   6. write ledger rows (creator spend + claimant credit)
  //   7. auto-complete the campaign when the final reward is claimed
  // Any failure rolls back the entire transaction â€” never a partial payout.

  private async transferCoinReward(
    tx: any, campaign: any, claimId: string, creatorWallet: any, claimantWallet: any,
    campaignId: string, claimantId: string, rewardPerUser: number,
  ) {
    const creatorSpend = await tx.wallet.updateMany({
      where: { id: creatorWallet.id, isFrozen: false, coinBalance: { gte: rewardPerUser }, lockedCoins: { gte: rewardPerUser } },
      data: { coinBalance: { decrement: rewardPerUser }, lockedCoins: { decrement: rewardPerUser }, totalCoinsSent: { increment: rewardPerUser } },
    });
    if (creatorSpend.count !== 1) {
      throw new FollowerRewardError(409, 'The reward reservation is no longer available. Please try again.', 'RESERVATION_CHANGED');
    }
    const creatorAfter = await tx.wallet.findUniqueOrThrow({ where: { id: creatorWallet.id } });

    const claimantAfter = await tx.wallet.update({
      where: { id: claimantWallet.id },
      data: { coinBalance: { increment: rewardPerUser }, totalCoinsReceived: { increment: rewardPerUser }, lifetimeEarnings: { increment: rewardPerUser } },
    });

    // Creator spend ledger row (metadata.side = creator => displayed outgoing).
    await tx.walletTransaction.create({
      data: {
        walletId: creatorWallet.id,
        userId: campaign.creatorId,
        type: 'FOLLOWER_REWARD_CLAIM',
        amount: rewardPerUser,
        fee: 0,
        balanceBefore: creatorWallet.coinBalance,
        balance: creatorAfter.coinBalance,
        status: 'COMPLETED',
        description: `Follower Reward: ${rewardPerUser.toLocaleString()} VANTA Coins`,
        reference: claimId,
        metadata: JSON.stringify({ campaignId, claimantId, claimId, rewardPerUser, side: 'creator' }),
      },
    });

    // Claimant credit ledger row â€” appears in the existing Wallet history.
    const claimantTx = await tx.walletTransaction.create({
      data: {
        walletId: claimantWallet.id,
        userId: claimantId,
        type: 'FOLLOWER_REWARD_CLAIM',
        amount: rewardPerUser,
        fee: 0,
        balanceBefore: claimantWallet.coinBalance,
        balance: claimantAfter.coinBalance,
        status: 'COMPLETED',
        description: `Received ${rewardPerUser.toLocaleString()} VANTA Coins from a Follower Reward`,
        reference: campaignId,
        metadata: JSON.stringify({ campaignId, creatorId: campaign.creatorId, claimId, rewardPerUser, side: 'claimant' }),
      },
    });

    return claimantTx;
  }

  private async transferGiftReward(
    tx: any, campaign: any, claimId: string, creatorWallet: any, claimantWallet: any, gift: any,
  ) {
    const price = Number(gift.price);
    const creatorSpend = await tx.wallet.updateMany({
      where: { id: creatorWallet.id, isFrozen: false, coinBalance: { gte: price }, lockedCoins: { gte: price } },
      data: { coinBalance: { decrement: price }, lockedCoins: { decrement: price } },
    });
    if (creatorSpend.count !== 1) {
      throw new FollowerRewardError(409, 'The reward reservation is no longer available. Please try again.', 'RESERVATION_CHANGED');
    }
    const creatorAfter = await tx.wallet.findUniqueOrThrow({ where: { id: creatorWallet.id } });

    // The gift lands in the follower's EXISTING gift inventory/history
    // (GiftTransaction) exactly like any other gift.
    const giftTx = await tx.giftTransaction.create({
      data: {
        requestId: `follower-reward:${claimId}`,
        senderId: campaign.creatorId,
        receiverId: claimantWallet.userId,
        giftId: gift.id,
        amount: price,
        quantity: 1,
        message: 'Follower Reward',
        status: 'COMPLETED',
        isCombo: false,
        comboCount: 1,
        isAnon: false,
        isSuper: false,
      },
    });

    await tx.wallet.update({
      where: { id: claimantWallet.id },
      data: { totalGiftsReceived: { increment: 1 } },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: creatorWallet.id,
        userId: campaign.creatorId,
        type: 'FOLLOWER_REWARD_CLAIM',
        amount: price,
        fee: 0,
        balanceBefore: creatorWallet.coinBalance,
        balance: creatorAfter.coinBalance,
        status: 'COMPLETED',
        description: `Follower Reward: ${gift.name} gifted`,
        reference: claimId,
        metadata: JSON.stringify({ campaignId: campaign.id, claimantId: claimantWallet.userId, claimId, giftId: gift.id, side: 'creator' }),
      },
    });

    return { giftTransactionId: giftTx.id };
  }
private async attemptClaim(campaignId: string, claimantId: string): Promise<any> {
    const now = new Date();

    // Fast-path checks outside the transaction (before opening the write tx).
    const outside = await prisma.followerRewardCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, creatorId: true, status: true, expiresAt: true, remainingAmount: true },
    });
    if (!outside) {
      throw new FollowerRewardError(404, 'Reward not found.', 'CAMPAIGN_NOT_FOUND');
    }
    if (outside.creatorId === claimantId) {
      throw new FollowerRewardError(403, 'You cannot claim your own reward.', 'OWN_CAMPAIGN');
    }
    if (outside.status !== 'ACTIVE') {
      throw new FollowerRewardError(409, 'This reward is no longer accepting claims.', 'CAMPAIGN_CLOSED');
    }
    if (outside.expiresAt && new Date(outside.expiresAt).getTime() <= now.getTime()) {
      throw new FollowerRewardError(409, 'This reward has expired.', 'CAMPAIGN_EXPIRED');
    }
    if (outside.remainingAmount <= 0) {
      throw new FollowerRewardError(409, 'This reward has been fully claimed.', 'CAMPAIGN_COMPLETED');
    }

    return prisma.$transaction(async (tx) => {
      const campaign = await tx.followerRewardCampaign.findUnique({ where: { id: campaignId }, include: { gift: true } });
      if (!campaign) throw new FollowerRewardError(404, 'Reward not found.', 'CAMPAIGN_NOT_FOUND');
      if (campaign.status !== 'ACTIVE') {
        throw new FollowerRewardError(409, 'This reward is no longer accepting claims.', 'CAMPAIGN_CLOSED');
      }
      if (campaign.expiresAt && new Date(campaign.expiresAt).getTime() <= Date.now()) {
        throw new FollowerRewardError(409, 'This reward has expired.', 'CAMPAIGN_EXPIRED');
      }

      const cost = campaign.rewardPerUser;
      if (cost < 1 || campaign.remainingAmount < cost) {
        throw new FollowerRewardError(409, 'This reward has been fully claimed.', 'CAMPAIGN_COMPLETED');
      }

      // Follower relationship must exist RIGHT NOW (server-side). For NEW
      // campaigns the follow timestamp is also checked against campaign start.
      const follow = await tx.follow.findUnique({
        where: { followerId_followingId: { followerId: claimantId, followingId: campaign.creatorId } },
      });
      if (!follow) {
        throw new FollowerRewardError(403, 'You must follow this creator to claim the reward.', 'NOT_FOLLOWING');
      }
      if (!this.eligibilityWindowOk(campaign.eligibilityType, follow, campaign.startsAt)) {
        throw new FollowerRewardError(403, 'You are not eligible for this reward.', 'NOT_ELIGIBLE');
      }

      // Serialize concurrent claimants with a compare-and-swap decrement.
      const spent = await tx.followerRewardCampaign.updateMany({
        where: { id: campaignId, status: 'ACTIVE', expiresAt: { gt: now }, remainingAmount: campaign.remainingAmount },
        data: {
          remainingAmount: { decrement: cost },
          distributedAmount: { increment: cost },
          claimedUsers: { increment: 1 },
          ...(campaign.remainingAmount === cost ? { status: 'COMPLETED', completedAt: now } : {}),
        },
      });
      if (spent.count !== 1) {
        throw new RetryableClaimError();
      }

      let claimRow;
      try {
        // Database uniqueness guard â€” the second concurrent/double claim hits
        // P2002 here and the WHOLE transaction (including the decrement above)
        // rolls back. Unfollow -> refollow can never create a second claim.
        claimRow = await tx.followerRewardClaim.create({
          data: {
            campaignId,
            userId: claimantId,
            creatorId: campaign.creatorId,
            rewardType: campaign.rewardType,
            coinAmount: campaign.rewardType === 'COINS' ? cost : null,
            giftId: campaign.rewardType === 'GIFT' ? campaign.giftId : null,
            giftSnapshot:
              campaign.rewardType === 'GIFT' && campaign.gift
                ? JSON.stringify({ id: campaign.gift.id, slug: campaign.gift.slug, name: campaign.gift.name, emoji: campaign.gift.emoji, rarity: campaign.gift.rarity, tier: campaign.gift.tier })
                : null,
            status: 'COMPLETED',
          },
        });
      } catch (error: any) {
        if (error && typeof error === 'object' && error.code === 'P2002' && Array.isArray(error.meta?.target) && error.meta.target.includes('campaignId')) {
          throw new FollowerRewardError(409, 'Reward already claimed.', 'ALREADY_CLAIMED');
        }
        throw error;
      }

      const creatorWallet = await tx.wallet.findUnique({ where: { userId: campaign.creatorId } });
      const claimantWallet = await tx.wallet.findUnique({ where: { userId: claimantId } });
      if (!creatorWallet || creatorWallet.isFrozen || !claimantWallet || claimantWallet.isFrozen) {
        throw new FollowerRewardError(403, 'A wallet involved in this reward is frozen. Contact support.', 'WALLET_FROZEN');
      }

      let walletTransactionId: string | null = null;
      if (campaign.rewardType === 'GIFT' && campaign.gift) {
        const giftResult = await this.transferGiftReward(tx, campaign, claimRow.id, creatorWallet, claimantWallet, campaign.gift);
        walletTransactionId = giftResult.giftTransactionId;
      } else {
        const credit = await this.transferCoinReward(tx, campaign, claimRow.id, creatorWallet, claimantWallet, campaignId, claimantId, cost);
        walletTransactionId = credit.id;
      }

      await tx.followerRewardClaim.update({ where: { id: claimRow.id }, data: { walletTransactionId } });

      return {
        claimId: claimRow.id,
        campaignId,
        rewardType: campaign.rewardType,
        rewardPerUser: cost,
        gift: campaign.gift || null,
      };
    });
  }
/**
   * Public claim entry point with a bounded retry for legitimate concurrent
   * races (two users claiming the same remaining reward, network retries).
   * A repeated claim by the SAME user always resolves to ALREADY_CLAIMED via
   * the unique constraint.
   */
  async claimReward(campaignId: string, claimantId: string, ipAddress?: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await this.attemptClaim(campaignId, claimantId);

        // Quiet confirmation notification (primary discovery stays the gift box).
        try {
          await notificationService.createNotification(
            claimantId,
            'FOLLOWER_REWARD_CLAIMED',
            'Reward received',
            result.rewardType === 'GIFT' && result.gift
              ? `You received a ${result.gift.name} from a Follower Reward.`
              : `+${result.rewardPerUser.toLocaleString()} VANTA Coins added to your wallet.`,
            {
              actorId: null,
              campaignId: result.campaignId,
              claimId: result.claimId,
              rewardType: result.rewardType,
              referenceKey: `follower-reward-claim:${result.claimId}`,
            }
          );
        } catch (notificationError) {
          console.error('Failed to send follower reward claim notification', notificationError);
        }

        try {
          await auditLog.log({
            userId: claimantId,
            action: 'FOLLOWER_REWARD_CLAIMED',
            ipAddress,
            severity: 'INFO',
            metadata: { campaignId: result.campaignId, claimId: result.claimId, rewardType: result.rewardType, rewardPerUser: result.rewardPerUser },
          });
        } catch (auditError) {
          console.error('Failed to write follower reward claim audit log', auditError);
        }

        return result;
      } catch (error) {
        if (error instanceof RetryableClaimError) {
          continue;
        }
        throw error;
      }
    }
    throw new FollowerRewardError(409, 'Could not complete your claim. Please try again.', 'CLAIM_CONFLICT');
  }

  // ================================================================
  // CAMPAIGN LIFECYCLE (pause / resume / end / expire)
  // ================================================================

  /** Transition control for ACTIVE <-> PAUSED (reserved balance stays put). */
  async pauseCampaign(userId: string, campaignId: string, ipAddress?: string) {
    await requireGoldVerified(userId);
    const updated = await prisma.followerRewardCampaign.updateMany({
      where: { id: campaignId, creatorId: userId, status: 'ACTIVE' },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    if (updated.count !== 1) {
      const current = await prisma.followerRewardCampaign.findUnique({ where: { id: campaignId }, select: { creatorId: true, status: true } });
      if (!current) throw new FollowerRewardError(404, 'Reward not found.', 'CAMPAIGN_NOT_FOUND');
      if (current.creatorId !== userId) throw new FollowerRewardError(403, 'You can only manage your own rewards.', 'NOT_CREATOR');
      if (current.status !== 'ACTIVE') throw new FollowerRewardError(409, 'Only active rewards can be paused.', 'INVALID_TRANSITION');
    }
    this.auditLifecycle(userId, 'FOLLOWER_REWARD_PAUSED', campaignId, ipAddress);
    return { success: true, status: 'PAUSED' };
  }

  /** Resume a PAUSED campaign. No new allocation is ever created on resume. */
  async resumeCampaign(userId: string, campaignId: string, ipAddress?: string) {
    await requireGoldVerified(userId);

    // If the campaign crossed its expiry while paused, expire it instead.
    const current = await prisma.followerRewardCampaign.findUnique({
      where: { id: campaignId },
      select: { creatorId: true, status: true, expiresAt: true },
    });
    if (!current) throw new FollowerRewardError(404, 'Reward not found.', 'CAMPAIGN_NOT_FOUND');
    if (current.creatorId !== userId) throw new FollowerRewardError(403, 'You can only manage your own rewards.', 'NOT_CREATOR');
    if (current.status !== 'PAUSED') throw new FollowerRewardError(409, 'Only paused rewards can be resumed.', 'INVALID_TRANSITION');

    if (current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now()) {
      await this.expireCampaign(campaignId, ipAddress);
      throw new FollowerRewardError(409, 'This reward expired while paused.', 'CAMPAIGN_EXPIRED');
    }

    await prisma.followerRewardCampaign.update({
      where: { id: campaignId },
      data: { status: 'ACTIVE', pausedAt: null },
    });
    this.auditLifecycle(userId, 'FOLLOWER_REWARD_RESUMED', campaignId, ipAddress);
    return { success: true, status: 'ACTIVE' };
  }

  /**
   * Manually end a campaign. Claims stop immediately, unused reservation is
   * refunded to the creator's available balance with a ledger transaction.
   */
  async endCampaign(userId: string, campaignId: string, ipAddress?: string) {
    await requireGoldVerified(userId);
    const current = await prisma.followerRewardCampaign.findUnique({
      where: { id: campaignId },
      select: { creatorId: true, status: true },
    });
    if (!current) throw new FollowerRewardError(404, 'Reward not found.', 'CAMPAIGN_NOT_FOUND');
    if (current.creatorId !== userId) throw new FollowerRewardError(403, 'You can only manage your own rewards.', 'NOT_CREATOR');
    if (current.status !== 'ACTIVE' && current.status !== 'PAUSED') {
      throw new FollowerRewardError(409, 'This reward has already ended.', 'INVALID_TRANSITION');
    }

    const result = await this.finalizeCampaign(campaignId, 'ENDED', 'FOLLOWER_REWARD_REFUND', ipAddress);
    this.auditLifecycle(userId, 'FOLLOWER_REWARD_ENDED', campaignId, ipAddress);
    return result;
  }
/**
   * Atomically move a claimable campaign to a terminal status and refund the
   * entire remaining reservation to the creator's available balance.
   * `status` is EXPIRED or ENDED; `txType` picks the ledger transaction type.
   */
  private async finalizeCampaign(campaignId: string, status: string, txType: string, ipAddress?: string) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const campaign = await tx.followerRewardCampaign.findUnique({ where: { id: campaignId } });
      if (!campaign) throw new FollowerRewardError(404, 'Reward not found.', 'CAMPAIGN_NOT_FOUND');
      if (campaign.status !== 'ACTIVE' && campaign.status !== 'PAUSED') {
        // Already terminal â€” return the idempotent terminal state.
        return { success: true, status: campaign.status, remainingAmount: campaign.remainingAmount };
      }

      const refundAmount = campaign.remainingAmount;
      let refunded = 0;
      if (refundAmount > 0) {
        const wallet = await tx.wallet.findUnique({ where: { userId: campaign.creatorId } });
        if (wallet) {
          const released = await tx.wallet.updateMany({
            where: { id: wallet.id, lockedCoins: { gte: refundAmount } },
            data: { lockedCoins: { decrement: refundAmount } },
          });
          if (released.count !== 1) {
            throw new FollowerRewardError(409, 'Reservation could not be released. Please try again.', 'RESERVATION_CHANGED');
          }
          // Ledger: unused value returns to the creator's available balance.
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              userId: campaign.creatorId,
              type: txType,
              amount: refundAmount,
              fee: 0,
              balanceBefore: wallet.coinBalance,
              balance: wallet.coinBalance,
              status: 'COMPLETED',
              description:
                txType === 'FOLLOWER_REWARD_RELEASE'
                  ? `Follower Reward release: ${refundAmount.toLocaleString()} coins returned`
                  : `Follower Reward refund: ${refundAmount.toLocaleString()} coins returned`,
              reference: campaign.id,
              metadata: JSON.stringify({ campaignId: campaign.id, rewardType: campaign.rewardType, side: 'creator', phase: 'finalize' }),
            },
          });
          refunded = refundAmount;
        }
      }

      const updated = await tx.followerRewardCampaign.update({
        where: { id: campaignId },
        data: { status, endedAt: now, ...(status === 'EXPIRED' ? { completedAt: null } : {}) },
      });

      return {
        success: true,
        status: updated.status,
        refunded,
        remainingAmount: 0,
      };
    });
  }

  /** Expire a single campaign (used by the sweep and lazy expiration). */
  async expireCampaign(campaignId: string, ipAddress?: string) {
    const result = await this.finalizeCampaign(campaignId, 'EXPIRED', 'FOLLOWER_REWARD_REFUND', ipAddress);
    this.auditLifecycle(null, 'FOLLOWER_REWARD_EXPIRED', campaignId, ipAddress);
    return result;
  }

  /**
   * Expire all due campaigns (status ACTIVE/PAUSED and expiresAt <= now).
   * Runs on a background interval and lazily before reads/claims so expiration
   * is enforced even if the sweeper is ever down.
   */
  async expireDueCampaigns(now: Date = new Date()): Promise<number> {
    const due = await prisma.followerRewardCampaign.findMany({
      where: { status: { in: ['ACTIVE', 'PAUSED'] }, expiresAt: { lte: now } },
      select: { id: true },
      take: 500,
    });
    let processed = 0;
    for (const campaign of due) {
      try {
        await this.expireCampaign(campaign.id);
        processed += 1;
      } catch (error) {
        console.error(`Failed to expire follower reward campaign ${campaign.id}`, error);
      }
    }
    return processed;
  }

  private async auditLifecycle(userId: string | null, action: string, campaignId: string, ipAddress?: string) {
    try {
      await auditLog.log({ userId: userId || undefined, action, ipAddress, severity: 'INFO', metadata: { campaignId } });
    } catch (auditError) {
      console.error(`Failed to write ${action} audit log`, auditError);
    }
  }
// ================================================================
  // CREATOR QUERIES
  // ================================================================

  /**
   * Creator dashboard: verification state, real available balance, active
   * campaign (if any) with live progress, and recent history.
   */
  async getDashboard(userId: string) {
    await requireGoldVerified(userId);
    const wallet = await walletService.ensureWallet(userId);
    const available = resolveAvailableCoins(wallet);
    const active = await prisma.followerRewardCampaign.findFirst({
      where: { creatorId: userId, status: { in: ['ACTIVE', 'PAUSED'] } },
      include: CAMPAIGN_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const history = await prisma.followerRewardCampaign.findMany({
      where: { creatorId: userId, status: { notIn: ['ACTIVE', 'PAUSED'] } },
      include: CAMPAIGN_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      verified: await verificationService.getVerificationStatus(userId),
      wallet: {
        coinBalance: wallet.coinBalance,
        lockedCoins: wallet.lockedCoins,
        availableCoins: available,
      },
      activeCampaign: active ? serializeCampaign(active) : null,
      history: history.map(serializeCampaign),
    };
  }

  /** Get one campaign, scoped to the owner (or admin with `admin` flag). */
  async getCampaignDetail(campaignId: string, actorId?: string, opts: { admin?: boolean } = {}) {
    const campaign = await prisma.followerRewardCampaign.findUnique({
      where: { id: campaignId },
      include: { ...CAMPAIGN_INCLUDE, claims: { orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { id: true, username: true, fullName: true, avatar: true } } } } },
    });
    if (!campaign) throw new FollowerRewardError(404, 'Reward not found.', 'CAMPAIGN_NOT_FOUND');
    if (!opts.admin && actorId && campaign.creatorId !== actorId) {
      throw new FollowerRewardError(403, 'You can only view your own rewards.', 'NOT_CREATOR');
    }
    return {
      ...serializeCampaign(campaign),
      claims: campaign.claims.map((claim: any) => ({
        id: claim.id,
        userId: claim.userId,
        user: claim.user ? { id: claim.user.id, username: claim.user.username, fullName: claim.user.fullName, avatar: claim.user.avatar } : null,
        rewardType: claim.rewardType,
        coinAmount: claim.coinAmount,
        giftId: claim.giftId,
        giftSnapshot: parseJson<any>(claim.giftSnapshot),
        walletTransactionId: claim.walletTransactionId,
        status: claim.status,
        createdAt: claim.createdAt.toISOString(),
      })),
    };
  }

  /** Paginated claim ledger for a creator-owned campaign. */
  async getCampaignClaims(campaignId: string, actorId: string, opts: { page?: number; limit?: number; admin?: boolean } = {}) {
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50));
    const campaign = await prisma.followerRewardCampaign.findUnique({
      where: { id: campaignId },
      select: { creatorId: true },
    });
    if (!campaign) throw new FollowerRewardError(404, 'Reward not found.', 'CAMPAIGN_NOT_FOUND');
    if (!opts.admin && campaign.creatorId !== actorId) {
      throw new FollowerRewardError(403, 'You can only view your own rewards.', 'NOT_CREATOR');
    }
    const [claims, total] = await Promise.all([
      prisma.followerRewardClaim.findMany({
        where: { campaignId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, username: true, fullName: true, avatar: true } } },
      }),
      prisma.followerRewardClaim.count({ where: { campaignId } }),
    ]);
    return {
      claims: claims.map((claim: any) => ({
        id: claim.id,
        userId: claim.userId,
        user: claim.user ? { id: claim.user.id, username: claim.user.username, fullName: claim.user.fullName, avatar: claim.user.avatar } : null,
        rewardType: claim.rewardType,
        coinAmount: claim.coinAmount,
        giftId: claim.giftId,
        giftSnapshot: parseJson<any>(claim.giftSnapshot),
        walletTransactionId: claim.walletTransactionId,
        status: claim.status,
        createdAt: claim.createdAt.toISOString(),
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Reward history for the creator (non-terminal excluded). */
  async getHistory(userId: string) {
    await requireGoldVerified(userId);
    const history = await prisma.followerRewardCampaign.findMany({
      where: { creatorId: userId },
      include: CAMPAIGN_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return history.map(serializeCampaign);
  }
// ================================================================
  // ADMIN QUERIES (real data only â€” never mock numbers)
  // ================================================================

  async getAdminStats() {
    const [activeCampaigns, completedCampaigns, expiredCampaigns, totalClaims, coinsReserved, coinsDistributed, giftsDistributed] = await Promise.all([
      prisma.followerRewardCampaign.findMany({ where: { status: { in: ['ACTIVE', 'PAUSED'] } }, select: { id: true, status: true, remainingAmount: true } }),
      prisma.followerRewardCampaign.count({ where: { status: 'COMPLETED' } }),
      prisma.followerRewardCampaign.count({ where: { status: 'EXPIRED' } }),
      prisma.followerRewardClaim.count(),
      prisma.followerRewardCampaign.aggregate({ where: { status: { in: ['ACTIVE', 'PAUSED'] } }, _sum: { remainingAmount: true } }),
      prisma.followerRewardClaim.aggregate({ _sum: { coinAmount: true } }),
      prisma.followerRewardClaim.count({ where: { rewardType: 'GIFT' } }),
    ]);

    return {
      activeCampaigns: activeCampaigns.length,
      pausedCampaigns: activeCampaigns.filter((c: any) => c.status === 'PAUSED').length,
      coinsReserved: coinsReserved._sum.remainingAmount || 0,
      coinsDistributed: coinsDistributed._sum.coinAmount || 0,
      giftsDistributed: giftsDistributed,
      totalClaims,
      completedCampaigns,
      expiredCampaigns,
    };
  }

  async listAdminCampaigns(filters: { search?: string; rewardType?: string; status?: string; from?: string; to?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 50));
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.rewardType) where.rewardType = filters.rewardType;
    if (filters.search) {
      where.OR = [
        { id: { contains: filters.search } },
        { creator: { username: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(filters.from);
      if (filters.to) where.createdAt.lte = new Date(filters.to);
    }

    const [campaigns, total] = await Promise.all([
      prisma.followerRewardCampaign.findMany({
        where,
        include: CAMPAIGN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.followerRewardCampaign.count({ where }),
    ]);
    return { campaigns: campaigns.map(serializeCampaign), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async listAdminClaims(filters: { campaignId?: string; userId?: string; creatorId?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 50));
    const where: any = {};
    if (filters.campaignId) where.campaignId = filters.campaignId;
    if (filters.userId) where.userId = filters.userId;
    if (filters.creatorId) where.creatorId = filters.creatorId;

    const [claims, total] = await Promise.all([
      prisma.followerRewardClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, username: true, fullName: true, avatar: true } },
          campaign: { select: { id: true, rewardType: true, status: true } },
        },
      }),
      prisma.followerRewardClaim.count({ where }),
    ]);
    return {
      claims: claims.map((claim: any) => ({
        id: claim.id,
        campaignId: claim.campaignId,
        userId: claim.userId,
        user: claim.user ? { id: claim.user.id, username: claim.user.username, fullName: claim.user.fullName, avatar: claim.user.avatar } : null,
        campaign: claim.campaign ? { id: claim.campaign.id, rewardType: claim.campaign.rewardType, status: claim.campaign.status } : null,
        creatorId: claim.creatorId,
        rewardType: claim.rewardType,
        coinAmount: claim.coinAmount,
        giftId: claim.giftId,
        giftSnapshot: parseJson<any>(claim.giftSnapshot),
        walletTransactionId: claim.walletTransactionId,
        status: claim.status,
        createdAt: claim.createdAt.toISOString(),
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** WalletTransaction rows associated with a campaign (creator spend + reserve/refund). */
  async getCampaignTransactions(campaignId: string) {
    const transactions = await prisma.walletTransaction.findMany({
      where: { OR: [{ reference: campaignId }, { metadata: { contains: campaignId } }] },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return transactions.map((tx: any) => {
      let metadata: any = {};
      try { metadata = tx.metadata ? JSON.parse(tx.metadata) : {}; } catch { /* ignore */ }
      return {
        id: tx.id,
        userId: tx.userId,
        type: tx.type,
        amount: tx.amount,
        balance: tx.balance,
        balanceBefore: tx.balanceBefore,
        status: tx.status,
        description: tx.description,
        reference: tx.reference,
        metadata,
        createdAt: tx.createdAt.toISOString(),
      };
    });
  }
}

export const followerRewardService = new FollowerRewardService();
