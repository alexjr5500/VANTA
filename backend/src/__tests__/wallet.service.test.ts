import { WalletService, formatSignedAmount, buildTransactionDescription, TX_TYPES } from '../services/wallet.service';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    wallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    transferLimit: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    walletPIN: {
      findUnique: jest.fn(),
    },
    walletTransaction: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    withdrawal: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    fraudAlert: {
      create: jest.fn(),
    },
    walletAuditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/notification.service', () => ({
  notificationService: {
    notifyWithdrawalStatus: jest.fn(),
  },
}));

const walletService = new WalletService();

describe('WalletService', () => {
  const mockWallet: any = {
    id: 'wallet1',
    userId: 'user1',
    coinBalance: 100,
    earningsBalance: 50,
    totalCoinsPurchased: 0,
    totalCoinsReceived: 0,
    totalCoinsSent: 0,
    totalGiftsSent: 0,
    totalGiftsReceived: 0,
    totalWithdrawn: 0,
    lifetimeEarnings: 0,
    bonusCoins: 0,
    lockedCoins: 0,
    isFrozen: false,
    usdtWalletAddress: null,
  };

  beforeEach(() => jest.clearAllMocks());

  describe('ensureWallet', () => {
    test('should create wallet if it does not exist', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.wallet.create as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.transferLimit.create as jest.Mock).mockResolvedValue({});

      const result = await walletService.ensureWallet('user1');
      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.create).toHaveBeenCalled();
      expect(prisma.transferLimit.create).toHaveBeenCalled();
    });

    test('should return existing wallet', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);

      const result = await walletService.ensureWallet('user1');
      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.create).not.toHaveBeenCalled();
    });
  });

  describe('getWallet', () => {
    test('should return wallet with derived balances', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.transferLimit.findUnique as jest.Mock).mockResolvedValue({ id: 'limit1' });
      (prisma.walletPIN.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.walletTransaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 } });

      const result = await walletService.getWallet('user1');
      expect(result.coinBalance).toBe(100);
      expect(result.hasPin).toBe(false);
      // VANTA Coins are valued at 100 coins per USD; earningsBalance is already USD.
      expect(result.totalPortfolioValue).toBe(51);
    });
  });

  describe('getBalance', () => {
    test('should return wallet balances', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.walletTransaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 } });

      const result = await walletService.getBalance('user1');
      expect(result.coinBalance).toBe(100);
      expect(result.earningsBalance).toBe(50);
      expect(result.totalPortfolioValue).toBe(51);
    });
  });

  describe('deductCoins', () => {
    test('should deduct coins if sufficient balance', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
        return cb({
          wallet: {
            update: jest.fn().mockResolvedValue({ ...mockWallet, coinBalance: 50 }),
          },
          walletTransaction: {
            create: jest.fn().mockResolvedValue({}),
          },
        });
      });

      const result = await walletService.deductCoins('user1', 50);
      expect(result.coinBalance).toBe(50);
    });

    test('should throw for insufficient coins', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);

      await expect(walletService.deductCoins('user1', 200)).rejects.toThrow('Insufficient coins');
    });

    test('should throw for frozen wallet', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ ...mockWallet, isFrozen: true });

      await expect(walletService.deductCoins('user1', 10)).rejects.toThrow('Wallet is frozen');
    });
  });

  describe('requestWithdrawal', () => {
    test('should block withdrawals from frozen wallets', async () => {
      await expect(walletService.requestWithdrawal('user1', 30, 'addr')).rejects.toThrow(
        'wallet is frozen'
      );
    });
  });

  describe('getWithdrawals', () => {
    test('should return withdrawal history', async () => {
      (prisma.withdrawal.findMany as jest.Mock).mockResolvedValue([{ id: 'wd1', amount: 30 }]);
      const result = await walletService.getWithdrawals('user1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getTransactionHistory', () => {
    test('should return transaction history', async () => {
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([{ id: 'tx1', amount: 10 }]);
      (prisma.walletTransaction.count as jest.Mock).mockResolvedValue(1);
      const result = await walletService.getTransactionHistory('user1');
      expect(result.transactions).toHaveLength(1);
    });
  });

  describe('freezeWallet', () => {
    test('should freeze a wallet', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.wallet.update as jest.Mock).mockResolvedValue({ ...mockWallet, isFrozen: true });

      const result = await walletService.freezeWallet('user1', 'admin1', 'fraud');
      expect(result.isFrozen).toBe(true);
    });
  });

  describe('unfreezeWallet', () => {
    test('should unfreeze a wallet', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ ...mockWallet, isFrozen: true });
      (prisma.wallet.update as jest.Mock).mockResolvedValue({ ...mockWallet, isFrozen: false });

      const result = await walletService.unfreezeWallet('user1', 'admin1');
      expect(result.isFrozen).toBe(false);
    });
  });

  describe('flagSuspiciousAccount', () => {
    test('should create fraud alert', async () => {
      (prisma.fraudAlert.create as jest.Mock).mockResolvedValue({ id: 'alert1' });

      const result = await walletService.flagSuspiciousAccount('user1', 'admin1', 'suspicious activity');
      expect(result).toBeDefined();
      expect(prisma.fraudAlert.create).toHaveBeenCalled();
    });
  });

  describe('saveUsdtWalletAddress', () => {
    test('should save USDT wallet address', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.wallet.update as jest.Mock).mockResolvedValue({ ...mockWallet, usdtWalletAddress: '0x123' });

      const result = await walletService.saveUsdtWalletAddress('user1', '0x123');
      expect(result.usdtWalletAddress).toBe('0x123');
    });
  });

  describe('formatSignedAmount', () => {
    test('should format incoming amount with plus sign', () => {
      expect(formatSignedAmount(100, true)).toBe('+100');
    });

    test('should format outgoing amount with minus sign', () => {
      expect(formatSignedAmount(100, false)).toBe('-100');
    });

    test('should never render double minus signs for outgoing amounts', () => {
      expect(formatSignedAmount(-100, false)).toBe('-100');
    });
  });

  describe('buildTransactionDescription', () => {
    test('should build transfer sent description', () => {
      const desc = buildTransactionDescription(TX_TYPES.TRANSFER_SENT, 50, '@user2');
      expect(desc).toContain('Sent 50 VANTA Coins to @user2');
    });

    test('should build deposit description', () => {
      const desc = buildTransactionDescription(TX_TYPES.DEPOSIT, 100);
      expect(desc).toContain('Deposited 100 VANTA Coins');
    });
  });
});