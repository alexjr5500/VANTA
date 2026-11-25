import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { walletService } from '../services';
import { AuthRequest } from '../middleware/auth.middleware';
import { getParamString } from '../utils/params';
import { requireAppOrigin } from '../utils/app-origin';
import { VANTA_COIN_PACKAGES, VANTA_COINS_PER_USD } from '../config/wallet.config';
import {
  getCoinPaymentMode,
  COIN_PAYMENT_MODE,
  COIN_PAYMENT_STATUS,
  SUPPORTED_COIN_PAYMENT_NETWORKS,
  getCoinPaymentDepositAddress,
} from '../config/coin-payments.config';
import { coinPaymentService, CoinPaymentUnavailableError } from '../services/coin-payment.service';
import { blockchainTxVerifier, BlockchainTxVerificationError } from '../services/blockchain-verifier.service';
import { getMinBlockchainConfirmations } from '../config/blockchain-networks.config';
import { PurchasePackageNotFoundError, isSystemOrDatabaseError } from '../errors/purchase.errors';

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
  // Deprecated: this legacy top-up endpoint let clients claim a payment was
  // completed and get coins credited. That violates the payment contract
  // ("never credit coins because a frontend request says payment was done").
  // Coin purchases MUST go through the verified Buy Coins flow:
  //   POST /api/wallets/payment-address  then  POST /api/wallets/verify-payment
  res.status(410).json({
    error:
      'This deposit method is deprecated and does not credit coins. ' +
      'Use POST /api/wallets/payment-address to start a coin purchase.',
  });
  return;
};

// ============================================================================
// COIN TRANSFERS
// ============================================================================

export const transferCoins = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const sessionId = req.user?.sessionId;
    const { receiverId, receiverUsername, amount, note, otpCode, requestId, challengeId, pinCode, twoFactorCode } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!amount) {
      res.status(400).json({ error: 'Amount is required' });
      return;
    }
    if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 100 || !/^[A-Za-z0-9._-]+$/.test(requestId)) {
      res.status(400).json({ error: 'A valid requestId (8-100 letters, numbers, . _ -) is required for every transfer' });
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
      userId, resolvedReceiverId, amount, note, otpCode, req.ip, undefined, requestId, challengeId, sessionId, pinCode, twoFactorCode
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

function historyFilters(query: Request['query']) {
  const str = (value: unknown) => typeof value === 'string' ? value.trim() : undefined;
  const date = (value: unknown) => {
    const text = str(value);
    if (!text) return undefined;
    const parsed = new Date(text);
    if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid transaction date.');
    return parsed;
  };
  const startDate = date(query.startDate), endDate = date(query.endDate);
  if (startDate && endDate && startDate > endDate) throw new Error('Invalid date range.');
  const direction = str(query.direction);
  if (direction && direction !== 'incoming' && direction !== 'outgoing') throw new Error('Invalid direction.');
  const status = str(query.status);
  if (status && !['COMPLETED','PENDING','FAILED','REVERSED'].includes(status)) throw new Error('Invalid transaction status.');
  const search = str(query.search);
  if (search && search.length > 120) throw new Error('Search is too long.');
  return { type: str(query.type), status, startDate, endDate, search, direction: direction as 'incoming' | 'outgoing' | undefined };
}

export const getCoinActivity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const days = Number(req.query.days ?? 7);
    if (days !== 7 && days !== 30 && days !== 90) { res.status(400).json({ error: 'Choose 7, 30 or 90 days.' }); return; }
    const result = await walletService.getCoinActivity(userId, days);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: 'Activity unavailable for this period. Try a shorter period or refresh.' });
  }
};

export const getTransactionHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const limit = Number(req.query.limit ?? 50), offset = Number(req.query.offset ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) { res.status(400).json({ error: 'Invalid pagination.' }); return; }
    const result = await walletService.getTransactionHistory(userId, { ...historyFilters(req.query), limit, offset });
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
    const { amount, walletAddress, pinCode, twoFactorCode } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!amount || !walletAddress) {
      res.status(400).json({ error: 'Amount and wallet address are required' });
      return;
    }
    const withdrawal = await walletService.requestWithdrawal(userId, amount, walletAddress, pinCode, twoFactorCode);
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

