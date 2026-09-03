import { GiftService } from '../services/gift.service';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    gift: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn(),
    },
    giftTransaction: {
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    creatorDailyAnalytics: {
      upsert: jest.fn(),
    },
    analyticsEvent: {
      create: jest.fn(),
    },
    wallet: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/wallet.service', () => ({
  walletService: {
    deductCoins: jest.fn(),
    ensureWallet: jest.fn().mockResolvedValue({ id: 'wallet1', isFrozen: false, coinBalance: 100 }),
  },
}));

jest.mock('../services/notification.service', () => ({
  notificationService: {
    createNotification: jest.fn().mockResolvedValue({}),
  },
}));

const giftService = new GiftService();

describe('GiftService', () => {
  const mockGift = { id: 'gift1', slug: 'rose', name: 'Rose', price: 10, image: 'rose.png', category: 'flowers', isActive: true };
  const mockTransaction = {
    id: 'tx1',
    senderId: 'user1',
    receiverId: 'user2',
    giftId: 'gift1',
    amount: 10,
    createdAt: new Date(),
  };

  beforeEach(() => jest.clearAllMocks());

  describe('listGifts', () => {
    test('should return all gifts', async () => {
      (prisma.gift.count as jest.Mock).mockResolvedValue(1);
      (prisma.gift.findMany as jest.Mock).mockResolvedValue([mockGift]);
      const result = await giftService.listGifts();
      expect(result).toHaveLength(1);
    });
  });

  describe('sendGift', () => {
    test('should send gift successfully and update balances', async () => {
      (prisma.gift.findUnique as jest.Mock).mockResolvedValue(mockGift);
      (prisma.giftTransaction.create as jest.Mock).mockResolvedValue(mockTransaction);
      (prisma.wallet.update as jest.Mock).mockResolvedValue({});
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'user1', username: 'sender', fullName: null })
        .mockResolvedValueOnce({ id: 'user2', username: 'receiver', fullName: null });
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => callback({
        wallet: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'wallet1', coinBalance: 90 }),
          update: jest.fn().mockResolvedValue({ id: 'wallet2', earningsBalance: 7 }),
        },
        giftTransaction: {
          create: jest.fn().mockResolvedValue(mockTransaction),
        },
        walletTransaction: {
          create: jest.fn().mockResolvedValue({}),
        },
        creatorDailyAnalytics: {
          upsert: jest.fn().mockResolvedValue({}),
        },
        analyticsEvent: {
          create: jest.fn().mockResolvedValue({}),
        },
      }));

      const result = await giftService.sendGift('user1', 'user2', 'gift1');
      expect(result).toEqual(expect.objectContaining({
        transaction: mockTransaction,
        remainingBalance: 90,
        amount: 10,
        quantity: 1,
        gift: mockGift,
      }));
    });

    test('should throw for non-existent gift', async () => {
      (prisma.gift.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(giftService.sendGift('user1', 'user2', 'nonexistent')).rejects.toThrow('Gift not found');
    });

    test('should reject a gift when available coins are insufficient', async () => {
      (prisma.gift.findUnique as jest.Mock).mockResolvedValue(mockGift);
      const { walletService } = jest.requireMock('../services/wallet.service');
      walletService.ensureWallet
        .mockResolvedValueOnce({ id: 'wallet1', isFrozen: false, coinBalance: 9, lockedCoins: 0 })
        .mockResolvedValueOnce({ id: 'wallet2', isFrozen: false, coinBalance: 0, lockedCoins: 0 });

      await expect(giftService.sendGift('user1', 'user2', 'gift1')).rejects.toThrow('Insufficient coins');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('should reject sending a gift to yourself', async () => {
      (prisma.gift.findUnique as jest.Mock).mockResolvedValue(mockGift);
      await expect(giftService.sendGift('user1', 'user1', 'gift1')).rejects.toThrow('Cannot send a gift to yourself');
    });

    test('should replay an idempotent request without charging again', async () => {
      (prisma.gift.findUnique as jest.Mock).mockResolvedValue(mockGift);
      (prisma.giftTransaction.findUnique as jest.Mock).mockResolvedValue({ ...mockTransaction, requestId: 'gift_request_123456', quantity: 1 });
      const { walletService } = jest.requireMock('../services/wallet.service');
      walletService.ensureWallet.mockResolvedValue({ id: 'wallet1', isFrozen: false, coinBalance: 90, lockedCoins: 0 });

      const result = await giftService.sendGift('user1', 'user2', 'gift1', undefined, { requestId: 'gift_request_123456' });

      expect(result).toEqual(expect.objectContaining({ replayed: true, remainingBalance: 90 }));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getGiftHistory', () => {
    test('should return transaction history', async () => {
      (prisma.giftTransaction.findMany as jest.Mock).mockResolvedValue([mockTransaction]);
      const result = await giftService.getGiftHistory('user1');
      expect(result).toHaveLength(1);
    });
  });
});