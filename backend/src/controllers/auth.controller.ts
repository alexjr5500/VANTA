import { Request, Response } from 'express';
import { AuthenticatedRequest, CryptoUtils, SecurityValidator, sessionManager, twoFactorAuth, auditLog, botProtection, GDPRCompliance, config } from '../security';
import { prisma } from '../prisma';

// ============================================================================
// REGISTRATION
// ============================================================================

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, username, fullName } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedUsername = typeof username === 'string' ? username.trim().replace(/^@/, '').toLowerCase() : '';

    // Validate input
    if (!normalizedEmail || !password || !normalizedUsername) {
      res.status(400).json({ error: 'Email, username, and password are required' });
      return;
    }

    if (!SecurityValidator.isValidEmail(normalizedEmail)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    if (!SecurityValidator.isValidUsername(normalizedUsername)) {
      res.status(400).json({ error: 'Username must be 3-30 characters (letters, numbers, underscores, hyphens)' });
      return;
    }

    const passValidation = SecurityValidator.isStrongPassword(password);
    if (!passValidation.valid) {
      res.status(400).json({ error: passValidation.errors.join('. ') });
      return;
    }

    // Check for existing user
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          // SQLite does not support Prisma's `mode` filter. Registration
          // stores both identifiers normalized, so exact lookup is safe.
          { email: normalizedEmail },
          { username: normalizedUsername },
        ],
      },
    });

    if (existingUser) {
      res.status(409).json({ error: 'Email or username already exists' });
      return;
    }

    // Hash password using the application's current password algorithm.
    const passwordHash = await CryptoUtils.hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        passwordHash,
        fullName: SecurityValidator.sanitizeText(fullName) || null,
        profile: { create: { username: normalizedUsername, fullName: SecurityValidator.sanitizeText(fullName) || null } },
        wallet: { create: {} },
        userSettings: { create: {} },
        notificationPrefs: { create: {} },
      },
    });

    // Create session
    const userAgent = req.headers['user-agent']?.toString();
    const ipAddress = req.ip || req.socket.remoteAddress;
    const deviceFingerprint = (req as any).deviceFingerprint;
    const tokenPair = sessionManager.generateTokenPair(user.id, user.role, '');
    const session = await sessionManager.createSession(
      user.id, tokenPair.accessToken, tokenPair.refreshToken,
      userAgent, ipAddress, deviceFingerprint
    );
    // Update session with real ID in token
    const finalTokenPair = sessionManager.generateTokenPair(user.id, user.role, session.id);
    await prisma.session.update({ where: { id: session.id }, data: { token: finalTokenPair.accessToken, refreshToken: finalTokenPair.refreshToken } });

    // Log
    await auditLog.log({ userId: user.id, action: 'REGISTER_SUCCESS', ipAddress, userAgent });
    await botProtection.recordLegitimateActivity(ipAddress || '');

    res.status(201).json({
      message: 'User registered successfully',
      token: finalTokenPair.accessToken,
      refreshToken: finalTokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      user: { id: user.id, email: user.email, username: user.username, fullName: user.fullName },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// LOGIN
// ============================================================================

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { password, rememberMe } = req.body;
    const rawIdentifier = typeof req.body?.identifier === 'string'
      ? req.body.identifier
      : req.body?.email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    const normalizedIdentifier = identifier.toLowerCase();

    if (!identifier || typeof password !== 'string') {
      res.status(400).json({ error: 'Email/Username and password are required' });
      return;
    }

    // Support login by email or username
    const isEmail = identifier.includes('@');
    if (process.env.NODE_ENV === 'development') {
      console.info('[Auth] Login attempt', { identifierType: isEmail ? 'email' : 'username', ipAddress: req.ip });
    }
    const user = await prisma.user.findFirst({
      where: isEmail
        ? { email: normalizedIdentifier }
        : { username: normalizedIdentifier.replace(/^@/, '') },
      include: { profile: true },
    });

    if (!user || !user.passwordHash) {
      if (process.env.NODE_ENV === 'development') console.info('[Auth] Login rejected: user lookup failed');
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (user.status !== 'ACTIVE') {
      const accountErrors: Record<string, { status: number; error: string }> = {
        SUSPENDED: { status: 403, error: 'Account suspended' },
        BANNED: { status: 403, error: 'Account banned' },
        DEACTIVATED: { status: 403, error: 'Account deactivated' },
        LOCKED: { status: 423, error: 'Account locked' },
      };
      const accountError = accountErrors[user.status] || { status: 403, error: 'Account restricted' };
      await auditLog.log({ userId: user.id, action: 'LOGIN_BLOCKED_STATUS', ipAddress: req.ip, userAgent: req.headers['user-agent'], metadata: { status: user.status }, severity: 'WARNING' });
      res.status(accountError.status).json({ error: accountError.error });
      return;
    }

    if (config.auth.requireEmailVerification && !user.emailVerified) {
      res.status(403).json({ error: 'Email not verified' });
      return;
    }

    // Verify both current bcrypt hashes and legacy Argon2id hashes.
    const isPasswordValid = await CryptoUtils.verifyPassword(user.passwordHash, password);
    if (!isPasswordValid) {
      await botProtection.recordLoginAttempt(user.id, false, req);
      await auditLog.log({ userId: user.id, action: 'LOGIN_FAILED', ipAddress: req.ip, userAgent: req.headers['user-agent'], severity: 'WARNING' });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    if (process.env.NODE_ENV === 'development') console.info('[Auth] Password verified', { userId: user.id });

    // Check lockout only after password verification so the response does not
    // disclose whether a supplied password is valid.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      res.status(429).json({ error: 'Account temporarily locked. Please try again later.' });
      return;
    }

    // Check for suspicious login
    // Suspicious-login detection is advisory only. It must not turn a valid
    // password into an authorization failure; step-up verification is handled
    // explicitly by the 2FA flow below.
    const isSuspicious = await botProtection.detectSuspiciousLogin(user.id, req.ip || '');
    
    // Check 2FA requirement
    if (user.twoFactorEnabled) {
      // Check if device is trusted
      const deviceFingerprint = (req as any).deviceFingerprint;
      if (deviceFingerprint) {
        const isTrusted = await twoFactorAuth.isDeviceTrusted(user.id, deviceFingerprint);
        if (isTrusted) {
          // Skip 2FA for trusted devices - proceed with login
        } else {
          // Require 2FA token
          res.status(200).json({
            requiresTwoFactor: true,
            userId: user.id,
            message: 'Two-factor authentication required',
          });
          return;
        }
      } else {
        res.status(200).json({
          requiresTwoFactor: true,
          userId: user.id,
          message: 'Two-factor authentication required',
        });
        return;
      }
    }

    // Create session
    const userAgent = req.headers['user-agent']?.toString();
    const ipAddress = req.ip || req.socket.remoteAddress;
    const deviceFingerprint = (req as any).deviceFingerprint;

    let tokenPair;
    if (rememberMe) {
      tokenPair = await sessionManager.createRememberMeSession(user.id, user.role, userAgent, ipAddress, deviceFingerprint);
    } else {
      tokenPair = sessionManager.generateTokenPair(user.id, user.role, '');
      const session = await sessionManager.createSession(user.id, tokenPair.accessToken, tokenPair.refreshToken, userAgent, ipAddress, deviceFingerprint);
      const finalPair = sessionManager.generateTokenPair(user.id, user.role, session.id);
      await prisma.session.update({ where: { id: session.id }, data: { token: finalPair.accessToken, refreshToken: finalPair.refreshToken } });
      tokenPair = finalPair;
    }
    if (process.env.NODE_ENV === 'development') console.info('[Auth] Session and token pair created', { userId: user.id });

    // Record successful login
    await botProtection.recordLoginAttempt(user.id, true, req);
    await auditLog.log({ userId: user.id, action: 'LOGIN_SUCCESS', ipAddress, userAgent, severity: isSuspicious ? 'WARNING' : 'INFO' });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    res.status(200).json({
      message: 'Logged in successfully',
      token: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      suspicious: isSuspicious,
      user: { id: user.id, email: user.email, username: user.username, fullName: user.fullName, role: user.role },
    });
  } catch (error) {
    console.error('[Auth] Login processing failed', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Unable to complete login. Please try again.' });
  }
};

// ============================================================================
// LOGOUT
// ============================================================================

export const logout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (req.user && req.token) {
      await sessionManager.logout(req.user.userId, req.token);
    }
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(200).json({ message: 'Logged out successfully' });
  }
};

