// ============================================================================
// VANTA ACCOUNT APPEAL SERVICE
// ----------------------------------------------------------------------------
// Persistent appeal lifecycle for suspended and banned accounts:
//   PENDING -> UNDER_REVIEW -> APPROVED | REJECTED
//
// Rules enforced here (never in the frontend):
//  - Only a currently restricted account (SUSPENDED/BANNED) may appeal.
//  - One open appeal per account; duplicates are rejected with a 409 that
//    carries the existing open appeal so nothing is silently discarded.
//  - Rejection NEVER changes the account's status.
//  - Approval only restores the account when the reviewing admin explicitly
//    requested it AND the standing restriction is the one this appeal
//    addresses (a separate active restriction is never lifted implicitly).
//  - Every transition is audit-logged with actor, timestamp and target.
// ============================================================================
import { prisma } from '../prisma';
import { auditLog } from '../security/auditLog';

export const APPEAL_CATEGORIES = [
  'ACCOUNT_RESTRICTION',
  'CONTENT',
  'BEHAVIOR',
  'IMPERSONATION',
  'OTHER',
] as const;
export type AppealCategory = (typeof APPEAL_CATEGORIES)[number];

export const APPEAL_STATUSES = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];
const OPEN_STATUSES: AppealStatus[] = ['PENDING', 'UNDER_REVIEW'];

const MIN_EXPLANATION_LENGTH = 20;
const MAX_EXPLANATION_LENGTH = 4000;
const MAX_SUPPORTING_LENGTH = 2000;

export class AppealError extends Error {
  public statusCode: number;
  public code: string;
  public details?: unknown;
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppealError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const serialize = (appeal: any) => ({
  id: appeal.id,
  accountStatus: appeal.accountStatus,
  category: appeal.category,
  explanation: appeal.explanation,
  supportingInfo: appeal.supportingInfo,
  status: appeal.status,
  reviewedBy: appeal.reviewedBy,
  reviewedAt: appeal.reviewedAt ? appeal.reviewedAt.toISOString() : null,
  decisionNote: appeal.decisionNote,
  accountRestored: appeal.accountRestored,
  createdAt: appeal.createdAt.toISOString(),
  updatedAt: appeal.updatedAt.toISOString(),
  user: appeal.user
    ? {
        id: appeal.user.id,
        username: appeal.user.username,
        fullName: appeal.user.fullName,
        avatar: appeal.user.avatar,
        status: appeal.user.status,
        suspendedAt: appeal.user.suspendedAt ? appeal.user.suspendedAt.toISOString() : null,
        suspendedReason: appeal.user.suspendedReason,
        bannedAt: appeal.user.bannedAt ? appeal.user.bannedAt.toISOString() : null,
        bannedReason: appeal.user.bannedReason,
      }
    : undefined,
});

const USER_INCLUDE = {
  user: {
    select: {
      id: true,
      username: true,
      fullName: true,
      avatar: true,
      status: true,
      suspendedAt: true,
      suspendedReason: true,
      bannedAt: true,
      bannedReason: true,
    },
  },
} as const;

export class AppealService {
  /**
   * Submit an appeal. `userId` comes from a restricted session (suspended) or
   * a verified appeal token (banned) — never from the request body.
   */
  async submitAppeal(
    userId: string,
    input: { category?: string; explanation?: string; supportingInfo?: string }
  ) {
    const category = String(input.category || 'ACCOUNT_RESTRICTION').toUpperCase();
    if (!(APPEAL_CATEGORIES as readonly string[]).includes(category)) {
      throw new AppealError(400, 'VALIDATION_ERROR', 'Choose a valid appeal category.');
    }

    const explanation = String(input.explanation || '').trim();
    if (explanation.length < MIN_EXPLANATION_LENGTH) {
      throw new AppealError(
        400,
        'VALIDATION_ERROR',
        `Please explain why the decision should be reviewed (at least ${MIN_EXPLANATION_LENGTH} characters).`
      );
    }
    if (explanation.length > MAX_EXPLANATION_LENGTH) {
      throw new AppealError(400, 'VALIDATION_ERROR', `Explanations are limited to ${MAX_EXPLANATION_LENGTH} characters.`);
    }
    const supportingInfo = String(input.supportingInfo || '').trim();
    if (supportingInfo.length > MAX_SUPPORTING_LENGTH) {
      throw new AppealError(400, 'VALIDATION_ERROR', `Supporting information is limited to ${MAX_SUPPORTING_LENGTH} characters.`);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, username: true },
    });
    if (!user) throw new AppealError(404, 'NOT_FOUND', 'Account not found.');
    if (user.status !== 'SUSPENDED' && user.status !== 'BANNED') {
      throw new AppealError(409, 'APPEAL_NOT_REQUIRED', 'This account is not restricted, so no appeal can be submitted.');
    }

