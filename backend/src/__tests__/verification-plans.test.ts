/**
 * Verification plan tests (part 1): catalog strictness + calendar expiry.
 */
import {
  VERIFICATION_PLANS,
  VERIFICATION_PLAN_KEYS,
  isVerificationPlanKey,
  addCalendarMonths,
  computePlanExpiry,
} from '../services/verification.service';
import { describe, expect, test } from '@jest/globals';

describe('plan catalog', () => {
  test('exactly the four required plans exist', () => {
    expect(VERIFICATION_PLAN_KEYS).toEqual(['BLUE_1_MONTH', 'BLUE_3_MONTHS', 'BLUE_6_MONTHS', 'GOLD_1_YEAR']);
    expect(VERIFICATION_PLANS.BLUE_1_MONTH).toMatchObject({ badgeType: 'BLUE', durationMonths: 1 });
    expect(VERIFICATION_PLANS.BLUE_3_MONTHS).toMatchObject({ badgeType: 'BLUE', durationMonths: 3 });
    expect(VERIFICATION_PLANS.BLUE_6_MONTHS).toMatchObject({ badgeType: 'BLUE', durationMonths: 6 });
    expect(VERIFICATION_PLANS.GOLD_1_YEAR).toMatchObject({ badgeType: 'GOLD', durationMonths: 12 });
  });

  test('plan keys validate strictly', () => {
    expect(isVerificationPlanKey('BLUE_1_MONTH')).toBe(true);
    expect(isVerificationPlanKey('GOLD_1_YEAR')).toBe(true);
    expect(isVerificationPlanKey('BLUE_12_MONTHS')).toBe(false);
    expect(isVerificationPlanKey('gold')).toBe(false);
    expect(isVerificationPlanKey(undefined)).toBe(false);
  });
});

describe('calendar-month expiry arithmetic', () => {
  test('Jan 31 + 1 month clamps to Feb 28 (non-leap year)', () => {
    const expiry = addCalendarMonths(new Date(2025, 0, 31, 12, 0, 0), 1);
    expect(expiry.getFullYear()).toBe(2025);
    expect(expiry.getMonth()).toBe(1);
    expect(expiry.getDate()).toBe(28);
    expect(expiry.getHours()).toBe(12);
  });

  test('Jan 31 + 1 month clamps to Feb 29 in a leap year', () => {
    const expiry = addCalendarMonths(new Date(2024, 0, 31, 12, 0, 0), 1);
    expect(expiry.getMonth()).toBe(1);
    expect(expiry.getDate()).toBe(29);
  });

  test('plan expiry spans the correct calendar distance', () => {
    const from = new Date(2026, 4, 15, 10, 30, 0);
    const oneMonth = computePlanExpiry('BLUE_1_MONTH', from);
    expect(oneMonth.getMonth()).toBe(5);
    expect(oneMonth.getDate()).toBe(15);

    const oneYear = computePlanExpiry('GOLD_1_YEAR', from);
    expect(oneYear.getFullYear()).toBe(2027);
    expect(oneYear.getMonth()).toBe(4);
    expect(oneYear.getDate()).toBe(15);
  });
});

/**
 * Verification plan tests (part 2a): assignment + removal.
 */
import { verificationService } from '../services/verification.service';
import { prisma } from '../prisma';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('../prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    verificationBadge: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    verificationHistory: { create: jest.fn() },
  },
}));

const asMock = (fn: unknown) => fn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('assignVerificationPlan', () => {
  test('BLUE plans grant BLUE badges, GOLD plan grants GOLD', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({ id: 'u1', verified: false });
    asMock(prisma.verificationBadge.findUnique).mockResolvedValue(null);
    asMock(prisma.verificationBadge.create).mockImplementation(async ({ data }: any) => ({
      id: 'b1',
      ...data,
    }));
    asMock(prisma.verificationHistory.create).mockResolvedValue({});

    const blue: any = await verificationService.assignVerificationPlan('u1', 'BLUE_3_MONTHS', 'admin1');
    expect(blue.badgeType).toBe('BLUE');
    expect(blue.isVerified).toBe(true);
    expect(new Date(blue.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const gold: any = await verificationService.assignVerificationPlan('u1', 'GOLD_1_YEAR', 'admin1');
    expect(gold.badgeType).toBe('GOLD');
  });

  test('assignment flips the public verified flag and records history', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({ id: 'u1', verified: false });
    asMock(prisma.verificationBadge.findUnique).mockResolvedValue(null);
    asMock(prisma.verificationBadge.create).mockResolvedValue({ id: 'b1' });
    asMock(prisma.verificationHistory.create).mockResolvedValue({});

    await verificationService.assignVerificationPlan('u1', 'BLUE_1_MONTH', 'admin1');
    expect(asMock(prisma.user.update).mock.calls[0][0]).toMatchObject({
      where: { id: 'u1' },
      data: { verified: true },
    });
    const historyActions = asMock(prisma.verificationHistory.create).mock.calls.map((c) => c[0].data.action);
    expect(historyActions).toContain('PLAN_ASSIGNED_BLUE_1_MONTH');
  });

  test('unknown plans and missing users are rejected', async () => {
    await expect(
      verificationService.assignVerificationPlan('u1', 'PLATINUM' as never, 'admin1')
    ).rejects.toThrow('Unknown verification plan');

    asMock(prisma.user.findUnique).mockResolvedValue(null);
    await expect(
      verificationService.assignVerificationPlan('missing', 'BLUE_1_MONTH', 'admin1')
    ).rejects.toThrow('User not found');
  });
});

