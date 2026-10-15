import { prisma } from '../prisma';
import { v4 as uuidv4 } from 'uuid';
import { verificationPaymentService } from './verification-payment.service';

// ============================================================================
// ADMIN VERIFICATION PLANS
// ----------------------------------------------------------------------------
// The four (and only four) verification plans VANTA administrators can assign.
// Durations are fixed product decisions — never invented at runtime. Expiry is
// computed with calendar-month/year arithmetic on the server so a 1-month plan
// is exactly one calendar month from assignment (never a flat 30 days).
// ============================================================================
export type VerificationPlanKey =
  | 'BLUE_1_MONTH'
  | 'BLUE_3_MONTHS'
  | 'BLUE_6_MONTHS'
  | 'GOLD_1_YEAR';

export interface VerificationPlanDefinition {
  key: VerificationPlanKey;
  badgeType: 'BLUE' | 'GOLD';
  label: string;
  durationLabel: string;
  /** Calendar months added to the assignment timestamp. */
  durationMonths: number;
}

export const VERIFICATION_PLANS: Record<VerificationPlanKey, VerificationPlanDefinition> = {
  BLUE_1_MONTH: { key: 'BLUE_1_MONTH', badgeType: 'BLUE', label: 'Blue Verified', durationLabel: '1 Month', durationMonths: 1 },
  BLUE_3_MONTHS: { key: 'BLUE_3_MONTHS', badgeType: 'BLUE', label: 'Blue Verified', durationLabel: '3 Months', durationMonths: 3 },
  BLUE_6_MONTHS: { key: 'BLUE_6_MONTHS', badgeType: 'BLUE', label: 'Blue Verified', durationLabel: '6 Months', durationMonths: 6 },
  GOLD_1_YEAR: { key: 'GOLD_1_YEAR', badgeType: 'GOLD', label: 'Gold Verified', durationLabel: '1 Year', durationMonths: 12 },
};

export const VERIFICATION_PLAN_KEYS = Object.keys(VERIFICATION_PLANS) as VerificationPlanKey[];

export function isVerificationPlanKey(value: unknown): value is VerificationPlanKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VERIFICATION_PLANS, value);
}

/**
 * Calendar-aware month addition (server-side single source of truth).
 * Jan 31 + 1 month -> Feb 28/29 (clamped to the target month's last day);
 * never assumes every month has 30 days.
 */
export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetMonth = result.getMonth() + months;
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(targetMonth);
  // Clamp to the last day of the target month (handles Jan 31 -> Feb 28/29).
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

/** Absolute expiry timestamp for a plan assigned at `from` (defaults to now). */
export function computePlanExpiry(planKey: VerificationPlanKey, from: Date = new Date()): Date {
  return addCalendarMonths(from, VERIFICATION_PLANS[planKey].durationMonths);
}


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
  // --- Paid Verified Badge information (server-authoritative) ---
  /** Badge expiry when a paid badge is active (falls back to membership end). */
  verificationExpiryDate: string | null;
  /** SubscriptionPlan purchased for the active paid badge. */
  plan: {
    id: string;
    name: string;
    badgeType: string;
    durationMonths: number;
    price: number;
  } | null;
  /** Reference of the purchase that activated the current badge. */
  purchaseReference: string | null;
}

