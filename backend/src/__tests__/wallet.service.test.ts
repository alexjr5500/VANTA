import { WalletService, formatSignedAmount, buildTransactionDescription, TX_TYPES } from '../services/wallet.service';
jest.mock('bcryptjs', () => ({ compare: jest.fn().mockResolvedValue(true) }));
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
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    withdrawal: {
      aggregate: jest.fn(),
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
    walletReconciliationLog: {
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

      (prisma.walletTransaction.groupBy as jest.Mock).mockResolvedValue([
        {currency: 'VANTA', _count: {_all: 1}, _sum: {amount: 10}},
        {currency: 'USD', _count: {_all: 1}, _sum: {amount: 2}},
      ]);
      (prisma.withdrawal.aggregate as jest.Mock).mockResolvedValue({_count: {_all: 1}, _sum: {amount: 20, netAmount: 18}});
      const result = await walletService.getWallet('user1');
      expect(result.availableCoins).toBe(100);
      expect(result.pendingTransactions).toEqual([{currency:'VANTA',count:1,amount:10},{currency:'USD',count:1,amount:2}]);
      expect(result.pendingWithdrawals).toEqual({count:1,grossUsd:20,netUsd:18});
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
            findUniqueOrThrow: jest.fn()
              .mockResolvedValueOnce(mockWallet)
              .mockResolvedValueOnce({ ...mockWallet, coinBalance: 50 }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ ...mockWallet, isFrozen: true });
      (prisma.walletPIN.findUnique as jest.Mock).mockResolvedValue({ id: 'pin1', walletId: 'wallet1', pinHash: 'hash', failedAttempts: 0, lockedUntil: null });
      await expect(walletService.requestWithdrawal('user1', 30, `0x${'a'.repeat(40)}`, '1234')).rejects.toThrow(
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

  describe('Balance 2.0 activity and history', () => {
    test('groups real completed coin activity without counting reservations or unknown claims', async () => {
      const row = (type: string, amount: number, metadata: string | null = null, fee = 0) => ({ type, amount, metadata, fee, currency: 'VANTA', createdAt: new Date() });
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
        row(TX_TYPES.PURCHASE,100),
        row(TX_TYPES.TRANSFER_SENT,21,null,1),
        row(TX_TYPES.GIFT_RECEIVED,7,JSON.stringify({autoConverted:true})),
        row(TX_TYPES.FOLLOWER_REWARD_RESERVE,50),
        row(TX_TYPES.FOLLOWER_REWARD_CLAIM,5,JSON.stringify({side:'creator'})),
        row(TX_TYPES.FOLLOWER_REWARD_CLAIM,3,null),
      ]);
      const result = await walletService.getCoinActivity('user1',7);
      expect(result.buckets).toHaveLength(7);
      expect(result.buckets[6]).toMatchObject({ incoming:107,outgoing:26,purchases:100,giftsReceived:7,transferFees:1,net:81 });
      expect(result.excluded).toBe(1);
      expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({userId:'user1',currency:'VANTA',status:'COMPLETED'})}));
    });
    test('history filters are scoped to authenticated owner and applied before pagination', async () => {
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.walletTransaction.count as jest.Mock).mockResolvedValue(0);
      await walletService.getTransactionHistory('user1',{search:'@alice',type:'transfers',direction:'outgoing',status:'COMPLETED',limit:10,offset:20});
      expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({userId:'user1',status:'COMPLETED',type:{in:['TRANSFER_SENT','TRANSFER_RECEIVED']},AND:expect.any(Array)}),take:10,skip:20}));
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
    const validAddress = '0x' + 'a'.repeat(40);

    test('should save a valid BEP-20 wallet address', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (prisma.wallet.update as jest.Mock).mockResolvedValue({ ...mockWallet, usdtWalletAddress: validAddress });

      const result = await walletService.saveUsdtWalletAddress('user1', validAddress);
      expect(result.usdtWalletAddress).toBe(validAddress);
    });

    test('should reject invalid and zero addresses before writing', async () => {
      await expect(walletService.saveUsdtWalletAddress('user1', '0x123'))
        .rejects.toThrow('Enter a valid non-zero BNB Smart Chain (BEP-20) address');
      await expect(walletService.saveUsdtWalletAddress('user1', '0x' + '0'.repeat(40)))
        .rejects.toThrow('Enter a valid non-zero BNB Smart Chain (BEP-20) address');
      expect(prisma.wallet.update).not.toHaveBeenCalled();
    });
  });

  describe('reverseTransaction', () => {
    const runReversal = async (transaction: any, wallet: any, updatedWallet: any, claimCount = 1) => {
      const tx = {
        walletTransaction: {
          findUnique: jest.fn().mockResolvedValue(transaction),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockResolvedValue({}),
        },
        wallet: {
          findUnique: jest.fn().mockResolvedValue(wallet),
          findUniqueOrThrow: jest.fn().mockResolvedValue(updatedWallet),
          updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
        },
        walletAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
      return { result: await walletService.reverseTransaction('tx1', 'admin1', 'fraud review'), tx };
    };

    test('reverses an incoming purchase as a debit with an accurate ledger snapshot', async () => {
      const transaction = { id: 'tx1', userId: 'user1', type: TX_TYPES.PURCHASE, currency: 'VANTA', amount: 40, status: 'COMPLETED', reference: 'purchase1' };
      const wallet = { ...mockWallet, coinBalance: 100, lockedCoins: 20 };
      const updatedWallet = { ...wallet, coinBalance: 60 };
      const { result, tx } = await runReversal(transaction, wallet, updatedWallet);
      expect(result.success).toBe(true);
      expect(tx.wallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'user1', coinBalance: 100, lockedCoins: 20 },
        data: { coinBalance: { increment: -40 } },
      }));
      expect(tx.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          type: TX_TYPES.ADMIN_DEBIT,
          amount: 40,
          balanceBefore: 100,
          balance: 60,
          currency: 'VANTA',
        }),
      }));
    });

    test('reverses an outgoing transfer as a credit', async () => {
      const transaction = { id: 'tx1', userId: 'user1', type: TX_TYPES.TRANSFER_SENT, currency: 'VANTA', amount: 30, status: 'COMPLETED', reference: 'transfer1' };
      const wallet = { ...mockWallet, coinBalance: 70 };
      const updatedWallet = { ...wallet, coinBalance: 100 };
      const { tx } = await runReversal(transaction, wallet, updatedWallet);
      expect(tx.wallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { coinBalance: { increment: 30 } },
      }));
      expect(tx.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: TX_TYPES.ADMIN_CREDIT, amount: 30 }),
      }));
    });

    test('reverses a creator-side follower reward claim as a credit', async () => {
      const transaction = { id: 'tx1', userId: 'user1', type: TX_TYPES.FOLLOWER_REWARD_CLAIM, currency: 'VANTA', amount: 30, metadata: JSON.stringify({ side: 'creator' }), status: 'COMPLETED' };
      const wallet = { ...mockWallet, coinBalance: 70 };
      const updatedWallet = { ...wallet, coinBalance: 100 };
      const { tx } = await runReversal(transaction, wallet, updatedWallet);
      expect(tx.wallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { coinBalance: { increment: 30 } },
      }));
      expect(tx.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: TX_TYPES.ADMIN_CREDIT, amount: 30 }),
      }));
    });

    test('reverses a claimant-side follower reward claim as a debit', async () => {
      const transaction = { id: 'tx1', userId: 'user1', type: TX_TYPES.FOLLOWER_REWARD_CLAIM, currency: 'VANTA', amount: 30, metadata: JSON.stringify({ side: 'claimant' }), status: 'COMPLETED' };
      const wallet = { ...mockWallet, coinBalance: 100 };
      const updatedWallet = { ...wallet, coinBalance: 70 };
      const { tx } = await runReversal(transaction, wallet, updatedWallet);
      expect(tx.wallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { coinBalance: { increment: -30 } },
      }));
      expect(tx.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: TX_TYPES.ADMIN_DEBIT, amount: 30 }),
      }));
    });

    test('refuses to reverse a follower reward claim with missing side metadata', async () => {
      const transaction = { id: 'tx1', userId: 'user1', type: TX_TYPES.FOLLOWER_REWARD_CLAIM, currency: 'VANTA', amount: 30, status: 'COMPLETED' };
      const tx = { walletTransaction: { findUnique: jest.fn().mockResolvedValue(transaction), updateMany: jest.fn() } };
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
      await expect(walletService.reverseTransaction('tx1', 'admin1', 'review')).rejects.toThrow('direction cannot be safely reversed');
      expect(tx.walletTransaction.updateMany).not.toHaveBeenCalled();
    });

    test('refuses to consume locked coins when reversing an incoming transaction', async () => {
      const transaction = { id: 'tx1', userId: 'user1', type: TX_TYPES.PURCHASE, currency: 'VANTA', amount: 90, status: 'COMPLETED' };
      const wallet = { ...mockWallet, coinBalance: 100, lockedCoins: 20 };
      const tx = {
        walletTransaction: { findUnique: jest.fn().mockResolvedValue(transaction), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        wallet: { findUnique: jest.fn().mockResolvedValue(wallet), updateMany: jest.fn() },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
      await expect(walletService.reverseTransaction('tx1', 'admin1', 'fraud review')).rejects.toThrow('locked funds');
      expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    });

    test('fails safely if the wallet changed before the reversal update', async () => {
      const transaction = { id: 'tx1', userId: 'user1', type: TX_TYPES.PURCHASE, currency: 'VANTA', amount: 20, status: 'COMPLETED' };
      const wallet = { ...mockWallet, coinBalance: 100 };
      const tx = {
        walletTransaction: { findUnique: jest.fn().mockResolvedValue(transaction), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        wallet: { findUnique: jest.fn().mockResolvedValue(wallet), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
      await expect(walletService.reverseTransaction('tx1', 'admin1', 'fraud review')).rejects.toThrow('Wallet changed');
    });
  });

  describe('reconcileWallet follower reward claim direction', () => {
    test.each([
      ['creator', 70, 70],
      ['claimant', 30, 30],
    ])('reconciles %s-side follower reward entries with the correct sign', async (side, storedBalance, expectedLedgerBalance) => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ ...mockWallet, coinBalance: storedBalance });
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
        { type: TX_TYPES.FOLLOWER_REWARD_CLAIM, amount: 30, currency: 'VANTA', metadata: JSON.stringify({ side }) },
        ...(side === 'creator' ? [{ type: TX_TYPES.PURCHASE, amount: 100, currency: 'VANTA', metadata: null }] : []),
      ]);
      (prisma.walletReconciliationLog.create as jest.Mock).mockImplementation(async ({ data }: any) => ({ id: 'recon1', ...data }));

      const result = await walletService.reconcileWallet('user1');
      expect(result.ledgerBalance).toBe(expectedLedgerBalance);
      expect(result.status).toBe('MATCH');
    });

    test('does not guess when follower reward side metadata is missing', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ ...mockWallet, coinBalance: 30 });
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
        { type: TX_TYPES.FOLLOWER_REWARD_CLAIM, amount: 30, currency: 'VANTA', metadata: null },
      ]);
      (prisma.walletReconciliationLog.create as jest.Mock).mockImplementation(async ({ data }: any) => ({ id: 'recon2', ...data }));

      const result = await walletService.reconcileWallet('user1');
      expect(result.ledgerBalance).toBe(0);
      expect(result.status).toBe('DISCREPANCY');
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