export const cancelWithdrawal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const withdrawalId = req.params.withdrawalId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!withdrawalId) {
      res.status(400).json({ error: 'withdrawalId is required' });
      return;
    }
    const withdrawal = await walletService.cancelWithdrawal(withdrawalId, userId);
    res.status(200).json({ message: 'Withdrawal cancelled', withdrawal });
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
function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  // Prefix spreadsheet formula-like text before CSV quoting.
  const safe = /^[\s\u0000-\u001f]*[=+@\-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

// EXPORT TRANSACTION HISTORY (CSV)
// ============================================================================

export const exportTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await walletService.getTransactionHistory(userId, { ...historyFilters(req.query), limit: 10000, offset: 0 });

    // Build CSV
    const headers = ['Date', 'Type', 'Currency', 'Description', 'Amount', 'Fee', 'Balance', 'Status', 'Reference'];
    const rows = result.transactions.map((tx: any) => [
      new Date(tx.createdAt).toISOString(),
      tx.type,
      tx.currency || 'VANTA',
      tx.description || '',
      tx.displayAmount ?? tx.amount ?? 0,
      tx.fee ?? 0,
      tx.balance ?? 0,
      tx.status,
      tx.reference || '',
    ]);

    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');

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
    // The DATABASE is the authoritative catalog. Serving the hard-coded config
    // constant here is what made the frontend and the DB disagree on package
    // ids, which broke `PurchaseOrder.packageId` foreign keys for every
    // purchase. Coin quantities and prices below are exactly the values that
    // get persisted on the order.
    const dbPackages = await prisma.sparkCoinPackage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    // Display-only badge hints keyed by canonical id (MOST_POPULAR / BEST_VALUE).
    // These are cosmetic; prices/coins above always come from the database.
    const badgeById = new Map<string, string | null>(VANTA_COIN_PACKAGES.map((p) => [p.id, p.badge ?? null]));

    const packages = dbPackages.map((p) => ({
      id: p.id,
      name: p.name,
      coins: p.coins,
      price: p.price,
      isPopular: p.isPopular,
      badge: badgeById.get(p.id) ?? null,
    }));

    res.status(200).json({ packages, exchangeRate: { coinsPerUsd: VANTA_COINS_PER_USD, currency: 'USD' } });
  } catch (error) {
    // Never leak raw database errors to the client; the frontend falls back to
    // its local package list when this endpoint fails.
    console.error('[COIN-PACKAGES] failed to load catalog from the database:', error);
    res.status(500).json({ error: 'Unable to load the coin package catalog. Please try again.' });
  }
};