export interface SubscriptionPlanData {
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

export class VerificationService {
  /**
   * Get a user's complete verification status
   */
  async getVerificationStatus(userId: string): Promise<VerificationStatus> {
    const [badge, membership, purchase] = await Promise.all([
      prisma.verificationBadge.findUnique({ where: { userId } }),
      prisma.creatorMembership.findUnique({ where: { userId } }),
      // The most recent completed/refunded purchase that relates to the active
      // badge entitlement (source of truth for the payment reference).
      prisma.verificationPurchase.findFirst({
        where: { userId, status: { in: ['COMPLETED', 'REFUNDED'] } },
        orderBy: { confirmedAt: 'desc' },
        select: { id: true, providerReference: true, planId: true },
      }),
    ]);

    const hasBlueBadge = badge?.badgeType === 'BLUE' && badge?.status === 'ACTIVE';
    const hasGoldBadge = badge?.badgeType === 'GOLD' && badge?.status === 'ACTIVE';
    const membershipActive = membership?.status === 'ACTIVE';
    const now = new Date();

    // Auto-expire expired memberships
    if (membership && membership.status === 'ACTIVE' && new Date(membership.endDate) < now) {
      await this.expireMembership(userId);
    }

    // Auto-expire expired badges
    if (badge && badge.status === 'ACTIVE' && badge.expiresAt && new Date(badge.expiresAt) < now) {
      await prisma.verificationBadge.update({
        where: { userId },
        data: { status: 'EXPIRED', updatedAt: new Date() },
      });
    }

    const refreshedBadge = await prisma.verificationBadge.findUnique({ where: { userId } });
    const refreshedMembership = await prisma.creatorMembership.findUnique({ where: { userId } });
    const refreshedPurchase =
      purchase && purchase.planId && refreshedBadge?.planId === purchase.planId
        ? purchase
        : await prisma.verificationPurchase.findFirst({
            where: { userId, status: { in: ['COMPLETED', 'REFUNDED'] } },
            orderBy: { confirmedAt: 'desc' },
            select: { id: true, providerReference: true, planId: true },
          });

    const finalHasGold = refreshedBadge?.badgeType === 'GOLD' && refreshedBadge?.status === 'ACTIVE';
    const finalHasBlue = refreshedBadge?.badgeType === 'BLUE' && refreshedBadge?.status === 'ACTIVE';
    const finalMembershipActive = refreshedMembership?.status === 'ACTIVE';

    let plan: VerificationStatus['plan'] = null;
    if (refreshedBadge?.planId) {
      const planRow = await prisma.subscriptionPlan.findUnique({
        where: { id: refreshedBadge.planId },
        select: { id: true, name: true, badgeType: true, durationMonths: true, price: true },
      });
      if (planRow) plan = planRow;
    }

    const badgeExpiry =
      refreshedBadge?.expiresAt?.toISOString() ||
      refreshedMembership?.endDate?.toISOString() ||
      null;

    return {
      hasBlueBadge: finalHasBlue,
      hasGoldBadge: finalHasGold,
      badgeType: finalHasGold ? 'GOLD' : finalHasBlue ? 'BLUE' : 'NONE',
      badgeStatus: (refreshedBadge?.status as VerificationStatus['badgeStatus']) || null,
      membershipStatus: (refreshedMembership?.status as VerificationStatus['membershipStatus']) || null,
      membershipPlan: refreshedMembership?.planId || null,
      expiryDate: refreshedMembership?.endDate?.toISOString() || null,
      renewalDate: refreshedMembership?.renewalDate?.toISOString() || null,
      canAccessCreatorStudio: finalHasGold && finalMembershipActive,
      subscriptionEndDate: refreshedMembership?.endDate?.toISOString() || null,
      verificationExpiryDate: (finalHasBlue || finalHasGold) ? badgeExpiry : null,
      plan,
      purchaseReference: refreshedPurchase?.providerReference || refreshedPurchase?.id || null,
    };
  }

  /**
   * Get all active subscription plans
   */
  async getSubscriptionPlans(): Promise<SubscriptionPlanData[]> {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return plans.map((plan: any) => ({
      ...plan,
      benefits: typeof plan.benefits === 'string' ? JSON.parse(plan.benefits) : plan.benefits || [],
      savings: this.calculateSavings(plan),
    }));
  }

  /**
   * Calculate savings percentage relative to 3-month plan
   */
  private calculateSavings(plan: any): string | null {
    if (plan.durationMonths <= 3) return null;
    const monthlyBaseline = 9.99 / 3; // 3-month plan price per month
    const actualMonthly = plan.price / plan.durationMonths;
    const savings = Math.round((1 - actualMonthly / monthlyBaseline) * 100);
    return savings > 0 ? `${savings}%` : null;
  }

  /**
   * Grant a verification badge to a user
   */
  async grantBadge(
    userId: string,
    badgeType: 'BLUE' | 'GOLD',
    grantedBy?: string,
    expiresAt?: Date
  ): Promise<any> {
    const existing = await prisma.verificationBadge.findUnique({ where: { userId } });

    if (existing) {
      return prisma.verificationBadge.update({
        where: { userId },
        data: {
          badgeType,
          status: 'ACTIVE',
          grantedBy: grantedBy || existing.grantedBy,
          grantedAt: new Date(),
          expiresAt: expiresAt || undefined,
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
          updatedAt: new Date(),
        },
      });
    }

    const badge = await prisma.verificationBadge.create({
      data: {
        userId,
        badgeType,
        status: 'ACTIVE',
        grantedBy,
        expiresAt: expiresAt || undefined,
      },
    });

    // Log to verification history
    await prisma.verificationHistory.create({
      data: {
        userId,
        action: `BADGE_GRANTED_${badgeType}`,
        performedBy: grantedBy,
        details: JSON.stringify({ badgeType, timestamp: new Date().toISOString() }),
      },
    });

    return badge;
  }

