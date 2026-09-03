import { Router } from 'express';
import { authenticate, checkLoginAttempts, rateLimiter, requirePermission, Permission } from '../security';
import { prisma } from '../prisma';
import {
  register,
  login,
  logout,
  refreshToken,
  getMe,
  getSessions,
  googleAuth,
  appleAuth,
  phoneSendOTP,
  phoneVerifyOTP,
  forgotPassword,
  resetPassword,
  verifyResetToken,
  changePassword,
  verifyEmail,
  setup2FA,
  enable2FA,
  verify2FA,
  disable2FA,
  get2FAStatus,
  getBackupCodes,
  regenerateBackupCodes,
  revokeSession,
  revokeAllSessions,
  getSecurityLogs,
  updatePrivacySettings,
  getPrivacySettings,
  requestDataExport,
  requestAccountDeletion,
  cancelAccountDeletion,
  recordConsent,
} from '../controllers/auth.controller';

const router = Router();

// ============================================================================
// PUBLIC ROUTES (with rate limiting)
// ============================================================================

// Registration with rate limiting and brute force protection
router.post('/register', rateLimiter.register, register);

// Login with rate limiting and brute force protection
router.post('/login', rateLimiter.login, checkLoginAttempts, login);

// Token refresh
router.post('/refresh', rateLimiter.api, refreshToken);

// Password reset
router.post('/forgot-password', rateLimiter.passwordReset, forgotPassword);
router.post('/verify-reset-token', verifyResetToken);
router.post('/reset-password', rateLimiter.passwordReset, resetPassword);

// Email verification
router.post('/verify-email', verifyEmail);

// OAuth routes
router.post('/google', rateLimiter.login, googleAuth);
router.post('/apple', rateLimiter.login, appleAuth);

// Phone OTP routes
router.post('/phone/send-otp', rateLimiter.otp, phoneSendOTP);
router.post('/phone/verify-otp', rateLimiter.otp, phoneVerifyOTP);

// ============================================================================
// PROTECTED ROUTES (authentication required)
// ============================================================================

// Session management
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.get('/sessions', authenticate, getSessions);
router.delete('/sessions/:sessionId', authenticate, revokeSession);
router.post('/sessions/revoke-all', authenticate, revokeAllSessions);
router.post('/change-password', authenticate, changePassword);

// 2FA Management
router.get('/2fa/setup', authenticate, setup2FA);
router.post('/2fa/enable', authenticate, enable2FA);
router.post('/2fa/verify', authenticate, verify2FA);
router.post('/2fa/disable', authenticate, disable2FA);
router.get('/2fa/status', authenticate, get2FAStatus);
router.get('/2fa/backup-codes', authenticate, getBackupCodes);
router.post('/2fa/regenerate-backup-codes', authenticate, regenerateBackupCodes);

// Privacy & Security
router.get('/security/logs', authenticate, getSecurityLogs);
router.put('/privacy', authenticate, updatePrivacySettings);
router.get('/privacy', authenticate, getPrivacySettings);

// GDPR
router.post('/data/export', authenticate, requestDataExport);
router.post('/account/deletion', authenticate, requestAccountDeletion);
router.post('/account/cancel-deletion', authenticate, cancelAccountDeletion);
router.post('/consent', authenticate, recordConsent);

// Username availability check
router.get('/check-username', async (req: any, res: any) => {
  try {
    const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
    if (!username || username.length < 3 || username.length > 30) {
      res.status(400).json({ available: false, message: 'Invalid username' });
      return;
    }
    if (!/^[a-zA-Z0-9_.]+$/.test(username)) {
      res.status(400).json({ available: false, message: 'Invalid username' });
      return;
    }
    const existing = await prisma.user.findFirst({
      where: {
        username: {
          equals: username,
        },
      },
    });
    if (existing) {
      res.json({ available: false, message: 'Username already exists' });
    } else {
      res.json({ available: true, message: 'Username is available' });
    }
  } catch (error) {
    console.error('Username check error:', error);
    res.status(500).json({ available: false, message: 'Unable to verify username. Please try again.' });
  }
});

// CSRF token endpoint
router.get('/csrf-token', authenticate, (req: any, res: any) => {
  const { CSRFProtection } = require('../security');
  CSRFProtection.getTokenHandler(req, res);
});

export default router;