// ============================================================================
// TOKEN REFRESH
// ============================================================================

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      res.status(400).json({ error: 'Refresh token is required' });
      return;
    }

    const result = await sessionManager.refreshTokens(token);
    res.status(200).json({
      message: 'Token refreshed successfully',
      token: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

// ============================================================================
// USER INFO
// ============================================================================

export const getMe = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        profile: true,
        wallet: { select: { coinBalance: true, earningsBalance: true } },
        userSettings: true,
        notificationPrefs: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar || user.profile?.avatarUrl,
        role: user.role,
        verified: user.verified,
        emailVerified: user.emailVerified,
        premium: user.premium,
        twoFactorEnabled: user.twoFactorEnabled,
        coins: user.coins || user.wallet?.coinBalance || 0,
        earnings: user.earnings || user.wallet?.earningsBalance || 0,
        createdAt: user.createdAt,
        settings: user.userSettings,
        notifications: user.notificationPrefs,
      },
    });
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch user' });
  }
};

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

export const getSessions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const sessions = await sessionManager.getUserSessions(req.user.userId);
    res.status(200).json({ sessions });
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch sessions' });
  }
};

export const revokeSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    await sessionManager.revokeSession(req.user.userId, req.params.sessionId);
    res.status(200).json({ message: 'Session revoked' });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to revoke session' });
  }
};

