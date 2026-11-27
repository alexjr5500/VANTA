import { Router } from 'express';
import { 
  getWallet, getBalance, getTransactionHistory, getTransfersSent, getTransfersReceived,
  getGiftHistory, getDeposits, getWithdrawalHistory,
  saveWalletAddress, requestWithdrawal, getWithdrawals, cancelWithdrawal,
  processDeposit, transferCoins,
  setupPin, updatePin, verifyPin,
  updateTransferLimit,
  getCoinPackages, searchWalletUsers, getPaymentAddress, verifyPayment,
  getCoinPurchases,
  exportTransactions, getCoinActivity, getReceiveLink, resolveReceiveRecipient,
} from '../controllers/wallet.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { rateLimiter } from '../security/rateLimiter';

import { shopLiveCryptoEnabled } from '../config/shop-crypto.config';
import { createShopCryptoInvoice, resumeShopCryptoInvoice, checkShopCryptoInvoice } from '../services/shop-crypto.service';
import { shopSandboxEnabled } from '../config/shop-sandbox.config';

const router = Router();

const purchasesUnderMaintenance = (_req: any, res: any) => res.status(503).json({
  code: 'PURCHASES_UNDER_MAINTENANCE',
  error: 'Purchases are temporarily under maintenance. Please try again later.',
});

router.use(authenticateJWT);

// Wallet info
router.get('/me', getWallet);
router.get('/balance', getBalance);

// Deposits
router.post('/deposit', processDeposit);
router.get('/deposits', getDeposits);

// Transfers
// Rate-limited so a single account cannot mint/spam OTP challenges or probe
// codes — the OTP limiter window/max comes from RATE_LIMIT_OTP_* env config.
router.post('/transfer', rateLimiter.otp, transferCoins);
router.get('/transfers/sent', getTransfersSent);
router.get('/transfers/received', getTransfersReceived);

// PIN management
router.post('/pin/setup', rateLimiter.otp, setupPin);
router.post('/pin/update', rateLimiter.otp, updatePin);
router.post('/pin/verify', rateLimiter.otp, verifyPin);

// Transfer limits
router.put('/limits', updateTransferLimit);

// Transaction history
router.get('/activity', getCoinActivity);
router.get('/transactions', getTransactionHistory);
router.get('/transactions/export', exportTransactions);
router.get('/gift-history', getGiftHistory);

// Withdrawals (disabled)
router.post('/withdraw', rateLimiter.otp, requestWithdrawal);
router.post('/withdrawals/:withdrawalId/cancel', cancelWithdrawal);
router.get('/withdrawals', getWithdrawals);
router.get('/withdrawals/history', getWithdrawalHistory);

// Wallet address
router.post('/address', saveWalletAddress);

// Coin packages (Buy Coins flow)
router.get('/packages', getCoinPackages);
router.get('/shop-capabilities', (_req, res) => res.json({ sandbox: shopSandboxEnabled(), liveCrypto: shopLiveCryptoEnabled() }));
router.post('/payment-address', rateLimiter.otp, (req, res) => shopSandboxEnabled() ? getPaymentAddress(req, res) : purchasesUnderMaintenance(req, res));
router.post('/verify-payment', rateLimiter.otp, (req, res) => shopSandboxEnabled() ? verifyPayment(req, res) : purchasesUnderMaintenance(req, res));
// Dedicated invoice route; legacy shared-wallet live endpoints remain blocked.
router.post('/shop/crypto/invoices', rateLimiter.otp, async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!shopLiveCryptoEnabled()) { purchasesUnderMaintenance(req, res); return; }
  if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try { res.status(201).json(await createShopCryptoInvoice(req.user.userId, req.body || {})); }
  catch (e) { console.warn('[SHOP-CRYPTO] Invoice creation failed'); res.status(400).json({ error: 'Could not create payment invoice. Check the selection or try again later.' }); }
});
router.get('/shop/crypto/invoices/:orderId', async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!shopLiveCryptoEnabled()) { purchasesUnderMaintenance(req, res); return; }
  if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(await resumeShopCryptoInvoice(req.user.userId, req.params.orderId)); }
  catch { res.status(404).json({ error: 'Invoice unavailable' }); }
});
router.post('/shop/crypto/invoices/:orderId/check', rateLimiter.otp, async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!shopLiveCryptoEnabled()) { purchasesUnderMaintenance(req, res); return; }
  if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try { res.json(await checkShopCryptoInvoice(req.user.userId, req.params.orderId, typeof req.body?.txHash === 'string' ? req.body.txHash.trim() : undefined)); }
  catch { res.status(400).json({ error: 'Could not verify payment. Check the transaction hash or try again shortly.' }); }
});
// Coin purchase history for the authenticated user
router.get('/purchases', getCoinPurchases);

// User search (Send Coins flow)
router.get('/users/search', searchWalletUsers);
router.get('/receive-link', getReceiveLink);
router.get('/receive-recipient', resolveReceiveRecipient);


export default router;