  /**
   * Revoke a verification badge
   */
  async revokeBadge(userId: string, revokedBy?: string, reason?: string): Promise<any> {
    const badge = await prisma.verificationBadge.findUnique({ where: { userId } });
    if (!badge) throw new Error('No badge found for this user');

    const updated = await prisma.verificationBadge.update({
      where: { userId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedBy,
        revokeReason: reason || null,
        updatedAt: new Date(),
      },
    });

    await prisma.verificationHistory.create({
      data: {
        userId,
        action: `BADGE_REVOKED_${badge.badgeType}`,
        performedBy: revokedBy,
        details: JSON.stringify({ reason, previousBadgeType: badge.badgeType }),
      },
    });

    return updated;
  }

  /**
   * Create a verification request
   */
  async createVerificationRequest(
    userId: string,
    requestType: 'CREATOR' | 'BUSINESS' | 'INDIVIDUAL',
    documents?: string,
    notes?: string
  ): Promise<any> {
    const existing = await prisma.verificationRequest.findUnique({ where: { userId } });
    if (existing) {
      if (existing.status === 'PENDING') {
        throw new Error('You already have a pending verification request');
      }
      // Update existing request
      return prisma.verificationRequest.update({
        where: { userId },
        data: {
          requestType,
          status: 'PENDING',
          documents: documents || existing.documents,
          notes: notes || existing.notes,
          reviewedBy: null,
          reviewedAt: null,
          rejectionReason: null,
          updatedAt: new Date(),
        },
      });
    }

    const request = await prisma.verificationRequest.create({
      data: { userId, requestType, documents, notes },
    });

    await prisma.verificationHistory.create({
      data: {
        userId,
        action: 'VERIFICATION_REQUEST_SUBMITTED',
        details: JSON.stringify({ requestType }),
      },
    });

    return request;
  }

  /**
   * Approve a verification request
   */
  async approveVerificationRequest(userId: string, reviewedBy: string): Promise<any> {
    const request = await prisma.verificationRequest.findUnique({ where: { userId } });
    if (!request) throw new Error('No verification request found');
    if (request.status !== 'PENDING') throw new Error('Request is not in pending status');

    await prisma.verificationRequest.update({
      where: { userId },
      data: { status: 'APPROVED', reviewedBy, reviewedAt: new Date(), updatedAt: new Date() },
    });

    // Grant blue badge
    await this.grantBadge(userId, 'BLUE', reviewedBy);

    return { success: true, message: 'Verification approved, blue badge granted' };
  }

  /**
   * Reject a verification request
   */
  async rejectVerificationRequest(userId: string, reviewedBy: string, reason: string): Promise<any> {
    const request = await prisma.verificationRequest.findUnique({ where: { userId } });
    if (!request) throw new Error('No verification request found');
    if (request.status !== 'PENDING') throw new Error('Request is not in pending status');

    const updated = await prisma.verificationRequest.update({
      where: { userId },
      data: {
        status: 'REJECTED',
        reviewedBy,
        reviewedAt: new Date(),
        rejectionReason: reason,
        updatedAt: new Date(),
      },
    });

    await prisma.verificationHistory.create({
      data: {
        userId,
        action: 'VERIFICATION_REJECTED',
        performedBy: reviewedBy,
        details: JSON.stringify({ reason }),
      },
    });

    return updated;
  }

  /**
   * Subscribe a user to a creator membership plan
   */
  /**
   * Activate a creator membership plan AFTER a server-verified, completed
   * purchase.
   *
   * SECURITY: the client can never activate a plan by clicking a button — it
   * must prove a VERIFIED payment exists. `purchaseId` must reference a
   * VerificationPurchase owned by this user whose status is COMPLETED (only a
   * server-side verified payment can reach COMPLETED). Replay of the same
   * purchase is idempotent.
   */
  async subscribeToPlan(userId: string, purchaseId: string): Promise<any> {
    return verificationPaymentService.confirmCompletedPurchase(userId, purchaseId);
  }

