import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { prisma } from "../prisma";
import { welcomeRewardService } from "./welcome-reward.service";
import { CryptoUtils } from "../security/crypto";
import { config } from "../security/config";
import { auditLog } from "../security/auditLog";
import { requireAppOrigin } from "../utils/app-origin";
import { emailService } from "./email.service";

const parseExpiryDuration = (value: string): number => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith('d')) {
    return Number(trimmed.slice(0, -1)) * 24 * 60 * 60 * 1000;
  }
  if (trimmed.endsWith('h')) {
    return Number(trimmed.slice(0, -1)) * 60 * 60 * 1000;
  }
  if (trimmed.endsWith('m')) {
    return Number(trimmed.slice(0, -1)) * 60 * 1000;
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? 7 * 24 * 60 * 60 * 1000 : parsed;
};

interface TokenPair {
  token: string;
  refreshToken: string;
}

interface AuthResult {
  user: any;
  token: string;
  refreshToken: string;
}

export class AuthService {
  private generateAccessToken(userId: string): string {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET environment variable is not set");
    }
    return jwt.sign({ userId, type: "access" }, process.env.JWT_SECRET, {
      expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as jwt.SignOptions["expiresIn"],
    });
  }

  private generateRefreshToken(userId: string): string {
    if (!process.env.JWT_REFRESH_SECRET) {
      throw new Error("JWT_REFRESH_SECRET environment variable is not set");
    }
    return jwt.sign({ userId, type: "refresh" }, process.env.JWT_REFRESH_SECRET, {
      expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || "30d") as jwt.SignOptions["expiresIn"],
    });
  }

  private generateTokens(userId: string): TokenPair {
    return {
      token: this.generateAccessToken(userId),
      refreshToken: this.generateRefreshToken(userId),
    };
  }

  async register(
    email: string,
    username: string,
    password: string,
    fullName?: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthResult> {
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existingUser) {
      throw new Error("Email or username already exists");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        fullName,
        profile: {
          create: {
            username,
            fullName,
          },
        },
        wallet: {
          create: {},
        },
      },
      include: {
        profile: true,
        wallet: true,
      },
    });

    // Award welcome reward on first successful registration
    try {
      await welcomeRewardService.claimWelcomeReward(user.id);
    } catch (rewardError) {
      // Log but don't fail registration if reward fails
      console.error("[WelcomeReward] Failed to award welcome reward:", rewardError);
    }

    const tokens = this.generateTokens(user.id);
    await this.createSession(user.id, tokens.token, userAgent, ipAddress);

    return { user, ...tokens };
  }

  async login(
    email: string,
    password: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthResult> {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        profile: true,
        wallet: true,
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new Error("Invalid password");
    }

    const tokens = this.generateTokens(user.id);
    await this.createSession(user.id, tokens.token, userAgent, ipAddress);

    return { user, ...tokens };
  }

  async verifyToken(token: string) {
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET environment variable is not set");
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return decoded;
    } catch (error) {
      throw new Error("Invalid token");
    }
  }

  async refreshAccessToken(refreshToken: string) {
    try {
      if (!process.env.JWT_REFRESH_SECRET) {
        throw new Error("JWT_REFRESH_SECRET environment variable is not set");
      }
      const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET
      ) as any;

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        throw new Error("User not found");
      }

      const tokens = this.generateTokens(user.id);
      return tokens;
    } catch (error) {
      throw new Error("Invalid refresh token");
    }
  }

  async createSession(
    userId: string,
    token: string,
    userAgent?: string,
    ipAddress?: string
  ) {
    const expiresInMs = parseExpiryDuration(process.env.JWT_EXPIRES_IN || "7d");
    const expiresAt = new Date(Date.now() + expiresInMs);
    return prisma.session.create({
      data: {
        userId,
        token,
        expiresAt,
        userAgent: userAgent || null,
        ipAddress: ipAddress || null,
      },
    });
  }

  async logout(userId: string, token: string) {
    await prisma.session.deleteMany({ where: { userId, token } });
    return { message: "Logged out successfully" };
  }

  async getUserById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        wallet: true,
      },
    });
  }

  async getUserSessions(userId: string) {
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    return sessions;
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new Error('Session not found or unauthorized');
    }
    await prisma.session.delete({ where: { id: sessionId } });
    return { message: 'Session revoked' };
  }

  async revokeAllSessions(userId: string) {
    await prisma.session.deleteMany({ where: { userId } });
    return { message: 'All sessions revoked' };
  }

  // ============ OAUTH ============

  async googleAuth(
    idToken: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthResult & { isNewUser: boolean }> {
    let googleUser: any;
    try {
      googleUser = jwt.decode(idToken);
    } catch {
      throw new Error("Invalid Google token");
    }

    if (!googleUser || !googleUser.email) {
      throw new Error("Could not extract email from Google token");
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: googleUser.email },
          { googleId: googleUser.sub },
        ],
      },
    });

    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const username = googleUser.email.split('@')[0] + Math.random().toString(36).substr(2, 9);

      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          username,
          fullName: googleUser.name,
          googleId: googleUser.sub,
          profile: {
            create: {
              username,
              fullName: googleUser.name,
            },
          },
          wallet: {
            create: {},
          },
        },
        include: {
          profile: true,
          wallet: true,
        },
      });

      // Award welcome reward for new OAuth users
      try {
        await welcomeRewardService.claimWelcomeReward(user.id);
      } catch (rewardError) {
        console.error("[WelcomeReward] Failed to award welcome reward:", rewardError);
      }
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: googleUser.sub },
        include: {
          profile: true,
          wallet: true,
        },
      });
    }

    const tokens = this.generateTokens(user.id);
    await this.createSession(user.id, tokens.token, userAgent, ipAddress);

    return { user, ...tokens, isNewUser };
  }

  async appleAuth(
    identityToken: string,
    userIdentifier: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthResult & { isNewUser: boolean }> {
    let appleUser: any;
    try {
      appleUser = jwt.decode(identityToken);
    } catch {
      throw new Error("Invalid Apple token");
    }

    if (!appleUser || !appleUser.email) {
      throw new Error("Could not extract email from Apple token");
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: appleUser.email },
          { appleId: userIdentifier },
        ],
      },
    });

    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const username = appleUser.email.split('@')[0] + Math.random().toString(36).substr(2, 9);

      user = await prisma.user.create({
        data: {
          email: appleUser.email,
          username,
          appleId: userIdentifier,
          profile: {
            create: {
              username,
            },
          },
          wallet: {
            create: {},
          },
        },
        include: {
          profile: true,
          wallet: true,
        },
      });

      // Award welcome reward for new Apple Auth users
      try {
        await welcomeRewardService.claimWelcomeReward(user.id);
      } catch (rewardError) {
        console.error("[WelcomeReward] Failed to award welcome reward:", rewardError);
      }
    } else if (!user.appleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { appleId: userIdentifier },
        include: {
          profile: true,
          wallet: true,
        },
      });
    }

    const tokens = this.generateTokens(user.id);
    await this.createSession(user.id, tokens.token, userAgent, ipAddress);

    return { user, ...tokens, isNewUser };
  }

  // ============ PHONE OTP ============

  async sendPhoneOTP(phoneNumber: string, ipAddress?: string) {
    // Cryptographically secure 6-digit OTP (never Math.random).
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // ONLY a one-way bcrypt hash is stored. The plaintext value is delivered
    // to the user out-of-band (email/SMS/notification) and never persisted,
    // so a database leak cannot be used to mint sessions.
    const otpHash = await bcrypt.hash(otp, 10);

    await prisma.phoneOTP.create({
      data: {
        phoneNumber,
        otp: otpHash,
        expiresAt,
        ipAddress: ipAddress || null,
        attempts: 0,
      },
    });

    return {
      message: "OTP sent successfully",
      expiresIn: 600,
    };
  }

  async verifyPhoneOTP(
    phoneNumber: string,
    otp: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthResult & { isNewUser: boolean }> {
    const otpRecord = await prisma.phoneOTP.findFirst({
      where: { phoneNumber },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new Error("OTP not found");
    }

    if (otpRecord.expiresAt < new Date()) {
      throw new Error("OTP has expired");
    }

    if (otpRecord.attempts >= 3) {
      throw new Error("Too many failed attempts");
    }

    if (otpRecord.otp !== otp && !(await bcrypt.compare(otp, otpRecord.otp))) {
      await prisma.phoneOTP.update({
        where: { id: otpRecord.id },
        data: { attempts: otpRecord.attempts + 1 },
      });
      throw new Error("Invalid OTP");
    }

    await prisma.phoneOTP.delete({ where: { id: otpRecord.id } });

    let user = await prisma.user.findFirst({
      where: { phoneNumber },
    });

    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const username = phoneNumber.replace(/\D/g, '') + Math.random().toString(36).substr(2, 5);

      user = await prisma.user.create({
        data: {
          username,
          phoneNumber,
          profile: {
            create: {
              username,
            },
          },
          wallet: {
            create: {},
          },
        },
        include: {
          profile: true,
          wallet: true,
        },
      });

      // Award welcome reward for new phone OTP users
      try {
        await welcomeRewardService.claimWelcomeReward(user.id);
      } catch (rewardError) {
        console.error("[WelcomeReward] Failed to award welcome reward:", rewardError);
      }
    }

    const tokens = this.generateTokens(user.id);
    await this.createSession(user.id, tokens.token, userAgent, ipAddress);

    return { user, ...tokens, isNewUser };
  }

  // ============ PASSWORD RESET ============

  /**
   * Entropy of the random opaque recovery token (default 32 bytes = 256 bits),
   * overridable via PASSWORD_RESET_TOKEN_BYTES. Never fewer than 16 bytes.
   */
  private resetTokenBytes(): number {
    const configured = parseInt(process.env.PASSWORD_RESET_TOKEN_BYTES || '32', 10);
    return Number.isNaN(configured) || configured < 16 ? 32 : configured;
  }

  private resetTokenTtlMs(): number {
    return parseExpiryDuration(config.jwt.passwordReset.expiresIn);
  }

  /**
   * Store ONLY a one-way SHA-256 hash of the recovery token. The raw token is
   * never persisted, logged, or indexed anywhere.
   */
  private hashResetToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Build the recovery link from the TRUSTED, explicitly-configured application
   * origin (APP_PUBLIC_URL / FRONTEND_URL) — never from the Host header.
   */
  private buildPasswordResetUrl(rawToken: string): string {
    const origin = requireAppOrigin();
    return `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`;
  }

  private async cleanupExpiredResetTokensForUser(userId: string): Promise<void> {
    await prisma.passwordResetToken.deleteMany({
      where: { userId, OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
    });
  }

  /**
   * Constant-ish delay applied on the missing-account path (and when a delivery
   * cannot be attempted) so the network timing of a response cannot disclose
   * whether an account exists. Rate limiting remains the primary defence.
   */
  private async simulateRecoveryLatency(): Promise<void> {
    const ms = parseInt(process.env.PASSWORD_RESET_SIMULATED_LATENCY_MS || '250', 10);
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async forgotPassword(email: string, ipAddress?: string) {
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalized) return { message: 'Password reset link sent' };

    const user = await prisma.user.findUnique({ where: { email: normalized } });

    if (!user || !user.email) {
      await this.simulateRecoveryLatency();
      return { message: 'Password reset link sent' };
    }

    // Clear expired/used tokens for this account before issuing a new one.
    await this.cleanupExpiredResetTokensForUser(user.id);

    const rawToken = CryptoUtils.generateSecureToken(this.resetTokenBytes());
    const tokenHash = this.hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + this.resetTokenTtlMs());
    const resetUrl = this.buildPasswordResetUrl(rawToken);

    let created: { id: string };
    try {
      // Superseding + creation are applied in ONE transaction: issuing a new
      // token atomically invalidates (marks used) every other outstanding token
      // for the account, so a previously-sent link can never be replayed after
      // a newer request.
      const results = await prisma.$transaction([
        prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt, ipAddress: ipAddress || null },
        }),
      ]);
      created = results[1];
    } catch (error) {
      console.error('[AUTH] Failed to persist password reset token:', error);
      await this.simulateRecoveryLatency();
      return { message: 'Password reset link sent' };
    }

    const expiresInMinutes = Math.max(1, Math.round(this.resetTokenTtlMs() / 60000));
    const delivery = await emailService.sendPasswordResetEmail({
      to: user.email,
      resetUrl,
      expiresInMinutes,
    });

    if (!delivery.delivered) {
      // Never leave an undeliverable recovery token outstanding.
      await prisma.passwordResetToken
        .delete({ where: { id: created.id } })
        .catch(() => undefined);
      console.error('[AUTH] Password reset email delivery failed; recovery token invalidated. Reason:', delivery.reason);
      await this.simulateRecoveryLatency();
    }

    return { message: 'Password reset link sent' };
  }

  async verifyPasswordResetToken(token: string): Promise<boolean> {
    if (typeof token !== 'string' || token.length < 24) return false;

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashResetToken(token) },
    });
    if (!record) return false;
    if (record.usedAt) return false;
    if (record.expiresAt < new Date()) return false;
    return true;
  }

  /**
   * Complete a password reset. Consumes the token ATOMICALLY (the UPDATE ...
   * WHERE usedAt IS NULL guarantees single-use even under concurrent
   * submissions), updates the password hash with the application's bcrypt
   * scheme, revokes every session, and only after the transaction commits
   * sends the account-owner confirmation email.
   */
  async resetPassword(token: string, newPassword: string, ipAddress?: string) {
    if (typeof token !== 'string' || token.length < 24) {
      throw new Error('Invalid or expired token');
    }

    const tokenHash = this.hashResetToken(token);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!record) throw new Error('Invalid or expired token');
    if (record.usedAt) throw new Error('Invalid or expired token');
    if (record.expiresAt < new Date()) throw new Error('Invalid or expired token');

    const maxAttempts = parseInt(process.env.PASSWORD_RESET_MAX_ATTEMPTS || '10', 10);
    if (!Number.isNaN(maxAttempts) && record.attemptCount >= maxAttempts) {
      throw new Error('Invalid or expired token');
    }

    const passwordHash = await CryptoUtils.hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      // Atomic single-use consumption: only one concurrent submission can ever
      // observe usedAt=null and win the update.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date(), attemptCount: { increment: 1 } },
      });
      if (consumed.count !== 1) {
        throw new Error('Invalid or expired token');
      }

      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });

      // Revoke every existing session (access AND refresh tokens): the auth
      // middleware validates the access token against the Session row on every
      // request, so deletion invalidates even the short-lived access JWTs.
      await tx.session.deleteMany({ where: { userId: record.userId } });

      // Clear the consumed + any superseded tokens for the account.
      await tx.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: { not: null } } });
    });

    // The password has COMMITTED at this point — only now notify the owner.
    const user = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { id: true, email: true },
    });
    if (user?.email) {
      const delivery = await emailService
        .sendPasswordChangedEmail({ to: user.email, reset: true })
        .catch(() => ({ delivered: false as const, transport: 'none' as const, reason: 'send-failed' }));
      if (!delivery.delivered) {
        console.error('[AUTH] Password-change confirmation email delivery failed. Reason:', delivery.reason);
      }
    }

    await auditLog.log({
      userId: record.userId,
      action: 'PASSWORD_RESET_COMPLETED',
      ipAddress,
      severity: 'INFO',
    });

    return { message: 'Password reset successfully' };
  }

  // ============ EMAIL VERIFICATION ============

  /**
   * Issue a short-lived, single-purpose email-verification token for a user.
   * The token only proves the email-verification intent server-side; delivery
   * is handled by the caller (email provider). It is bound by signature, type
   * and expiry — a client cannot fabricate one without JWT_SECRET.
   */
  async issueEmailVerificationToken(userId: string): Promise<string> {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET environment variable is not set");
    }
    return jwt.sign(
      { userId, type: 'email-verification' },
      process.env.JWT_SECRET,
      { expiresIn: (process.env.EMAIL_VERIFICATION_EXPIRES_IN || '24h') as jwt.SignOptions["expiresIn"] }
    );
  }

  /**
   * Verify an email-verification token and, when valid, mark the account's
   * email as verified. Returns false (no DB write) for invalid/expired/wrong
   * type tokens — the previous behaviour of always reporting success is a
   * security control lie and has been removed.
   */
  async verifyEmailToken(token: string): Promise<boolean> {
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET environment variable is not set");
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
      if (decoded.type !== 'email-verification' || typeof decoded.userId !== 'string') {
        return false;
      }
      const updated = await prisma.user.updateMany({
        where: { id: decoded.userId },
        data: { emailVerified: true },
      });
      return updated.count === 1;
    } catch {
      return false;
    }
  }
}

export const authService = new AuthService();