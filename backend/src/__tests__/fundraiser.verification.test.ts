/**
 * Fundraiser verification policy:
 * Only VERIFIED users may create/start fundraisers (server-side authority).
 * Platform staff (ADMIN/CEO/SUPER_ADMIN) are exempt from the badge check.
 */
jest.mock('../prisma', () => ({ prisma: {
  user: { findUnique: jest.fn() },
  fundraiser: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
  fundraiserCategory: { findMany: jest.fn() },
  fundraiserAuditLog: { createMany: jest.fn(), findMany: jest.fn() },
  fundraiserReport: { findFirst: jest.fn(), create: jest.fn() },
  fundraiserEvidence: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  notification: { create: jest.fn() },
} }));

jest.mock('../services/notification.service', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../services/wallet.service', () => ({
  walletService: { debitCoins: jest.fn().mockResolvedValue({}), creditCoins: jest.fn().mockResolvedValue({}) },
}));

import { prisma } from '../prisma';
import { fundraiserService } from '../services/fundraiser.service';

const db = prisma as jest.Mocked<typeof prisma>;

describe('Fundraiser verification policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // uniqueSlug() lists existing slugs to compute a unique slug.
    (db.fundraiser.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('allows a VERIFIED user to create a fundraiser', async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', verified: true, role: 'USER', status: 'ACTIVE' });
    (db.fundraiser.findFirst as jest.Mock).mockResolvedValue(null);
    (db.fundraiser.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: 'f1', ...data }));

    const result = await fundraiserService.createDraft('u1', { title: 'Help a student' });
    expect(result).toBeTruthy();
    expect(db.fundraiser.create).toHaveBeenCalled();
  });

  it('rejects an UNVERIFIED user trying to create a fundraiser', async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', verified: false, role: 'USER', status: 'ACTIVE' });

    await expect(fundraiserService.createDraft('u1', { title: 'Sneaky campaign' }))
      .rejects.toThrow('Verification required to create a fundraiser');
    expect(db.fundraiser.create).not.toHaveBeenCalled();
  });

  it('rejects UNVERIFIED direct API attempts to submit a fundraiser for review', async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', verified: false, role: 'USER', status: 'ACTIVE' });

    await expect(fundraiserService.submitForReview('u1', 'f1'))
      .rejects.toThrow('Verification required to create a fundraiser');
    expect(db.fundraiser.findUnique).not.toHaveBeenCalled();
  });

  it('allows an UNVERIFIED ADMIN (platform staff) to create a fundraiser', async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue({ id: 'a1', verified: false, role: 'ADMIN', status: 'ACTIVE' });
    (db.fundraiser.findFirst as jest.Mock).mockResolvedValue(null);
    (db.fundraiser.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: 'f1', ...data }));

    const result = await fundraiserService.createDraft('a1', { title: 'Official campaign' });
    expect(result).toBeTruthy();
    expect(db.fundraiser.create).toHaveBeenCalled();
  });

  it('rejects creation by a suspended/unverified account', async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', verified: false, role: 'USER', status: 'SUSPENDED' });

    await expect(fundraiserService.createDraft('u1', { title: 'Nope' }))
      .rejects.toThrow('active');
  });
});