export const revokeAllSessions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    await sessionManager.logoutAll(req.user.userId);
    res.status(200).json({ message: 'All sessions revoked' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to revoke sessions' });
  }
};

// ============================================================================
// CHANGE PASSWORD
// ============================================================================

export const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

    const passValidation = SecurityValidator.isStrongPassword(newPassword);
    if (!passValidation.valid) {
      res.status(400).json({ error: passValidation.errors.join('. ') });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user || !user.passwordHash) {
      res.status(400).json({ error: 'Invalid password' });
      return;
    }

    const isValid = await CryptoUtils.verifyPassword(user.passwordHash, currentPassword);
    if (!isValid) {
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }

    const newHash = await CryptoUtils.hashPassword(newPassword);
    await prisma.user.update({ where: { id: req.user.userId }, data: { passwordHash: newHash } });
    await auditLog.log({ userId: req.user.userId, action: 'PASSWORD_CHANGED', ipAddress: req.ip, severity: 'INFO' });

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to change password' });
  }
};

// ============================================================================
// PASSWORD RESET
// ============================================================================

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json({ error: 'Email is required' }); return; }

    await auditLog.log({ action: 'PASSWORD_RESET_REQUESTED', ipAddress: req.ip, metadata: { email: SecurityValidator.sanitizeText(email) } });

    // In production, send email with reset link
    res.status(200).json({ message: 'If an account exists with this email, a password reset link will be sent' });
  } catch (error) {
    res.status(200).json({ message: 'If an account exists with this email, a password reset link will be sent' });
  }
};

export const verifyResetToken = async (req: Request, res: Response): Promise<void> => {
  // In production, verify the JWT reset token
  res.status(200).json({ valid: true, message: 'Token is valid' });
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) { res.status(400).json({ error: 'Token and new password are required' }); return; }

    const passValidation = SecurityValidator.isStrongPassword(newPassword);
    if (!passValidation.valid) { res.status(400).json({ error: passValidation.errors.join('. ') }); return; }

    // In production, verify reset token JWT and update password
    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Password reset failed' });
  }
};

// ============================================================================
// EMAIL VERIFICATION
// ============================================================================

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body;
    if (!token) { res.status(400).json({ error: 'Verification token is required' }); return; }
    // In production, verify JWT token and update user
    res.status(200).json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Email verification failed' });
  }
};

// ============================================================================
// OAUTH
// ============================================================================

export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    const { idToken } = req.body;
    if (!idToken) { res.status(400).json({ error: 'Google ID token is required' }); return; }
    // In production, verify with Google's API
    res.status(200).json({ message: 'Google authentication not fully implemented', token: '', refreshToken: '', expiresIn: 900, user: {} });
  } catch (error) {
    res.status(400).json({ error: 'Google authentication failed' });
  }
};

export const appleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    const { identityToken, userIdentifier } = req.body;
    if (!identityToken || !userIdentifier) { res.status(400).json({ error: 'Identity token and user identifier are required' }); return; }
    res.status(200).json({ message: 'Apple authentication not fully implemented', token: '', refreshToken: '', expiresIn: 900, user: {} });
  } catch (error) {
    res.status(400).json({ error: 'Apple authentication failed' });
  }
};

// ============================================================================
// PHONE OTP
// ============================================================================

export const phoneSendOTP = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ message: 'OTP sent successfully', expiresIn: 600 });
};

export const phoneVerifyOTP = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ message: 'Phone verification not fully implemented', token: '', refreshToken: '', expiresIn: 900, user: {} });
};

// ============================================================================
// 2FA
// ============================================================================

export const setup2FA = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { email: true } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const result = await twoFactorAuth.setup(req.user.userId, user.email!);
    res.status(200).json({ secret: result.secret, qrCodeUrl: result.qrCodeUrl, backupCodes: result.backupCodes });
  } catch (error) {
    res.status(400).json({ error: 'Failed to setup 2FA' });
  }
};

