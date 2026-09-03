import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { walletService } from '../services';
import { AuthRequest } from '../middleware/auth.middleware';
import { getParamString } from '../utils/params';
import { VANTA_COIN_PACKAGES, VANTA_COINS_PER_USD } from '../config/wallet.config';

// ============================================================================
// WALLET & BALANCE
// ============================================================================

export const getWallet = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const wallet = await walletService.getWallet(userId);
    res.status(200).json(wallet);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const getBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const balance = await walletService.getBalance(userId);
    res.status(200).json(balance);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

// ============================================================================
// COIN DEPOSITS
// ============================================================================

export const processDeposit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { amount, coins, paymentMethod, providerOrderId } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!amount || !coins || !paymentMethod || !providerOrderId) {
      res.status(400).json({ error: 'Amount, coins, paymentMethod, and providerOrderId are required' });
      return;
    }
    const wallet = await walletService.processDeposit(
      userId, amount, coins, paymentMethod, providerOrderId, req.ip
    );
    res.status(200).json({ message: 'Deposit successful', wallet });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// COIN TRANSFERS
// ============================================================================

export const transferCoins = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { receiverId, receiverUsername, amount, note, otpCode } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!amount) {
      res.status(400).json({ error: 'Amount is required' });
      return;
    }

    // Resolve receiver by ID or username
    let resolvedReceiverId = receiverId;
    if (!resolvedReceiverId && receiverUsername) {
      const receiver = await prisma.user.findFirst({
        where: { username: receiverUsername.replace('@', '') },
        select: { id: true },
      });
      if (!receiver) {
        res.status(404).json({ error: 'Recipient not found' });
        return;
      }
      resolvedReceiverId = receiver.id;
    }

    if (!resolvedReceiverId) {
      res.status(400).json({ error: 'Receiver ID or username is required' });
      return;
    }

    const result = await walletService.transferCoins(
      userId, resolvedReceiverId, amount, note, otpCode, req.ip
    );
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// WALLET PIN
// ============================================================================

export const setupPin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { pin } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!pin) { res.status(400).json({ error: 'PIN is required' }); return; }
    const result = await walletService.setupPin(userId, pin);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const updatePin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { oldPin, newPin } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!oldPin || !newPin) { res.status(400).json({ error: 'Old PIN and new PIN are required' }); return; }
    const result = await walletService.updatePin(userId, oldPin, newPin);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const verifyPin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { pin } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!pin) { res.status(400).json({ error: 'PIN is required' }); return; }
    const result = await walletService.verifyPin(userId, pin);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// TRANSFER LIMITS
// ============================================================================

export const updateTransferLimit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { dailyLimit, singleTxLimit, otpThreshold } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await walletService.updateTransferLimit(userId, { dailyLimit, singleTxLimit, otpThreshold });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// TRANSACTION HISTORY
// ============================================================================

