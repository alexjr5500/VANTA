import { Router } from 'express';
import { 
  getWallet, getBalance, getTransactionHistory, getTransfersSent, getTransfersReceived,
  getGiftHistory, getDeposits, getWithdrawalHistory,
  saveWalletAddress, requestWithdrawal, getWithdrawals,
  processDeposit, transferCoins,
  setupPin, updatePin, verifyPin,
  updateTransferLimit, getWalletAnalytics,
  getCoinPackages, getPaymentAddress, verifyPayment, searchWalletUsers,
  exportTransactions,
} from '../controllers/wallet.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT);

// Wallet info
router.get('/me', getWallet);
router.get('/balance', getBalance);

// Deposits
router.post('/deposit', processDeposit);
router.get('/deposits', getDeposits);

// Transfers
router.post('/transfer', transferCoins);
router.get('/transfers/sent', getTransfersSent);
router.get('/transfers/received', getTransfersReceived);

// PIN management
router.post('/pin/setup', setupPin);
router.post('/pin/update', updatePin);
router.post('/pin/verify', verifyPin);

// Transfer limits
router.put('/limits', updateTransferLimit);

// Transaction history
router.get('/transactions', getTransactionHistory);
router.get('/transactions/export', exportTransactions);
router.get('/gift-history', getGiftHistory);

// Withdrawals (disabled)
router.post('/withdraw', requestWithdrawal);
router.get('/withdrawals', getWithdrawals);
router.get('/withdrawals/history', getWithdrawalHistory);

// Wallet address
router.post('/address', saveWalletAddress);

// Coin packages (Buy Coins flow)
router.get('/packages', getCoinPackages);
router.post('/payment-address', getPaymentAddress);
router.post('/verify-payment', verifyPayment);

// User search (Send Coins flow)
router.get('/users/search', searchWalletUsers);

// Analytics
router.get('/analytics', getWalletAnalytics);

export default router;
