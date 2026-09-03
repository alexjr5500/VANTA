import { prisma } from '../prisma';
import { v4 as uuidv4 } from 'uuid';

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
    const [badge, membership] = await Promise.all([
      prisma.verificationBadge.findUnique({ where: { userId } }),
      prisma.creatorMembership.findUnique({ where: { userId } }),
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

    const finalHasGold = refreshedBadge?.badgeType === 'GOLD' && refreshedBadge?.status === 'ACTIVE';
    const finalHasBlue = refreshedBadge?.badgeType === 'BLUE' && refreshedBadge?.status === 'ACTIVE';
    const finalMembershipActive = refreshedMembership?.status === 'ACTIVE';

    return {
      hasBlueBadge: finalHasBlue,
      hasGoldBadge: finalHasGold,
      badgeType: finalHasGold ? 'GOLD' : finalHasBlue ? 'BLUE' : 'NONE',
      badgeStatus: refreshedBadge?.status || null,
      membershipStatus: refreshedMembership?.status || null,
      membershipPlan: refreshedMembership?.planId || null,
      expiryDate: refreshedMembership?.endDate?.toISOString() || null,
      renewalDate: refreshedMembership?.renewalDate?.toISOString() || null,
      canAccessCreatorStudio: finalHasGold && finalMembershipActive,
      subscriptionEndDate: refreshedMembership?.endDate?.toISOString() || null,
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
  async subscribeToPlan(
    userId: string,
    planId: string,
    paymentMethod?: string,
    paymentTxHash?: string
  ): Promise<any> {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new Error('Subscription plan not found');
    if (!plan.isActive) throw new Error('Subscription plan is not active');

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + plan.durationMonths);
    const renewalDate = new Date(endDate);
    renewalDate.setDate(renewalDate.getDate() - 7); // Renewal reminder 7 days before

    // Upsert membership
    const existing = await prisma.creatorMembership.findUnique({ where: { userId } });
    let membership;
    if (existing) {
      membership = await prisma.creatorMembership.update({
        where: { userId },
        data: {
          planId,
          status: 'ACTIVE',
          startDate,
          endDate,
          renewalDate,
          autoRenew: false,
          cancelledAt: null,
          paymentMethod: paymentMethod || existing.paymentMethod,
          paymentTxHash: paymentTxHash || existing.paymentTxHash,
          updatedAt: new Date(),
        },
      });
    } else {
      membership = await prisma.creatorMembership.create({
        data: {
          userId,
          planId,
          status: 'ACTIVE',
          startDate,
          endDate,
          renewalDate,
          paymentMethod,
          paymentTxHash,
        },
      });
    }

    // Grant or upgrade badge to GOLD
    await this.grantBadge(userId, 'GOLD', undefined, endDate);

    await prisma.verificationHistory.create({
      data: {
        userId,
        action: 'CREATOR_MEMBERSHIP_ACTIVATED',
        details: JSON.stringify({
          planId: plan.id,
          planName: plan.name,
          durationMonths: plan.durationMonths,
          price: plan.price,
          endDate: endDate.toISOString(),
        }),
      },
    });

    return { membership, plan };
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
   * Check and expire all overdue memberships
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
   * Confirm a crypto payment
   */
  async confirmCryptoPayment(paymentId: string, txHash: string): Promise<any> {
    const payment = await prisma.cryptoPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error('Payment not found');
    if (payment.status !== 'PENDING') throw new Error('Payment is not pending');

    const updated = await prisma.cryptoPayment.update({
      where: { id: paymentId },
      data: {
        status: 'CONFIRMED',
        txHash,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Activate subscription
    await this.subscribeToPlan(payment.userId, payment.planId, `${payment.currency}_${payment.network}`, txHash);

    return updated;
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