export const getTransactionHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { type, status, startDate, endDate, search, limit, offset } = req.query;
    const result = await walletService.getTransactionHistory(userId, {
      type: type as string,
      status: status as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      search: search as string,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getTransfersSent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await walletService.getTransfersSent(userId, limit, offset);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getTransfersReceived = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await walletService.getTransfersReceived(userId, limit, offset);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getGiftHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const history = await walletService.getGiftHistory(userId, limit);
    res.status(200).json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getDeposits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await walletService.getDeposits(userId, limit, offset);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// WITHDRAWALS (Disabled)
// ============================================================================

export const requestWithdrawal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { amount, walletAddress } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!amount || !walletAddress) {
      res.status(400).json({ error: 'Amount and wallet address are required' });
      return;
    }
    const withdrawal = await walletService.requestWithdrawal(userId, amount, walletAddress);
    res.status(201).json({ message: 'Withdrawal request created', withdrawal });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getWithdrawals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 20;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const withdrawals = await walletService.getWithdrawals(userId, limit);
    res.status(200).json(withdrawals);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getWithdrawalHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await walletService.getWithdrawalHistory(userId, limit, offset);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// EXPORT TRANSACTION HISTORY (CSV)
// ============================================================================

export const exportTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { type, status, startDate, endDate } = req.query;
    const result = await walletService.getTransactionHistory(userId, {
      type: type as string,
      status: status as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: 10000,
      offset: 0,
    });

    // Build CSV
    const headers = ['Date', 'Type', 'Description', 'Amount', 'Fee', 'Balance', 'Status', 'Reference'];
    const rows = result.transactions.map((tx: any) => [
      new Date(tx.createdAt).toISOString(),
      tx.type,
      `"${(tx.description || '').replace(/"/g, '""')}"`,
      tx.displayAmount ?? tx.amount ?? 0,
      tx.fee ?? 0,
      tx.balance ?? 0,
      tx.status,
      tx.reference || '',
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vanta-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// WALLET ADDRESS
// ============================================================================

export const saveWalletAddress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { address } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!address) { res.status(400).json({ error: 'Wallet address is required' }); return; }
    const wallet = await walletService.saveUsdtWalletAddress(userId, address);
    res.status(200).json({ message: 'USDT (BEP-20) wallet address saved successfully', wallet });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// WALLET ANALYTICS
// ============================================================================

export const getWalletAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const analytics = await walletService.getWalletAnalytics();
    res.status(200).json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// COIN PACKAGES (Buy Coins)
// ============================================================================

export const getCoinPackages = async (req: Request, res: Response): Promise<void> => {
  try {
    // Pricing is configuration, not mutable client data. Return the canonical catalog.
    res.status(200).json({ packages: VANTA_COIN_PACKAGES, exchangeRate: { coinsPerUsd: VANTA_COINS_PER_USD, currency: 'USD' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getPaymentAddress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { packageId, network } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!packageId || !network) {
      res.status(400).json({ error: 'packageId and network are required' });
      return;
    }
    const configuredPackage = VANTA_COIN_PACKAGES.find(pkg => pkg.id === packageId || String(pkg.coins) === packageId);
    if (!configuredPackage) { res.status(400).json({ error: 'Invalid coin package' }); return; }
    const amount = configuredPackage.price;
    const paymentAddress = process.env.VANTA_COIN_PAYMENT_ADDRESS?.trim();
    if (!paymentAddress) {
      res.status(503).json({ error: 'Coin purchases are temporarily unavailable.' });
      return;
    }

    // Create a pending purchase order to track the payment
    const order = await prisma.purchaseOrder.create({
      data: {
        userId,
        coins: configuredPackage.coins + configuredPackage.bonusCoins,
        amount,
        currency: 'USD',
        provider: 'crypto',
        status: 'PENDING',
        paymentMethod: network,
      },
    });

    res.status(200).json({
      address: paymentAddress,
      orderId: order.id,
      network,
      amount,
      expiresIn: 30 * 60, // 30 minutes
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const verifyPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { orderId, txHash } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!orderId || typeof txHash !== 'string' || !txHash.trim()) {
      res.status(400).json({ error: 'orderId and transaction reference are required' });
      return;
    }
    const order = await prisma.purchaseOrder.findFirst({ where: { id: orderId, userId } });
    if (!order) { res.status(404).json({ error: 'Purchase order not found.' }); return; }
    if (order.status === 'COMPLETED') {
      res.status(200).json({ success: true, message: 'Purchase already confirmed.', coins: order.coins });
      return;
    }

    // Coin crediting belongs to a trusted provider webhook after provider-side
    // amount, asset, destination and confirmation checks. A client-submitted
    // transaction reference is never proof of payment.
    res.status(202).json({ success: false, pending: true, message: 'Payment is awaiting provider verification.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// USER SEARCH (Send Coins flow)
// ============================================================================

export const searchWalletUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query || query.length < 2) {
      res.status(200).json({ users: [] });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { username: { contains: query } },
          { fullName: { contains: query } },
        ],
      } as any,
      select: {
        id: true,
        username: true,
        fullName: true,
        avatar: true,
        verified: true,
      },
      take: 10,
    });

    res.status(200).json({ users });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
