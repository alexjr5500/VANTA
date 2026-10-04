import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { moderationService, walletService, userService, adminService, adService, coinPaymentService, verificationService, liveService } from '../services';
import { AuthenticatedRequest, auditLog } from '../security';
import { BADGE_USER_SELECT, isBadgeRowActive } from '../services/public-verification';
import { followerRewardService, FollowerRewardError } from '../services/follower-reward.service';

// ============================================================================
// DASHBOARD
// ============================================================================

export const getDashboardStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [stats, userGrowth, recentUsers, recentReports] = await Promise.all([
      adminService.getDashboardStats(),
      adminService.getUserGrowth(),
      adminService.getRecentUsers(6),
      adminService.getRecentReports(6),
    ]);
    res.status(200).json({ ...stats, userGrowth, recentUsers, recentReports });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// USER MANAGEMENT
// ============================================================================

export const getUsers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        verified: true,
        premium: true,
        status: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
      },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(users);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getUserManagement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 25, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const search = req.query.search as string;
    const status = req.query.status as string;
    const role = req.query.role as string;
    const verified = req.query.verified as string;

    const where: any = {};
    if (search) {
      where.OR = [
        { username: { contains: search } },
        { email: { contains: search } },
        { fullName: { contains: search } },
      ];
    }
    if (status && status !== 'ALL') where.status = status;
    if (role && role !== 'ALL') where.role = role;
    if (verified === 'true') where.verified = true;
    if (verified === 'false') where.verified = false;

    const skip = offset > 0 ? offset : (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          fullName: true,
          avatar: true,
          role: true,
          status: true,
          verified: true,
          premium: true,
          coins: true,
          earnings: true,
          lastLoginAt: true,
          createdAt: true,
        },
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.status(200).json({
      users: users.map((u) => ({
        ...u,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const updateUserRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, role } = req.body;

    if (!userId || !role) {
      res.status(400).json({ error: 'userId and role are required' });
      return;
    }

    const validRoles = ['USER', 'CREATOR', 'MODERATOR', 'ADMIN', 'CEO', 'SUPER_ADMIN'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      return;
    }

    // Privilege escalation guard: only a SUPER_ADMIN may grant the highest
    // roles. Mid-level admins can manage USER/CREATOR/MODERATOR roles only —
    // they can never mint another admin or executive.
    const actorRole = String(req.user?.role || 'USER');
    const actorIsSuper = actorRole === 'SUPER_ADMIN';
    if ((role === 'SUPER_ADMIN' || role === 'CEO') && !actorIsSuper) {
      res.status(403).json({ error: 'Only a SUPER_ADMIN can assign executive/SUPER_ADMIN roles' });
      return;
    }
    if (role === 'ADMIN' && !(actorIsSuper || actorRole === 'CEO')) {
      res.status(403).json({ error: 'Only a SUPER_ADMIN or CEO can assign the ADMIN role' });
      return;
    }

    // Prevent self-demotion from ADMIN
    if (userId === req.user?.userId && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Cannot demote your own admin role' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
      },
    });

    await auditLog.log({
      userId: req.user?.userId,
      action: 'ROLE_CHANGED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'User', resourceId: userId, targetId: userId, newValue: { role } },
      severity: 'CRITICAL',
    });

    res.status(200).json({ message: 'User role updated', user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const deleteUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    // Prevent self-deletion
    if (userId === req.user?.userId) {
      res.status(403).json({ error: 'Cannot delete your own account' });
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'DEACTIVATED' },
    });

    res.status(200).json({ message: 'User deactivated' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// CREATOR MANAGEMENT
// ============================================================================

export const getCreators = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const page = parseInt(req.query.page as string);
    const skip = page && page > 1 ? (page - 1) * limit : offset;
    const search = (req.query.search as string)?.trim() ?? '';
    const category = (req.query.category as string)?.trim() ?? '';

    const where: any = {
      OR: [
        { role: 'CREATOR' },
        { premium: true },
      ],
    };
    if (search) {
      where.AND = [
        {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { fullName: { contains: search, mode: 'insensitive' } },
            { profile: { is: { fullName: { contains: search, mode: 'insensitive' } } } },
          ],
        },
      ];
    }
    if (category) {
      where.AND = [
        ...(where.AND || []),
        { profile: { is: { creatorCategory: category } } },
      ];
    }

    const [creators, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          fullName: true,
          role: true,
          verified: true,
          premium: true,
          earnings: true,
          bio: true,
          avatar: true,
          status: true,
          createdAt: true,
          profile: { select: { avatarUrl: true, bio: true, fullName: true, creatorCategory: true } },
          verificationBadge: BADGE_USER_SELECT.verificationBadge,
          creatorMembership: { select: { status: true, endDate: true } },
          liveStreams: { orderBy: { startedAt: 'desc' }, take: 1, select: { startedAt: true } },
          _count: {
            select: {
              followers: true,
              videos: true,
              liveStreams: true,
              creatorSubscriptions: { where: { status: 'ACTIVE' } },
            },
          },
        },
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    const ids = creators.map((c) => c.id);

    // Batch-aggregate derived metrics — user.findMany cannot SUM relations.
    const [videoViews, liveStreamViews, monthlyGifts] = await Promise.all([
      prisma.video.groupBy({
        by: ['creatorId'],
        where: { creatorId: { in: ids }, publishStatus: 'PUBLISHED' },
        _sum: { views: true },
      }),
      prisma.liveStream.groupBy({
        by: ['hostId'],
        where: { hostId: { in: ids } },
        _sum: { totalViewers: true },
      }),
      prisma.giftTransaction.groupBy({
        by: ['receiverId'],
        where: {
          receiverId: { in: ids },
          status: 'COMPLETED',
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        _sum: { amount: true },
      }),
    ]);

    const videoViewsBy = new Map(videoViews.map((v) => [v.creatorId, v._sum.views || 0] as const));
    const liveViewsBy = new Map(liveStreamViews.map((l) => [l.hostId, l._sum.totalViewers || 0] as const));
    const monthlyGiftsBy = new Map(monthlyGifts.map((g) => [g.receiverId, g._sum.amount || 0] as const));

    const now = Date.now();
    const records = creators.map((user, index) => {
      const badgeActive = isBadgeRowActive(user.verificationBadge);
      const serverVerified = Boolean(user.verified);
      const membershipActive =
        user.creatorMembership?.status === 'ACTIVE' &&
        (!user.creatorMembership.endDate || user.creatorMembership.endDate.getTime() > now);

      return {
        id: user.id,
        userId: user.id,
        username: user.username,
        email: user.email,
        status: user.status,
        avatar: user.profile?.avatarUrl || user.avatar || undefined,
        displayName: user.fullName?.trim() || user.profile?.fullName?.trim() || user.username,
        bio: user.profile?.bio || user.bio || undefined,
        followers: user._count?.followers || 0,
        subscribers: user._count?.creatorSubscriptions || 0,
        totalViews: (videoViewsBy.get(user.id) || 0) + (liveViewsBy.get(user.id) || 0),
        totalEarnings: Number(user.earnings || 0),
        monthlyEarnings: monthlyGiftsBy.get(user.id) || 0,
        isVerified: serverVerified || badgeActive,
        // Mirror the app-wide badge serialization (public-verification.ts):
        // an ACTIVE paid badge wins; otherwise the legacy server-verified
        // identity keeps the Gold badge. `isVerified` gates badge rendering,
        // so a SUSPENDED/EXPIRED badge can never display to admins.
        verificationType: badgeActive
          ? user.verificationBadge?.badgeType === 'BLUE'
            ? 'BLUE'
            : 'GOLD'
          : serverVerified
            ? 'GOLD'
            : user.verificationBadge?.badgeType || null,
        isMonetized: Boolean(user.premium),
        subscriptionApproved: membershipActive,
        liveAccess: Boolean(user.premium) || membershipActive,
        ranking: index + 1 + skip,
        category: user.profile?.creatorCategory || 'General',
        joinedAt: user.createdAt.toISOString(),
        lastStream: user.liveStreams?.[0]?.startedAt?.toISOString() || undefined,
        performance: {
          viewsGrowth: 0,
          followerGrowth: 0,
          earningsGrowth: 0,
          avgWatchTime: 0,
          engagementRate: 0,
          topStreams: user._count?.liveStreams || 0,
        },
      };
    });

    res.status(200).json({ creators: records, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const verifyCreator = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { creatorId } = req.params;
    const body: any = req.body || {};
    const requestedType = typeof body.badgeType === 'string' ? body.badgeType.trim().toUpperCase() : '';
    const badgeType: 'BLUE' | 'GOLD' = requestedType === 'BLUE' ? 'BLUE' : 'GOLD';
    const actorId = req.user?.userId;

    const user = await prisma.user.findUnique({
      where: { id: creatorId },
      select: {
        id: true,
        verified: true,
        verificationBadge: BADGE_USER_SELECT.verificationBadge,
      },
    });
    if (!user) {
      res.status(404).json({ error: 'Creator not found' });
      return;
    }

    const currentlyVerified = Boolean(user.verified) || isBadgeRowActive(user.verificationBadge);

    if (currentlyVerified) {
      if (user.verificationBadge) {
        await verificationService.revokeBadge(creatorId, actorId, 'Admin unverified creator');
      }
      await prisma.user.update({ where: { id: creatorId }, data: { verified: false } });
      res.status(200).json({ isVerified: false, verificationType: null, message: 'Creator verification removed' });
      return;
    }

    // Admin grant: lifetime badge (no expiry) at the requested tier.
    await verificationService.grantBadge(creatorId, badgeType, actorId);
    await prisma.user.update({ where: { id: creatorId }, data: { verified: true } });
    res.status(200).json({ isVerified: true, verificationType: badgeType, message: `Creator verified with ${badgeType} badge` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const toggleMonetization = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { creatorId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: creatorId }, select: { id: true, premium: true } });
    if (!user) {
      res.status(404).json({ error: 'Creator not found' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: creatorId },
      data: { premium: !user.premium },
      select: { premium: true },
    });

    res.status(200).json({
      isMonetized: Boolean(updated.premium),
      message: updated.premium ? 'Monetization enabled' : 'Monetization disabled',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const approveSubscription = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { creatorId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: creatorId }, select: { id: true } });
    if (!user) {
      res.status(404).json({ error: 'Creator not found' });
      return;
    }

    // Approve against a real active plan so the membership FK is always valid.
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
    if (!plan) {
      res.status(400).json({ error: 'No active subscription plan exists to approve against' });
      return;
    }

    const now = new Date();
    const existing = await prisma.creatorMembership.findUnique({ where: { userId: creatorId } });
    const existingActive =
      existing?.status === 'ACTIVE' && Boolean(existing.endDate) && existing.endDate.getTime() > now.getTime();
    const startDate = existingActive && existing?.endDate ? existing.endDate : now;
    const endDate = new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
    const renewalDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    let membership: any;
    if (existing) {
      membership = await prisma.creatorMembership.update({
        where: { userId: creatorId },
        data: {
          planId: plan.id,
          status: 'ACTIVE',
          startDate,
          endDate,
          renewalDate,
          autoRenew: false,
          cancelledAt: null,
          paymentMethod: null,
          paymentTxHash: null,
          updatedAt: now,
        },
      });
    } else {
      membership = await prisma.creatorMembership.create({
        data: {
          userId: creatorId,
          planId: plan.id,
          status: 'ACTIVE',
          startDate,
          endDate,
          renewalDate,
          autoRenew: false,
        },
      });
    }

    res.status(200).json({
      subscriptionApproved: true,
      liveAccess: true,
      plan: plan.name,
      tier: plan.badgeType,
      endDate: endDate.toISOString(),
      message: `Subscription approved (${plan.name}, active until ${endDate.toISOString().slice(0, 10)})`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// COMMUNITY MANAGEMENT
// ============================================================================

export const getCommunities = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          isPrivate: true,
          createdAt: true,
          owner: { select: { id: true, username: true } },
          _count: { select: { members: true, posts: true } },
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.community.count(),
    ]);

    res.status(200).json({ communities, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// LIVE STREAM MODERATION
// ============================================================================

export const getLiveStreams = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const activeOnly = req.query.active !== 'false';

    const where: any = {};
    if (activeOnly) where.active = true;

    const [streams, total] = await Promise.all([
      prisma.liveStream.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          viewerCount: true,
          active: true,
          allowGifts: true,
          allowPK: true,
          createdAt: true,
          host: { select: { id: true, username: true, avatar: true } },
          category: { select: { name: true } },
          _count: { select: { chatMessages: true, giftEvents: true } },
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.liveStream.count({ where }),
    ]);

    res.status(200).json({ streams, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// WALLET MANAGEMENT
// ============================================================================

export const getWalletTransactions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          description: true,
          createdAt: true,
          user: { select: { id: true, username: true, email: true } },
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.walletTransaction.count(),
    ]);

    res.status(200).json({ transactions, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// COIN MANAGEMENT
// ============================================================================

export const getCoinManagement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const [coinTransactions, total, totalCoinsInCirculation] = await Promise.all([
      prisma.coinTransaction.findMany({
        select: {
          id: true,
          type: true,
          amount: true,
          balance: true,
          description: true,
          reference: true,
          createdAt: true,
          user: { select: { id: true, username: true } },
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.coinTransaction.count(),
      prisma.user.aggregate({ _sum: { coins: true } }),
    ]);

    res.status(200).json({
      transactions: coinTransactions,
      total,
      totalCoinsInCirculation: totalCoinsInCirculation._sum.coins || 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// REPORTS & MODERATION
// ============================================================================

export const getReports = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const reports = await moderationService.getReports(limit, offset);
    res.status(200).json(reports);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const banUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, reason } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const user = await moderationService.banUser(userId, reason);
    await auditLog.log({
      userId: req.user?.userId,
      action: 'USER_BANNED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'User', resourceId: userId, targetId: userId, reason, previousValue: user.status },
      severity: 'CRITICAL',
    });
    res.status(200).json({
      message: 'User banned',
      user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const unbanUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const user = await moderationService.unbanUser(userId);
    await auditLog.log({
      userId: req.user?.userId,
      action: 'USER_UNBANNED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'User', resourceId: userId, targetId: userId },
      severity: 'WARNING',
    });
    res.status(200).json({
      message: 'User unbanned',
      user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const verifyUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const user = await moderationService.verifyUser(userId);
    await auditLog.log({
      userId: req.user?.userId,
      action: 'USER_VERIFIED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'User', resourceId: userId, targetId: userId },
      severity: 'WARNING',
    });
    res.status(200).json({
      message: 'User verified',
      user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const suspendUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, reason } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    const user = await moderationService.suspendUser(userId, reason || undefined);
    await auditLog.log({
      userId: req.user?.userId,
      action: 'USER_SUSPENDED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'User', resourceId: userId, targetId: userId, reason },
      severity: 'WARNING',
    });
    res.status(200).json({ message: 'User suspended', user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const restoreUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    const user = await moderationService.restoreUser(userId);
    await auditLog.log({
      userId: req.user?.userId,
      action: 'USER_RESTORED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'User', resourceId: userId, targetId: userId },
      severity: 'INFO',
    });
    res.status(200).json({ message: 'User restored', user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// WITHDRAWALS
// ============================================================================

export const getWithdrawals = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    const withdrawals = await prisma.withdrawal.findMany({
      include: {
        user: { select: { id: true, username: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.status(200).json(withdrawals);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const approveWithdrawal = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { withdrawalId } = req.body;

    if (!withdrawalId) {
      res.status(400).json({ error: 'withdrawalId is required' });
      return;
    }

    const withdrawal = await walletService.processWithdrawal(withdrawalId, req.user!.userId);
    res.status(200).json({
      message: 'Withdrawal approved',
      withdrawal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const rejectWithdrawal = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { withdrawalId, reason } = req.body;

    if (!withdrawalId) {
      res.status(400).json({ error: 'withdrawalId is required' });
      return;
    }

    const withdrawal = await walletService.rejectWithdrawal(withdrawalId, req.user!.userId, reason || 'Rejected by admin');
    res.status(200).json({
      message: 'Withdrawal rejected',
      withdrawal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// PLATFORM ANALYTICS
// ============================================================================

export const getPlatformAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newUsers30d,
      activeUsers7d,
      totalStreams,
      activeStreams,
      totalGiftTransactions,
      totalCoinTransactions,
      totalReports,
      platformRevenue,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: sevenDaysAgo } } }),
      prisma.liveStream.count(),
      prisma.liveStream.count({ where: { active: true } }),
      prisma.giftTransaction.aggregate({ _sum: { amount: true } }),
      prisma.coinTransaction.aggregate({ _sum: { amount: true } }),
      prisma.report.count(),
      prisma.purchaseOrder.aggregate({ _sum: { amount: true }, where: { status: 'COMPLETED' } }),
    ]);

    res.status(200).json({
      totalUsers,
      newUsers30d,
      activeUsers7d,
      totalStreams,
      activeStreams,
      totalGiftVolume: totalGiftTransactions._sum.amount || 0,
      totalCoinVolume: totalCoinTransactions._sum.amount || 0,
      totalReports,
      platformRevenue: platformRevenue._sum.amount || 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// PLATFORM SETTINGS
// ============================================================================

export const getPlatformSettings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rows = await prisma.platformSetting.findMany();
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;

    const num = (key: string, fallback: number) => {
      const raw = map[key];
      if (raw === undefined || raw === '') return fallback;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const bool = (key: string, fallback: boolean) => {
      const raw = map[key];
      if (raw === undefined || raw === '') return fallback;
      return raw === 'true' || raw === '1';
    };

    res.status(200).json({
      platformName: map['platformName'] || 'VANTA',
      maintenanceMode: bool('maintenanceMode', false),
      registrationOpen: bool('registrationOpen', true),
      maxUploadSize: num('maxUploadSize', 100),
      minWithdrawalAmount: num('minWithdrawalAmount', 10),
      maxWithdrawalAmount: num('maxWithdrawalAmount', 10000),
      giftCommissionRate: num('giftCommissionRate', 0.2),
      streamHealthCheckInterval: num('streamHealthCheckInterval', 30),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const updatePlatformSettings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const updates = req.body;
    const adminId = req.user?.userId || '';
    const allowed = [
      'platformName', 'maintenanceMode', 'registrationOpen', 'maxUploadSize',
      'minWithdrawalAmount', 'maxWithdrawalAmount', 'giftCommissionRate',
      'streamHealthCheckInterval',
    ];

    const writes = allowed.filter((k) => updates[k] !== undefined);
    if (writes.length === 0) {
      res.status(400).json({ error: 'No supported settings provided' });
      return;
    }

    for (const key of writes) {
      const value = typeof updates[key] === 'boolean' ? (updates[key] ? 'true' : 'false') : String(updates[key]);
      await prisma.platformSetting.upsert({
        where: { key },
        create: { key, value, type: typeof updates[key] === 'number' ? 'NUMBER' : typeof updates[key] === 'boolean' ? 'BOOLEAN' : 'STRING', updatedBy: adminId },
        update: { value, updatedBy: adminId },
      });
    }

    await auditLog.log({
      userId: adminId,
      action: 'PLATFORM_SETTINGS_UPDATED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'PlatformSetting', keys: writes },
      severity: 'WARNING',
    });

    res.status(200).json({ message: 'Platform settings updated', settings: writes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// SYSTEM LOGS
// ============================================================================

export const getSystemLogs = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const severity = req.query.severity as string;

    const where: any = {};
    if (severity) where.severity = severity;

    const [logs, total] = await Promise.all([
      prisma.securityLog.findMany({
        where,
        select: {
          id: true,
          userId: true,
          action: true,
          ipAddress: true,
          metadata: true,
          createdAt: true,
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.securityLog.count({ where }),
    ]);

    res.status(200).json({ logs, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// WALLET ADMIN - NEW ENDPOINTS
// ============================================================================

export const freezeWallet = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, reason } = req.body;
    if (!userId || !reason) { res.status(400).json({ error: 'userId and reason are required' }); return; }
    const wallet = await walletService.freezeWallet(userId, req.user!.userId, reason);
    res.status(200).json({ message: 'Wallet frozen', wallet });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const unfreezeWallet = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ error: 'userId is required' }); return; }
    const wallet = await walletService.unfreezeWallet(userId, req.user!.userId);
    res.status(200).json({ message: 'Wallet unfrozen', wallet });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const reverseTransaction = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { transactionId, reason } = req.body;
    if (!transactionId || !reason) { res.status(400).json({ error: 'transactionId and reason are required' }); return; }
    const result = await walletService.reverseTransaction(transactionId, req.user!.userId, reason);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const flagSuspiciousAccount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, reason } = req.body;
    if (!userId || !reason) { res.status(400).json({ error: 'userId and reason are required' }); return; }
    const result = await walletService.flagSuspiciousAccount(userId, req.user!.userId, reason);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getWalletAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const analytics = await walletService.getWalletAnalytics();
    res.status(200).json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getAllTransactions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const type = req.query.type as string;
    const status = req.query.status as string;

    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        include: { user: { select: { id: true, username: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    res.status(200).json({ transactions, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getAllDeposits = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const [deposits, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        include: { user: { select: { id: true, username: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.purchaseOrder.count(),
    ]);

    res.status(200).json({ deposits, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getCoinPaymentsDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const dashboard = await coinPaymentService.getCoinPaymentDashboard();
    res.status(200).json(dashboard);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const listCoinPayments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;
    const result = await coinPaymentService.listCoinPurchases({ limit, offset, status });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const refundCoinPurchase = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId || '';
    const orderId = req.params.orderId;
    const reason = req.body?.reason;
    if (!orderId) {
      res.status(400).json({ error: 'orderId is required' });
      return;
    }
    const result = await walletService.refundCoinPurchase(adminId, orderId, reason, req.ip);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getAllTransfers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const [transfers, total] = await Promise.all([
      prisma.coinTransfer.findMany({
        include: {
          sender: { select: { id: true, username: true, email: true } },
          receiver: { select: { id: true, username: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.coinTransfer.count(),
    ]);

    res.status(200).json({ transfers, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getAllGifts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const [gifts, total] = await Promise.all([
      prisma.giftTransaction.findMany({
        include: {
          gift: true,
          sender: { select: { id: true, username: true } },
          receiver: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.giftTransaction.count(),
    ]);

    res.status(200).json({ gifts, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getAllWithdrawals = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawal.findMany({
        include: { user: { select: { id: true, username: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.withdrawal.count(),
    ]);

    res.status(200).json({ withdrawals, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const searchUsers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const query = req.query.q as string;
    if (!query) { res.status(400).json({ error: 'Search query is required' }); return; }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query } },
          { email: { contains: query } },
          { fullName: { contains: query } },
        ],
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        verified: true,
        coins: true,
        earnings: true,
        createdAt: true,
        wallet: {
          select: {
            coinBalance: true,
            isFrozen: true,
            totalCoinsPurchased: true,
            totalCoinsSent: true,
            totalGiftsSent: true,
            totalGiftsReceived: true,
          },
        },
      },
      take: 20,
    });

    res.status(200).json(users);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// AD CAMPAIGN ADMIN
// ============================================================================

export const createCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { name, description, mediaUrl, mediaType, ctaText, ctaUrl, ctaInternal,
      targetCountry, priority, startDate, endDate, maxImpressions, maxClicks } = req.body;

    if (!name || !mediaUrl || !startDate) {
      res.status(400).json({ error: 'Name, mediaUrl, and startDate are required' });
      return;
    }

    const campaign = await adService.createCampaign({
      name, description, mediaUrl, mediaType, ctaText, ctaUrl, ctaInternal,
      targetCountry, priority, startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      maxImpressions, maxClicks, createdBy: userId!,
    });

    res.status(201).json({ message: 'Campaign created', campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const updateCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const updates = req.body;
    if (updates.startDate) updates.startDate = new Date(updates.startDate);
    if (updates.endDate) updates.endDate = new Date(updates.endDate);
    const campaign = await adService.updateCampaign(campaignId, updates);
    res.status(200).json({ message: 'Campaign updated', campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const deleteCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const result = await adService.deleteCampaign(campaignId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const campaign = await adService.getCampaign(campaignId);
    res.status(200).json(campaign);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const getCampaigns = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await adService.getCampaigns({ status, limit, offset });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const pauseCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const campaign = await adService.pauseCampaign(campaignId);
    res.status(200).json({ message: 'Campaign paused', campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const resumeCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const campaign = await adService.resumeCampaign(campaignId);
    res.status(200).json({ message: 'Campaign resumed', campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getCampaignAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.params;
    const analytics = await adService.getCampaignAnalytics(campaignId);
    res.status(200).json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getAllAdsAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const analytics = await adService.getAllAdsAnalytics();
    res.status(200).json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
// ============================================================================
// AUDIT LOGS
// ============================================================================

export const getAuditLogs = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const action = req.query.action as string;
    const adminId = req.query.admin as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const result = await adminService.getAuditLogs({ action, adminId, page, limit });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// INFRASTRUCTURE
// ============================================================================

export const getInfrastructure = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const infra = await adminService.getInfrastructure();
    res.status(200).json(infra);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// ============================================================================
// GOLD VERIFIED FOLLOWER REWARDS — ADMIN
// ============================================================================
// Real-data dashboards and audit ledgers. Read-only by design: historical
// claim records are immutable, so the admin UI surfaces data for inspection
// and tracing (Campaign -> Claim -> Wallet/GiftTransaction) without mutation.

const rewardError = (error: unknown): { status: number; body: any } => {
  if (error instanceof FollowerRewardError) {
    return { status: error.statusCode, body: { error: error.message, code: error.code } };
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  console.error('[admin follower-rewards]', error);
  return { status: 500, body: { error: 'Something went wrong.', code: 'INTERNAL' } };
};

// GET /api/admin/follower-rewards/stats — dashboard cards
export const getFollowerRewardStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const stats = await followerRewardService.getAdminStats();
    res.status(200).json(stats);
  } catch (error) {
    const { status, body } = rewardError(error);
    res.status(status).json(body);
  }
};

// GET /api/admin/follower-rewards — campaign table (search/filter/paginate)
export const listFollowerRewardCampaigns = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await followerRewardService.listAdminCampaigns({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      rewardType: typeof req.query.rewardType === 'string' ? req.query.rewardType : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      page: typeof req.query.page === 'string' ? Number(req.query.page) : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
    });
    res.status(200).json(result);
  } catch (error) {
    const { status, body } = rewardError(error);
    res.status(status).json(body);
  }
};

// GET /api/admin/follower-rewards/:campaignId — full campaign detail
export const getFollowerRewardCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const detail = await followerRewardService.getCampaignDetail(req.params.campaignId, undefined, { admin: true });
    res.status(200).json(detail);
  } catch (error) {
    const { status, body } = rewardError(error);
    res.status(status).json(body);
  }
};

// GET /api/admin/follower-rewards/:campaignId/claims — claim audit ledger
export const getFollowerRewardClaims = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await followerRewardService.getCampaignClaims(req.params.campaignId, '', { admin: true });
    res.status(200).json(result);
  } catch (error) {
    const { status, body } = rewardError(error);
    res.status(status).json(body);
  }
};

// GET /api/admin/follower-rewards/:campaignId/transactions — wallet ledger rows
export const getFollowerRewardTransactions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const transactions = await followerRewardService.getCampaignTransactions(req.params.campaignId);
    res.status(200).json({ transactions });
  } catch (error) {
    const { status, body } = rewardError(error);
    res.status(status).json(body);
  }
};
// FINANCE
// ============================================================================

export const getFinanceTransactions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const type = req.query.type as string;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const result = await adminService.getFinanceTransactions({ page, limit, type, status, search });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// CONTENT MODERATION
// ============================================================================

export const getContentItems = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await adminService.getContentOverview();
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const reviewContentItem = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { queueId } = req.params;
    const { action, reason } = req.body;
    if (!action || !['APPROVED', 'REMOVED'].includes(action)) {
      res.status(400).json({ error: 'action must be APPROVED or REMOVED' });
      return;
    }
    const adminId = req.user?.userId || '';
    const result = await adminService.reviewContent(queueId, action, adminId, reason);
    await auditLog.log({
      userId: adminId,
      action: `CONTENT_${action}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'ModerationQueue', resourceId: queueId, action, reason },
      severity: 'WARNING',
    });
    res.status(200).json({ message: `Content ${action.toLowerCase()}`, item: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
// ============================================================================
// NOTIFICATIONS (Notification Center)
// ============================================================================

export const getNotificationCenter = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const result = await adminService.getNotificationCenter({ page, limit });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// LIVE STREAM MODERATION
// ============================================================================

export const endLiveStream = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { streamId } = req.params;
    const adminId = req.user?.userId || '';
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }
    const result = await liveService.adminEndStream(streamId);
    await auditLog.log({
      userId: adminId,
      action: 'STREAM_ENDED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'LiveStream', resourceId: streamId, hostId: stream.hostId },
      severity: 'WARNING',
    });
    res.status(200).json({ message: 'Stream ended', stream: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const suspendLiveStream = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { streamId } = req.params;
    const reason = req.body?.reason || 'Suspended by admin';
    const adminId = req.user?.userId || '';
    const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }
    const result = await liveService.adminSuspendStream(streamId, reason);
    await auditLog.log({
      userId: adminId,
      action: 'STREAM_SUSPENDED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'LiveStream', resourceId: streamId, hostId: stream.hostId, reason },
      severity: 'CRITICAL',
    });
    res.status(200).json({ message: 'Stream suspended', stream: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// REPORT RESOLUTION
// ============================================================================

export const resolveReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { reportId } = req.params;
    const { status, action } = req.body;
    const adminId = req.user?.userId || '';
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    const nextStatus = status || (action === 'dismiss' ? 'DISMISSED' : 'RESOLVED');
    const updated = await prisma.report.update({
      where: { id: reportId },
      data: { status: nextStatus, resolvedBy: adminId, resolvedAt: new Date() },
    });
    await auditLog.log({
      userId: adminId,
      action: `REPORT_${nextStatus}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { resource: 'Report', resourceId: reportId, targetId: report.targetId },
      severity: 'WARNING',
    });
    res.status(200).json({ message: 'Report updated', report: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