export const getPaymentAddress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const payload = await coinPaymentService.initializeCoinPurchase(
      userId,
      req.body?.packageId,
      req.body?.network,
      req.ip
    );

    res.status(200).json(payload);
  } catch (error) {
    if (error instanceof CoinPaymentUnavailableError) {
      // User-facing message stays generic; the exact configuration problem was
      // logged server-side by the service.
      res.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof PurchasePackageNotFoundError) {
      // The package id is not a real, active database package — a clean 404.
      res.status(404).json({ error: error.message });
      return;
    }
    if (isSystemOrDatabaseError(error)) {
      // Never expose Prisma internals (e.g. foreign-key errors) to the user.
      console.error('[COIN-PURCHASE] payment-address failed:', error);
      res.status(400).json({ error: 'Unable to start this purchase. Please try again.' });
      return;
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const verifyPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { orderId, txHash, testConfirmation, simulateToken } = req.body;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!orderId || typeof orderId !== 'string') {
      res.status(400).json({ error: 'orderId is required' });
      return;
    }
    const order = await prisma.purchaseOrder.findFirst({ where: { id: orderId, userId } });
    if (!order) { res.status(404).json({ error: 'Purchase order not found.' }); return; }
    if (order.status === COIN_PAYMENT_STATUS.COMPLETED) {
      // Idempotent replay of a success callback/webhook — no second credit.
      res.status(200).json({ success: true, message: 'Purchase already confirmed.', coins: order.coins });
      return;
    }
    if (order.status === COIN_PAYMENT_STATUS.REFUNDED) {
      res.status(400).json({ error: 'This purchase was refunded and cannot be completed.' });
      return;
    }

    const mode = getCoinPaymentMode();

    if (mode === COIN_PAYMENT_MODE.TEST) {
      // Development/test payment mode: the backend test gateway requires an
      // explicit confirmation plus the HMAC simulate token it issued at
      // order-initialization time. No real funds move, and production
      // deployments can never run in test mode.
      if (testConfirmation !== true) {
        res.status(400).json({ error: 'A test payment confirmation is required to complete this simulated payment.' });
        return;
      }
      if (!txHash || typeof txHash !== 'string') {
        res.status(400).json({ error: 'testTransactionReference is required with the test payment confirmation.' });
        return;
      }
      const result = await coinPaymentService.completeTestPurchase(userId, order.id, {
        simulateToken,
        ipAddress: req.ip,
      });
      if (result.alreadyCompleted) {
        res.status(200).json({ success: true, message: 'Purchase already confirmed.', coins: result.coins, mode });
        return;
      }
      res.status(200).json({
        success: true,
        message: 'Simulated payment verified. Coins added to your balance.',
        coins: result.coins,
        balance: result.wallet?.coinBalance,
        mode,
        testSandbox: true,
      });
      return;
    }

    // LIVE mode: the client hash only drives server-side lookup. It never
    // authorizes a credit; the signed provider webhook/chain watcher remains the
    // only fulfillment path.
    const submittedTxHash = typeof req.body?.txHash === 'string' ? req.body.txHash.trim() : '';
    if (!/^0x[a-fA-F0-9]{64}$/.test(submittedTxHash)) {
      res.status(400).json({ success: false, terminal: true, code: 'INVALID_TX_HASH', message: 'Enter a valid transaction hash.' });
      return;
    }
    if (order.paymentMode !== 'live') {
      res.status(400).json({ success: false, terminal: true, code: 'ORDER_NOT_LIVE', message: 'This purchase is not a live crypto order.' });
      return;
    }
    const network = order.paymentMethod;
    if (!network || !SUPPORTED_COIN_PAYMENT_NETWORKS.includes(network as any)) {
      res.status(400).json({ success: false, terminal: true, code: 'UNSUPPORTED_NETWORK', message: 'This purchase network is not supported.' });
      return;
    }
    const expectedRecipient = getCoinPaymentDepositAddress();
    if (!expectedRecipient) {
      res.status(503).json({ error: 'Live payment receiving address is not configured.' });
      return;
    }
    const txHashNormalized = submittedTxHash.toLowerCase();

    try {
      const verified = await blockchainTxVerifier.verifyTransaction({
        txHash: txHashNormalized,
        network,
        expectedAmountUsd: order.amount,
        expectedRecipient,
        minConfirmations: getMinBlockchainConfirmations(),
      });
      const usedBy = await prisma.purchaseOrder.findFirst({
        where: { providerReference: txHashNormalized },
        select: { id: true },
      });
      if (usedBy && usedBy.id !== order.id) {
        res.status(409).json({ success: false, terminal: true, code: 'TX_ALREADY_USED', message: 'This transaction hash has already been used.' });
        return;
      }
      // Client verification is lookup-only. Fulfillment is exclusively atomic in
      // the authenticated provider webhook or chain watcher.
      const update = await prisma.purchaseOrder.updateMany({
        where: { id: order.id, userId, status: { in: [COIN_PAYMENT_STATUS.PENDING, COIN_PAYMENT_STATUS.PROCESSING] } },
        data: { providerReference: txHashNormalized },
      });
      if (update.count !== 1) {
        res.status(409).json({ success: false, terminal: true, code: 'ORDER_NOT_PENDING', message: 'This purchase is no longer awaiting payment.' });
        return;
      }
      res.status(202).json({ success: false, pending: true, orderId: order.id, status: order.status, confirmations: verified.confirmations, message: 'Payment verified on-chain and awaiting fulfillment.' });
    } catch (error) {
      if (error instanceof BlockchainTxVerificationError) {
        if (error.transient || error.code === 'RPC_UNAVAILABLE' || error.code === 'RPC_ERROR') {
          res.status(503).json({ success: false, retryable: true, code: error.code, message: 'The blockchain is temporarily unavailable. Check again shortly.' });
          return;
        }
        if (error.code === 'LOW_CONFIRMATIONS' || error.code === 'TRANSACTION_PENDING') {
          res.status(202).json({ success: false, pending: true, code: error.code, orderId: order.id, status: order.status, message: error.message });
          return;
        }
        res.status(400).json({ success: false, terminal: true, code: error.code, message: error.message });
        return;
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof CoinPaymentUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (isSystemOrDatabaseError(error)) {
      // Never expose Prisma internals (e.g. foreign-key errors) to the user.
      console.error('[COIN-PURCHASE] verify-payment failed:', error);
      res.status(400).json({ error: 'Unable to confirm this payment. Please try again.' });
      return;
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getCoinPurchases = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await coinPaymentService.getUserPurchases(userId, limit, offset);
    res.status(200).json(result);
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


/** Authenticated, recipient-only share link. Contains no wallet credentials. */
export const getReceiveLink = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
    if (!user) { res.status(404).json({ error: 'Recipient unavailable' }); return; }
    const link = new URL('/balance', requireAppOrigin());
    link.searchParams.set('recipient', user.id);
    const qrCode = await require('qrcode').toDataURL(link.href, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ username: user.username, link: link.href, qrCode });
  } catch {
    res.status(503).json({ error: 'Receiving link is temporarily unavailable.' });
  }
};

export const resolveReceiveRecipient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id) || id === req.user?.userId) {
      res.status(400).json({ error: 'Invalid recipient' }); return;
    }
    const user = await prisma.user.findFirst({ where: { id, status: 'ACTIVE' }, select: { id: true, username: true, fullName: true, avatar: true, verified: true } });
    if (!user) { res.status(404).json({ error: 'Recipient unavailable' }); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ user });
  } catch {
    res.status(503).json({ error: 'Unable to verify recipient.' });
  }
};