  /**
   * Cancel a creator membership
   */
  async cancelMembership(userId: string): Promise<any> {
    const membership = await prisma.creatorMembership.findUnique({ where: { userId } });
    if (!membership) throw new Error('No active membership found');
    if (membership.status !== 'ACTIVE') throw new Error('Membership is not active');

    const updated = await prisma.creatorMembership.update({
      where: { userId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Revoke gold badge
    await this.revokeBadge(userId, undefined, 'Membership cancelled');

    await prisma.verificationHistory.create({
      data: {
        userId,
        action: 'CREATOR_MEMBERSHIP_CANCELLED',
        details: JSON.stringify({ cancelledAt: new Date().toISOString() }),
      },
    });

    return updated;
  }

  /**
   * Expire a membership (called by cron or on check)
   */
  async expireMembership(userId: string): Promise<void> {
    await prisma.creatorMembership.update({
      where: { userId },
      data: { status: 'EXPIRED', updatedAt: new Date() },
    });

    await this.revokeBadge(userId, undefined, 'Membership expired');

    await prisma.verificationHistory.create({
      data: {
        userId,
        action: 'CREATOR_MEMBERSHIP_EXPIRED',
        details: JSON.stringify({ expiredAt: new Date().toISOString() }),
      },
    });
  }

  /**
   * Check and expire all overdue memberships (called by cron or on check).
   * Also enforces server-side expiry of over-due paid badges and stale
   * verification purchases so expired entitlements are never displayed.
   */
  async expireOverdueMemberships(): Promise<number> {
    const now = new Date();
    const expired = await prisma.creatorMembership.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { lt: now },
      },
    });

    for (const membership of expired) {
      await this.expireMembership(membership.userId);
    }

    // Paid badge entitlements + stale purchase orders expire server-side too.
    try {
      await verificationPaymentService.expireOverdueBadges();
    } catch {
      // Non-fatal for the membership cron.
    }
    try {
      await verificationPaymentService.expireStaleOrders();
    } catch {
      // Non-fatal for the membership cron.
    }

    return expired.length;
  }