    // Duplicate policy: one open appeal at a time. The existing open appeal is
    // returned so the user sees it instead of losing their submission.
    const openAppeal = await prisma.accountAppeal.findFirst({
      where: { userId, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
      include: USER_INCLUDE,
    });
    if (openAppeal) {
      throw new AppealError(409, 'APPEAL_ALREADY_PENDING', 'You already have an appeal awaiting review.', serialize(openAppeal));
    }

    const appeal = await prisma.accountAppeal.create({
      data: {
        userId,
        accountStatus: user.status,
        category,
        explanation,
        supportingInfo: supportingInfo || null,
      },
      include: USER_INCLUDE,
    });

    await auditLog.log({
      userId,
      action: 'APPEAL_SUBMITTED',
      metadata: { resource: 'AccountAppeal', resourceId: appeal.id, targetId: userId, category, accountStatus: user.status },
      severity: 'WARNING',
    });

    return serialize(appeal);
  }

  /** Latest appeals for the restricted account itself (newest first). */
  async getOwnAppeals(userId: string) {
    const appeals = await prisma.accountAppeal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: USER_INCLUDE,
    });
    return appeals.map(serialize);
  }

  /**
   * Minimal account overview consumed by the suspended/banned screens.
   * Only fields the account holder is permitted to see are returned — never
   * internal moderation notes or other accounts' data.
   */
  async getAccountOverview(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        avatar: true,
        status: true,
        suspendedAt: true,
        suspendedReason: true,
        suspendedUntil: true,
        bannedAt: true,
        bannedReason: true,
      },
    });
    if (!user) throw new AppealError(404, 'NOT_FOUND', 'Account not found.');

    const latestAppeal = await prisma.accountAppeal.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: USER_INCLUDE,
    });

    return {
      account: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        status: user.status,
        suspendedAt: user.suspendedAt ? user.suspendedAt.toISOString() : null,
        suspendedReason: user.suspendedReason,
        suspendedUntil: user.suspendedUntil ? user.suspendedUntil.toISOString() : null,
        bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
        bannedReason: user.bannedReason,
      },
      appeal: latestAppeal ? serialize(latestAppeal) : null,
    };
  }

  /** Admin list: filter by status, search by username/display name, paginated. */
  async listAppeals(params: { status?: string; search?: string; page?: number; limit?: number }) {
    const limit = Math.min(Math.max(params.limit || 25, 1), 100);
    const page = Math.max(params.page || 1, 1);
    const search = String(params.search || '').trim().replace(/^@/, '');

    const where: any = {};
    if (params.status && params.status !== 'ALL') where.status = params.status;
    if (search) {
      where.user = {
        is: {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { fullName: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [appeals, total] = await Promise.all([
      prisma.accountAppeal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: USER_INCLUDE,
      }),
      prisma.accountAppeal.count({ where }),
    ]);

    return {
      appeals: appeals.map(serialize),
      total,
      page,
      pageSize: limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Appeals for one specific user (admin "view appeal history" action). */
  async listAppealsForUser(userId: string) {
    const appeals = await prisma.accountAppeal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: USER_INCLUDE,
    });
    return appeals.map(serialize);
  }

  /** Move a pending appeal into review. */
  async markUnderReview(appealId: string, adminId: string) {
    const appeal = await prisma.accountAppeal.findUnique({ where: { id: appealId }, include: USER_INCLUDE });
    if (!appeal) throw new AppealError(404, 'NOT_FOUND', 'Appeal not found.');
    if (appeal.status !== 'PENDING') {
      throw new AppealError(409, 'APPEAL_STATE_CONFLICT', `Only pending appeals can be marked under review (current: ${appeal.status}).`);
    }

    const updated = await prisma.accountAppeal.update({
      where: { id: appealId },
      data: { status: 'UNDER_REVIEW', reviewedBy: adminId, reviewedAt: new Date() },
      include: USER_INCLUDE,
    });

    await auditLog.log({
      userId: adminId,
      action: 'APPEAL_STATUS_CHANGED',
      metadata: { resource: 'AccountAppeal', resourceId: appealId, targetId: appeal.userId, previousValue: 'PENDING', newValue: 'UNDER_REVIEW' },
      severity: 'WARNING',
    });

    return serialize(updated);
  }

  /**
   * Final review decision.
   *  - APPROVED + restoreAccount: lifts the matching standing restriction.
   *  - APPROVED without restoreAccount: records approval while the admin
   *    upholds the (separate) restriction.
   *  - REJECTED: never touches account status.
   */
  async decideAppeal(
    appealId: string,
    adminId: string,
    decision: { value: 'APPROVED' | 'REJECTED'; note?: string; restoreAccount?: boolean }
  ) {
    if (decision.value !== 'APPROVED' && decision.value !== 'REJECTED') {
      throw new AppealError(400, 'VALIDATION_ERROR', 'Decision must be APPROVED or REJECTED.');
    }
    const note = String(decision.note || '').trim();
    if (note.length > MAX_EXPLANATION_LENGTH) {
      throw new AppealError(400, 'VALIDATION_ERROR', 'Decision note is too long.');
    }

    const appeal = await prisma.accountAppeal.findUnique({ where: { id: appealId }, include: USER_INCLUDE });
    if (!appeal) throw new AppealError(404, 'NOT_FOUND', 'Appeal not found.');
    if (appeal.status === 'APPROVED' || appeal.status === 'REJECTED') {
      throw new AppealError(409, 'APPEAL_ALREADY_DECIDED', `This appeal was already ${appeal.status.toLowerCase()}.`);
    }

    let accountRestored = false;
    if (decision.value === 'APPROVED' && decision.restoreAccount) {
      // Only lift the restriction this appeal addresses. If the account has
      // since picked up a DIFFERENT standing restriction (e.g. a fresh ban
      // after a suspension appeal), that separate restriction is upheld.
      if (appeal.user && appeal.user.status === appeal.accountStatus && appeal.user.status !== 'ACTIVE') {
        await prisma.user.update({
          where: { id: appeal.userId },
          data: {
            status: 'ACTIVE',
            suspendedAt: null,
            suspendedReason: null,
            suspendedUntil: null,
            bannedAt: null,
            bannedReason: null,
          },
        });
        accountRestored = true;
      }
    }

    const updated = await prisma.accountAppeal.update({
      where: { id: appealId },
      data: {
        status: decision.value,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        decisionNote: note || null,
        accountRestored,
      },
      include: USER_INCLUDE,
    });

    // Notify the affected user through the existing notification system.
    await prisma.notification.create({
      data: {
        userId: appeal.userId,
        type: 'APPEAL_DECISION',
        title: decision.value === 'APPROVED' ? 'Appeal Approved' : 'Appeal Rejected',
        message:
          decision.value === 'APPROVED'
            ? accountRestored
              ? 'Your appeal was approved and your account has been restored.'
              : 'Your appeal was approved. Your account remains restricted pending the separate active action.'
            : 'Your appeal was reviewed and rejected. Your account remains restricted.',
      },
    });

    await auditLog.log({
      userId: adminId,
      action: decision.value === 'APPROVED' ? 'APPEAL_APPROVED' : 'APPEAL_REJECTED',
      metadata: {
        resource: 'AccountAppeal',
        resourceId: appealId,
        targetId: appeal.userId,
        accountStatus: appeal.accountStatus,
        accountRestored,
        note: note || undefined,
      },
      severity: 'CRITICAL',
    });

    if (accountRestored) {
      await auditLog.log({
        userId: adminId,
        action: 'ACCOUNT_RESTORED_VIA_APPEAL',
        metadata: { resource: 'User', resourceId: appeal.userId, targetId: appeal.userId, appealId },
        severity: 'CRITICAL',
      });
    }

    return serialize(updated);
  }
}

export const appealService = new AppealService();