export const enable2FA = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { token } = req.body;
    if (!token) { res.status(400).json({ error: 'Verification token is required' }); return; }
    const result = await twoFactorAuth.enable(req.user.userId, token);
    if (result.success) {
      res.status(200).json({ message: '2FA enabled successfully' });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(400).json({ error: 'Failed to enable 2FA' });
  }
};

export const verify2FA = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { token } = req.body;
    const result = await twoFactorAuth.verifyLogin(req.user.userId, token);
    if (result.valid) {
      res.status(200).json({ verified: true, isBackupCode: result.isBackupCode, remainingBackupCodes: result.remainingBackupCodes });
    } else {
      res.status(401).json({ error: 'Invalid verification code' });
    }
  } catch (error) {
    res.status(400).json({ error: 'Verification failed' });
  }
};

export const disable2FA = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { password } = req.body;
    if (!password) { res.status(400).json({ error: 'Password is required to disable 2FA' }); return; }
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { passwordHash: true } });
    if (!user || !user.passwordHash) { res.status(400).json({ error: 'Invalid password' }); return; }
    const result = await twoFactorAuth.disable(req.user.userId, password, user.passwordHash);
    if (result.success) {
      res.status(200).json({ message: '2FA disabled successfully' });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(400).json({ error: 'Failed to disable 2FA' });
  }
};

export const get2FAStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { twoFactorEnabled: true } });
    res.status(200).json({ enabled: user?.twoFactorEnabled || false });
  } catch (error) {
    res.status(400).json({ error: 'Failed to get 2FA status' });
  }
};

export const getBackupCodes = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const count = await twoFactorAuth.getRemainingBackupCodes(req.user.userId);
    res.status(200).json({ remainingCodes: count });
  } catch (error) {
    res.status(400).json({ error: 'Failed to get backup codes' });
  }
};

export const regenerateBackupCodes = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const codes = await twoFactorAuth.regenerateBackupCodes(req.user.userId);
    res.status(200).json({ backupCodes: codes });
  } catch (error) {
    res.status(400).json({ error: 'Failed to regenerate backup codes' });
  }
};

// ============================================================================
// SECURITY LOGS
// ============================================================================

export const getSecurityLogs = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const logs = await auditLog.query({ userId: req.user.userId, limit: 50 });
    res.status(200).json({ logs });
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch security logs' });
  }
};

// ============================================================================
// PRIVACY SETTINGS
// ============================================================================

export const updatePrivacySettings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { privacyProfile, privacyMessages, privacyCalls, privacyStories, privacyLiveStream, privacyTagging, privacyInvites } = req.body;
    
    await prisma.userSettings.update({
      where: { userId: req.user.userId },
      data: {
        ...(privacyProfile && { privacyProfile }),
        ...(privacyMessages && { privacyMessages }),
        ...(privacyCalls && { privacyCalls }),
        ...(privacyStories && { privacyStories }),
        ...(privacyLiveStream && { privacyLiveStream }),
        ...(privacyTagging && { privacyTagging }),
        ...(privacyInvites && { privacyInvites }),
      },
    });

    res.status(200).json({ message: 'Privacy settings updated' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to update privacy settings' });
  }
};

export const getPrivacySettings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const settings = await prisma.userSettings.findUnique({ where: { userId: req.user.userId } });
    res.status(200).json({ settings });
  } catch (error) {
    res.status(400).json({ error: 'Failed to fetch privacy settings' });
  }
};

// ============================================================================
// GDPR
// ============================================================================

export const requestDataExport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const gdpr = new GDPRCompliance();
    await gdpr.requestDataExport(req.user.userId);
    res.status(200).json({ message: 'Data export requested. You will be notified when ready.' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to request data export' });
  }
};

export const requestAccountDeletion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { reason } = req.body;
    const gdpr = new GDPRCompliance();
    await gdpr.requestAccountDeletion(req.user.userId, reason);
    res.status(200).json({ message: 'Account deletion requested. Your account will be deleted after the grace period.' });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to request deletion' });
  }
};

export const cancelAccountDeletion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const gdpr = new GDPRCompliance();
    await gdpr.cancelDeletion(req.user.userId);
    res.status(200).json({ message: 'Account deletion cancelled' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to cancel deletion' });
  }
};

export const recordConsent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { type, granted } = req.body;
    if (!type || granted === undefined) { res.status(400).json({ error: 'Type and granted are required' }); return; }
    const gdpr = new GDPRCompliance();
    await gdpr.recordConsent(req.user.userId, type, granted, req.ip);
    res.status(200).json({ message: 'Consent recorded' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to record consent' });
  }
};