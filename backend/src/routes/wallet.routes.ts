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

import { shopCoinBadgeEnabled } from '../config/shop-coin-badge.config';
import { buyBadgeWithCoins } from '../services/shop-coin-badge.service';
import { shopCardEnabled } from '../config/shop-card.config';
import { createShopCardCheckout, checkShopCardCheckout, resumeShopCardCheckout, listShopCardCheckouts } from '../services/shop-card.service';
import { shopLiveCryptoEnabled } from '../config/shop-crypto.config';
import { createShopCryptoInvoice, resumeShopCryptoInvoice, checkShopCryptoInvoice, listShopCryptoInvoices, shopCryptoStatus } from '../services/shop-crypto.service';
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
router.get('/shop-capabilities', (_req, res) => res.json({ sandbox: shopSandboxEnabled(), liveCrypto: shopLiveCryptoEnabled(), cardTest: shopCardEnabled(), coinBadge: shopCoinBadgeEnabled() }));
router.post('/payment-address', rateLimiter.otp, (req, res) => shopSandboxEnabled() ? getPaymentAddress(req, res) : purchasesUnderMaintenance(req, res));
router.post('/verify-payment', rateLimiter.otp, (req, res) => shopSandboxEnabled() ? verifyPayment(req, res) : purchasesUnderMaintenance(req, res));
router.post('/shop/badges/coins', rateLimiter.otp, async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!shopCoinBadgeEnabled()) { purchasesUnderMaintenance(req, res); return; }
  if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(await buyBadgeWithCoins(req.user.userId, req.body || {})); }
  catch (e) { res.status(400).json({ error: e instanceof Error && !/prisma|invocation|database|constraint/i.test(e.message) && e.message.length < 160 ? e.message : 'Could not complete coin badge purchase' }); }
});
// Hosted Stripe test checkout is web-only; Android Play Billing is separate.
const cardWebOnly = (req: import('../middleware/auth.middleware').AuthRequest, res: import('express').Response): boolean => {
  if (!shopCardEnabled() || /VANTAAndroid/i.test(req.get('user-agent') || '')) { res.status(503).json({ error: 'Web card test checkout unavailable' }); return false; }
  if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  res.setHeader('Cache-Control', 'no-store');
  return true;
};
router.post('/shop/card/checkouts', rateLimiter.otp, async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!cardWebOnly(req, res)) return;
  try { res.status(201).json(await createShopCardCheckout(req.user!.userId, req.body || {})); }
  catch { res.status(400).json({ error: 'Unable to initialize card checkout. Review the selection and try again.' }); }
});
router.get('/shop/card/checkouts', async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!cardWebOnly(req, res)) return;
  try { res.json(await listShopCardCheckouts(req.user!.userId)); }
  catch { res.status(503).json({ error: 'Could not load card orders' }); }
});
router.get('/shop/card/checkouts/:orderId', async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!cardWebOnly(req, res)) return;
  try { res.json(await resumeShopCardCheckout(req.user!.userId, req.params.orderId)); }
  catch { res.status(404).json({ error: 'Card checkout unavailable' }); }
});
router.post('/shop/card/checkouts/:orderId/check', rateLimiter.otp, async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!cardWebOnly(req, res)) return;
  try { res.json(await checkShopCardCheckout(req.user!.userId, req.params.orderId)); }
  catch { res.status(503).json({ error: 'Card confirmation unavailable. Retry before starting another payment.' }); }
});
// Dedicated invoice route; legacy shared-wallet live endpoints remain blocked.
router.post('/shop/crypto/invoices', rateLimiter.otp, async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!shopLiveCryptoEnabled()) { purchasesUnderMaintenance(req, res); return; }
  if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try { res.status(201).json(await createShopCryptoInvoice(req.user.userId, req.body || {})); }
  catch (e) { console.warn('[SHOP-CRYPTO] Invoice creation failed'); res.status(400).json({ error: 'Could not create payment invoice. Check the selection or try again later.' }); }
});
router.get('/shop/crypto/invoices', async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!shopLiveCryptoEnabled()) { purchasesUnderMaintenance(req, res); return; }
  if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(await listShopCryptoInvoices(req.user.userId)); }
  catch { res.status(503).json({ error: 'Could not load pending invoices' }); }
});
router.get('/shop/crypto/invoices/:orderId/status', async (req: import('../middleware/auth.middleware').AuthRequest, res) => {
  if (!req.user?.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(await shopCryptoStatus(req.user.userId, req.params.orderId)); }
  catch { res.status(404).json({ error: 'Invoice unavailable' }); }
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