  /**
   * Get verification history for a user
   */
  async getVerificationHistory(userId: string): Promise<any[]> {
    return prisma.verificationHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Get all pending verification requests (admin)
   */
  async getPendingVerificationRequests(): Promise<any[]> {
    return prisma.verificationRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        user: {
          select: { id: true, username: true, fullName: true, email: true, avatar: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get all badges (admin)
   */
  async getAllBadges(): Promise<any[]> {
    return prisma.verificationBadge.findMany({
      include: {
        user: {
          select: { id: true, username: true, fullName: true, email: true, avatar: true },
        },
      },
      orderBy: { grantedAt: 'desc' },
    });
  }

  /**
   * Get all memberships (admin)
   */
  async getAllMemberships(): Promise<any[]> {
    return prisma.creatorMembership.findMany({
      include: {
        user: {
          select: { id: true, username: true, fullName: true, email: true, avatar: true },
        },
        plan: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Suspend a creator subscription (admin)
   */
  async suspendSubscription(userId: string, reason?: string): Promise<any> {
    await prisma.creatorMembership.update({
      where: { userId },
      data: { status: 'SUSPENDED', updatedAt: new Date() },
    });

    await this.revokeBadge(userId, undefined, reason || 'Subscription suspended');

    return { success: true };
  }

  /**
   * Create or update a subscription plan (admin)
   */
  async upsertPlan(planData: {
    id?: string;
    name: string;
    durationMonths: number;
    price: number;
    currency?: string;
    description?: string;
    benefits?: string[];
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<any> {
    const data: any = {
      name: planData.name,
      durationMonths: planData.durationMonths,
      price: planData.price,
      currency: planData.currency || 'USD',
      description: planData.description || null,
      benefits: planData.benefits ? JSON.stringify(planData.benefits) : null,
      isActive: planData.isActive ?? true,
      sortOrder: planData.sortOrder || 0,
    };

    if (planData.id) {
      return prisma.subscriptionPlan.update({
        where: { id: planData.id },
        data: { ...data, updatedAt: new Date() },
      });
    }

    return prisma.subscriptionPlan.create({ data: { id: uuidv4(), ...data } });
  }

  /**
   * Create a crypto payment record
   */
  async createCryptoPayment(
    userId: string,
    planId: string,
    currency: 'USDT' | 'USDC',
    network: 'BNB_SMART_CHAIN' | 'BASE',
    walletAddress: string,
    amount: number
  ): Promise<any> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

    return prisma.cryptoPayment.create({
      data: {
        userId,
        planId,
        amount,
        currency,
        network,
        walletAddress,
        expiresAt,
      },
    });
  }

  /**
   * Legacy compat: confirm a legacy CryptoPayment row.
   *
   * SECURITY: a client-supplied transaction reference is NEVER proof of
   * payment. Badge entitlement only ever activates through the server-verified
   * purchase flow (VerificationPurchase), so this method can no longer activate
   * a badge. It only records the payment reference upon a matching server-side
   * purchase confirmation.
   */
  async confirmCryptoPayment(paymentId: string, txHash: string): Promise<any> {
    const payment = await prisma.cryptoPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error('Payment not found');

    // Only acknowledge a confirmation when the user already has an authenticated
    // server-verified purchase for the same plan. Otherwise we refuse — an
    // unverified payment must never activate anything.
    const verified = await prisma.verificationPurchase.findFirst({
      where: {
        userId: payment.userId,
        planId: payment.planId,
        status: 'COMPLETED',
        providerReference: { not: null },
      },
      orderBy: { confirmedAt: 'desc' },
    });
    if (!verified) {
      throw new Error(
        'Payment has not been verified. Badge activation requires a server-verified payment (webhook).'
      );
    }

    return prisma.cryptoPayment.update({
      where: { id: paymentId },
      data: {
        status: 'CONFIRMED',
        txHash,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Admin: grant blue badge
   */
  async adminGrantBlueBadge(userId: string, adminId: string): Promise<any> {
    return this.grantBadge(userId, 'BLUE', adminId);
  }

  /**
   * Admin: grant gold badge
   */
  async adminGrantGoldBadge(userId: string, adminId: string): Promise<any> {
    return this.grantBadge(userId, 'GOLD', adminId);
  }

  /**
   * Admin: revoke any badge
   */
  async adminRevokeBadge(userId: string, adminId: string, reason?: string): Promise<any> {
    return this.revokeBadge(userId, adminId, reason || 'Revoked by admin');
  }

  // ==========================================================================
  // ADMIN PLAN-BASED VERIFICATION MANAGEMENT
  // ==========================================================================

  /** Current verification state for the admin manage-verification modal. */
  async getVerificationState(userId: string) {
    const [user, badge] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, fullName: true, avatar: true, verified: true } }),
      prisma.verificationBadge.findUnique({ where: { userId } }),
    ]);
    if (!user) throw new Error('User not found');

    const now = Date.now();
    const active = Boolean(badge) && badge!.status === 'ACTIVE' &&
      (!badge!.expiresAt || new Date(badge!.expiresAt).getTime() > now);

    return {
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      avatar: user.avatar,
      isVerified: Boolean(user.verified) || active,
      badge: badge
        ? {
            badgeType: badge.badgeType,
            status: badge.status,
            grantedAt: badge.grantedAt.toISOString(),
            expiresAt: badge.expiresAt ? badge.expiresAt.toISOString() : null,
            revokedAt: badge.revokedAt ? badge.revokedAt.toISOString() : null,
            revokeReason: badge.revokeReason,
          }
        : null,
      active,
      activePlan: active ? this.matchPlanForBadge(badge!) : null,
      plans: Object.values(VERIFICATION_PLANS),
    };
  }

  /** Best-effort match of an existing badge row to one of the four plans. */
  private matchPlanForBadge(badge: { badgeType: string; grantedAt: Date; expiresAt: Date | null }): VerificationPlanKey | null {
    if (!badge.expiresAt) return null;
    const months = Math.round(
      (new Date(badge.expiresAt).getTime() - new Date(badge.grantedAt).getTime()) / (30.44 * 24 * 60 * 60 * 1000)
    );
    return (
      VERIFICATION_PLAN_KEYS.find((key) => {
        const plan = VERIFICATION_PLANS[key];
        return plan.badgeType === badge.badgeType && Math.abs(plan.durationMonths - months) <= 1;
      }) || null
    );
  }

  /**
   * Assign one of the four verification plans to a user.
   * Validates the plan, persists badge type, assignment timestamp and the
   * computed calendar expiry, flips the public `verified` flag, and records
   * every assignment/reassignment in verification history (the audit log is
   * written by the admin controller alongside this call).
   */
  async assignVerificationPlan(userId: string, planKey: VerificationPlanKey, adminId: string) {
    if (!isVerificationPlanKey(planKey)) throw new Error('Unknown verification plan');
    const plan = VERIFICATION_PLANS[planKey];

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, verified: true } });
    if (!user) throw new Error('User not found');

    const grantedAt = new Date();
    const expiresAt = computePlanExpiry(planKey, grantedAt);

    const badge = await this.grantBadge(userId, plan.badgeType, adminId, expiresAt);

    // grantBadge only writes history on first creation — record every plan
    // assignment/reassignment so a plan change can never be lost.
    await prisma.verificationHistory.create({
      data: {
        userId,
        action: `PLAN_ASSIGNED_${planKey}`,
        performedBy: adminId,
        details: JSON.stringify({
          planKey,
          badgeType: plan.badgeType,
          durationMonths: plan.durationMonths,
          grantedAt: grantedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        }),
      },
    });

    // The public badge flag must reflect the new assignment immediately.
    await prisma.user.update({ where: { id: userId }, data: { verified: true } });

    return {
      planKey,
      badgeType: plan.badgeType,
      grantedAt: grantedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      badge,
      isVerified: true,
    };
  }

  /**
   * Remove a user's verification badge. Revokes the badge row (if any),
   * clears the public verified flag, and records the removal. Never touches
   * account status or any other account data.
   */
  async removeVerification(userId: string, adminId: string, reason?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, verified: true, verificationBadge: true },
    });
    if (!user) throw new Error('User not found');
    if (!user.verified && !user.verificationBadge) throw new Error('This user has no verification badge to remove');

    if (user.verificationBadge && user.verificationBadge.status === 'ACTIVE') {
      await this.revokeBadge(userId, adminId, reason || 'Removed by admin');
    }

    await prisma.user.update({ where: { id: userId }, data: { verified: false } });

    await prisma.verificationHistory.create({
      data: {
        userId,
        action: 'VERIFICATION_REMOVED',
        performedBy: adminId,
        details: JSON.stringify({ reason: reason || null, removedAt: new Date().toISOString() }),
      },
    });

    const badge = await prisma.verificationBadge.findUnique({ where: { userId } });
    return { isVerified: false, badge };
  }

  /**
   * Expire overdue ACTIVE badge rows (startup + interval sweep). Read-time
   * checks (`isBadgeRowActive` / `enrichPublicUser`) already prevent an
   * expired badge from displaying; this sweep keeps the persisted state
   * consistent for admin listings and analytics.
   */
  async sweepExpiredBadges(): Promise<number> {
    const now = new Date();
    const overdue = await prisma.verificationBadge.findMany({
      where: { status: 'ACTIVE', expiresAt: { not: null, lte: now } },
      select: { id: true, userId: true },
    });
    if (overdue.length === 0) return 0;

    await prisma.verificationBadge.updateMany({
      where: { id: { in: overdue.map((b) => b.id) } },
      data: { status: 'EXPIRED', updatedAt: now },
    });

    // The legacy verified flag must not keep an expired badge alive for
    // clients that only read `user.verified`.
    await prisma.user.updateMany({
      where: { id: { in: overdue.map((b) => b.userId) }, verified: true },
      data: { verified: false },
    });

    return overdue.length;
  }

  /**
   * Check if user can access creator studio (called on EVERY request).
   *
   * Access is granted when EITHER:
   *  - the paid GOLD badge + active membership tier is present
   *    (`status.canAccessCreatorStudio`), OR
   *  - the account is a server-verified creator (`User.verified`) or holds a
   *    privileged role (ADMIN / SUPER_ADMIN / MODERATOR).
   *
   * This reuses the existing verification data as the source of truth rather
   * than introducing a parallel authorization system, and keeps the decision
   * fully server-side so it cannot be spoofed from the client.
   */
  async checkCreatorStudioAccess(userId: string): Promise<{ allowed: boolean; status: VerificationStatus }> {
    const status = await this.getVerificationStatus(userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { verified: true, role: true },
    });

    const role = (user?.role || '').toUpperCase();
    const privilegedRole = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(role);
    const allowed = status.canAccessCreatorStudio || Boolean(user?.verified) || privilegedRole;

    return {
      allowed,
      status,
    };
  }

}

export const verificationService = new VerificationService();