describe('removeVerification', () => {
  test('removal revokes, clears the flag, and leaves status untouched', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      verified: true,
      verificationBadge: { userId: 'u1', status: 'ACTIVE', badgeType: 'BLUE' },
    });
    asMock(prisma.verificationBadge.update).mockResolvedValue({ status: 'REVOKED' });
    asMock(prisma.verificationHistory.create).mockResolvedValue({});
    asMock(prisma.verificationBadge.findUnique).mockResolvedValue({ status: 'REVOKED' });

    const result: any = await verificationService.removeVerification('u1', 'admin1', 'Policy violation');
    expect(result.isVerified).toBe(false);
    expect(asMock(prisma.user.update).mock.calls[0][0].data).toEqual({ verified: false });
    expect(asMock(prisma.user.update).mock.calls[0][0].data).not.toHaveProperty('status');
  });

  test('removal with no badge present fails loudly', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({ id: 'u1', verified: false, verificationBadge: null });
    await expect(verificationService.removeVerification('u1', 'admin1')).rejects.toThrow(
      'no verification badge'
    );
  });
});

/**
 * Verification plan tests (part 2b): read-time expiry + the expiry sweep.
 */
import { verificationService } from '../services/verification.service';
import { isBadgeRowActive, enrichPublicUser } from '../services/public-verification';
import { prisma } from '../prisma';
import { describe, expect, test, jest } from '@jest/globals';

const asMockBadge = (fn: unknown) => fn as jest.Mock;

describe('read-time expiry enforcement', () => {
  test('an overdue badge row is inactive and hides the legacy flag', () => {
    const overdue = { status: 'ACTIVE', expiresAt: new Date(Date.now() - 1000).toISOString() };
    expect(isBadgeRowActive(overdue)).toBe(false);

    const enriched: any = enrichPublicUser({
      verified: true,
      verificationBadge: overdue,
    });
    expect(enriched.verified).toBe(false);
    expect(enriched.verificationType).toBeNull();
  });

  test('an active badge row still displays with its tier', () => {
    const active = { status: 'ACTIVE', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), badgeType: 'BLUE' };
    expect(isBadgeRowActive(active)).toBe(true);

    const enriched: any = enrichPublicUser({ verified: false, verificationBadge: active });
    expect(enriched.verified).toBe(true);
    expect(enriched.verificationType).toBe('BLUE');
  });

  test('legacy flag without a badge row still shows GOLD', () => {
    const enriched: any = enrichPublicUser({ verified: true, verificationBadge: null });
    expect(enriched.verified).toBe(true);
    expect(enriched.verificationType).toBe('GOLD');
  });
});

describe('sweepExpiredBadges', () => {
  test('overdue ACTIVE badges expire and the legacy flag is cleared', async () => {
    jest.clearAllMocks();
    asMock(prisma.verificationBadge.findMany).mockResolvedValue([
      { id: 'b1', userId: 'u1' },
      { id: 'b2', userId: 'u2' },
    ]);

    const processed = await verificationService.sweepExpiredBadges();
    expect(processed).toBe(2);
    expect(asMock(prisma.verificationBadge.updateMany).mock.calls[0][0]).toMatchObject({
      where: { id: { in: ['b1', 'b2'] } },
      data: { status: 'EXPIRED' },
    });
    expect(asMock(prisma.user.updateMany).mock.calls[0][0]).toMatchObject({
      where: { id: { in: ['u1', 'u2'] }, verified: true },
      data: { verified: false },
    });
  });

  test('a clean table is a cheap no-op', async () => {
    jest.clearAllMocks();
    asMock(prisma.verificationBadge.findMany).mockResolvedValue([]);
    expect(await verificationService.sweepExpiredBadges()).toBe(0);
    expect(prisma.verificationBadge.updateMany).not.toHaveBeenCalled();
  });
});
