/**
 * Appeal lifecycle tests (service layer, mocked persistence).
 *
 * Proves:
 *  - valid suspended/banned submissions persist with a status snapshot,
 *  - invalid submissions are rejected (category / length),
 *  - duplicate open appeals are rejected with a 409 that carries the
 *    existing appeal (nothing is silently discarded),
 *  - only restricted accounts may appeal.
 */
import { appealService, AppealError } from '../services/appeal.service';
import { prisma } from '../prisma';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('../prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    accountAppeal: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    notification: { create: jest.fn() },
  },
}));

jest.mock('../security/auditLog', () => ({
  auditLog: { log: jest.fn().mockResolvedValue({}) },
}));

const asMock = (fn: unknown) => fn as jest.Mock;

const suspendedUser = { id: 'u1', status: 'SUSPENDED', username: 'alex' };
const goodAppeal = {
  id: 'a1',
  userId: 'u1',
  accountStatus: 'SUSPENDED',
  category: 'ACCOUNT_RESTRICTION',
  explanation: 'I believe this action was made in error because...',
  supportingInfo: null,
  status: 'PENDING',
  reviewedBy: null,
  reviewedAt: null,
  decisionNote: null,
  accountRestored: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  user: {
    id: 'u1',
    username: 'alex',
    fullName: 'Alex',
    avatar: null,
    status: 'SUSPENDED',
    suspendedAt: new Date('2026-09-01T00:00:00Z'),
    suspendedReason: 'Spam',
    bannedAt: null,
    bannedReason: null,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('submitAppeal', () => {
  const validInput = {
    category: 'ACCOUNT_RESTRICTION',
    explanation: 'I believe this action was made in error because of the following reasons...',
  };

  test('persists an appeal with the account status snapshot', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(suspendedUser);
    asMock(prisma.accountAppeal.findFirst).mockResolvedValue(null);
    asMock(prisma.accountAppeal.create).mockResolvedValue(goodAppeal);

    const appeal: any = await appealService.submitAppeal('u1', validInput);
    expect(appeal.accountStatus).toBe('SUSPENDED');
    expect(appeal.status).toBe('PENDING');
    expect(asMock(prisma.accountAppeal.create).mock.calls[0][0].data).toMatchObject({
      userId: 'u1',
      accountStatus: 'SUSPENDED',
    });
  });

  test('rejects empty/short explanations without touching the database', async () => {
    await expect(appealService.submitAppeal('u1', { explanation: 'too short' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.accountAppeal.create).not.toHaveBeenCalled();
  });

  test('rejects unknown categories', async () => {
    await expect(
      appealService.submitAppeal('u1', { category: 'BOGUS', explanation: 'x'.repeat(30) })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a second open appeal with the existing record attached', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(suspendedUser);
    asMock(prisma.accountAppeal.findFirst).mockResolvedValue(goodAppeal);

    const failure = await appealService.submitAppeal('u1', validInput).catch((e) => e);
    expect(failure).toBeInstanceOf(AppealError);
    expect(failure.statusCode).toBe(409);
    expect(failure.code).toBe('APPEAL_ALREADY_PENDING');
    expect((failure.details as any)?.id).toBe('a1');
    expect(prisma.accountAppeal.create).not.toHaveBeenCalled();
  });

  test('rejects submissions from unrestricted accounts', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({ id: 'u9', status: 'ACTIVE', username: 'ok' });
    await expect(appealService.submitAppeal('u9', validInput)).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPEAL_NOT_REQUIRED',
    });
  });
});

describe('decideAppeal', () => {
  test('APPROVED with restoreAccount lifts the matching restriction', async () => {
    asMock(prisma.accountAppeal.findUnique).mockResolvedValue(goodAppeal);
    asMock(prisma.user.update).mockResolvedValue({ ...suspendedUser, status: 'ACTIVE' });
    asMock(prisma.accountAppeal.update).mockResolvedValue({ ...goodAppeal, status: 'APPROVED', accountRestored: true });

    const appeal: any = await appealService.decideAppeal('a1', 'admin1', {
      value: 'APPROVED',
      note: 'Reviewed, restoring.',
      restoreAccount: true,
    });

    expect(asMock(prisma.user.update).mock.calls[0][0]).toMatchObject({
      where: { id: 'u1' },
      data: { status: 'ACTIVE' },
    });
    expect(appeal.accountRestored).toBe(true);
  });

  test('APPROVED without restoreAccount never touches account status', async () => {
    asMock(prisma.accountAppeal.findUnique).mockResolvedValue(goodAppeal);
    asMock(prisma.accountAppeal.update).mockResolvedValue({ ...goodAppeal, status: 'APPROVED', accountRestored: false });

    const appeal: any = await appealService.decideAppeal('a1', 'admin1', { value: 'APPROVED' });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(appeal.accountRestored).toBe(false);
  });

  test('REJECTED never changes the account status', async () => {
    asMock(prisma.accountAppeal.findUnique).mockResolvedValue(goodAppeal);
    asMock(prisma.accountAppeal.update).mockResolvedValue({ ...goodAppeal, status: 'REJECTED', accountRestored: false });

    const appeal: any = await appealService.decideAppeal('a1', 'admin1', {
      value: 'REJECTED',
      note: 'Upheld.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(appeal.status).toBe('REJECTED');
  });

  test('APPROVED does not lift a different standing restriction', async () => {
    const staleAppeal = {
      ...goodAppeal,
      accountStatus: 'SUSPENDED',
      user: { ...goodAppeal.user, status: 'BANNED' },
    };
    asMock(prisma.accountAppeal.findUnique).mockResolvedValue(staleAppeal);
    asMock(prisma.accountAppeal.update).mockResolvedValue({ ...staleAppeal, status: 'APPROVED', accountRestored: false });

    const appeal: any = await appealService.decideAppeal('a1', 'admin1', {
      value: 'APPROVED',
      restoreAccount: true,
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(appeal.accountRestored).toBe(false);
  });

  test('deciding an already-decided appeal conflicts', async () => {
    asMock(prisma.accountAppeal.findUnique).mockResolvedValue({ ...goodAppeal, status: 'REJECTED' });
    await expect(
      appealService.decideAppeal('a1', 'admin1', { value: 'APPROVED', restoreAccount: true })
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPEAL_ALREADY_DECIDED' });
  });

  test('markUnderReview requires a pending appeal', async () => {
    asMock(prisma.accountAppeal.findUnique).mockResolvedValue({ ...goodAppeal, status: 'UNDER_REVIEW' });
    await expect(appealService.markUnderReview('a1', 'admin1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPEAL_STATE_CONFLICT',
    });

    asMock(prisma.accountAppeal.findUnique).mockResolvedValue(goodAppeal);
    asMock(prisma.accountAppeal.update).mockResolvedValue({ ...goodAppeal, status: 'UNDER_REVIEW' });
    const appeal: any = await appealService.markUnderReview('a1', 'admin1');
    expect(appeal.status).toBe('UNDER_REVIEW');
  });
});
