import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { welcomeRewardService } from "./welcome-reward.service";

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
    return jwt.sign({ userId }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });
  }

  private generateRefreshToken(userId: string): string {
    if (!process.env.JWT_REFRESH_SECRET) {
      throw new Error("JWT_REFRESH_SECRET environment variable is not set");
    }
    return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
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
    const otp = Math.random().toString().slice(2, 8);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.phoneOTP.create({
      data: {
        phoneNumber,
        otp,
        expiresAt,
        ipAddress: ipAddress || null,
        attempts: 0,
      },
    });

    console.log(`[DEV] OTP for ${phoneNumber}: ${otp}`);

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

    if (otpRecord.otp !== otp) {
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

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { message: "Password reset link sent" };
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET environment variable is not set");
    }
    const resetToken = jwt.sign(
      { userId: user.id, type: 'password-reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    console.log(`[DEV] Password reset token for ${email}: ${resetToken}`);

    return { message: "Password reset link sent" };
  }

  async verifyPasswordResetToken(token: string): Promise<boolean> {
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET environment variable is not set");
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
      return decoded.type === 'password-reset';
    } catch {
      return false;
    }
  }

  async resetPassword(token: string, newPassword: string) {
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET environment variable is not set");
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;

      if (decoded.type !== 'password-reset') {
        throw new Error("Invalid token type");
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(newPassword, salt);

      const user = await prisma.user.update({
        where: { id: decoded.userId },
        data: { passwordHash },
      });

      await prisma.session.deleteMany({ where: { userId: user.id } });

      return { message: "Password reset successfully" };
    } catch (error) {
      throw new Error("Invalid or expired token");
    }
  }
}

export const authService = new AuthService();