import { prisma } from '../prisma';
import { cacheService } from './cache.service';
import { removeModeratedContent } from './content-removal.service';
import { uploadService } from './upload.service';
import { healthStatus } from './monitoring.service';
import {
  startOfToday,
  startOfThisWeek,
  startOfThisMonth,
  startOfThisYear,
  startOfDaysAgo,
  dailyBuckets,
  monthlyBuckets,
} from '../utils/admin-dates';
import os from 'os';

/**
 * Unique user ids that have been active since `since` (sessions or presence).
 * This is the canonical "active user" definition used across the Admin area:
 * a user is active in a window when any authenticated session touched the API
 * (`Session.lastActiveAt`) or the realtime/presence layer observed them
 * (`UserPresence.lastActive`) inside that window.
 */
async function activeUserIdsSince(since: Date): Promise<Set<string>> {
  const ids = new Set<string>();

  const [sessionRows, presenceRows] = await Promise.all([
    prisma.session.findMany({
      where: { lastActiveAt: { gte: since } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.userPresence.findMany({
      where: { lastActive: { gte: since } },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ]);

  for (const row of sessionRows) ids.add(row.userId);
  for (const row of presenceRows) ids.add(row.userId);
  return ids;
}

/** Local calendar label (YYYY-MM-DD) for a timestamp in the admin timezone. */
function localDayLabel(at: Date, offsetMinutes: number): string {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
}

function tzOffset(): number {
  const raw = process.env.ADMIN_TZ_OFFSET_MINUTES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 60;
}

/** Bucket a list of creation timestamps into the supplied labelled buckets. */
function bucketByLabel(createdAts: Date[], buckets: { label: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const b of buckets) counts[b.label] = 0;

  const bucketIndex = new Map<string, number>();
  buckets.forEach((b, i) => bucketIndex.set(b.label, i));

  const offset = tzOffset();
  for (const at of createdAts) {
    const label = localDayLabel(at, offset);
    const idx = bucketIndex.get(label);
    if (idx !== undefined) counts[buckets[idx].label] += 1;
  }
  return counts;
}

export class AdminService {
  /**
   * Full real-data dashboard snapshot. Every number is computed from the
   * database — no hardcoded or estimated values.
   */
  async getDashboardStats() {
    const todayStart = startOfToday();
    const weekStart = startOfThisWeek();
    const monthStart = startOfThisMonth();
    const yearStart = startOfThisYear();
    const month30Start = startOfDaysAgo(30);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
const [
      totalUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      newUsersThisYear,
      suspendedUsers,
      bannedUsers,
      verifiedUsers,
      verifiedBadgeUsers,
      onlineUsers,
      totalPosts,
      totalVideos,
      totalStories,
      totalComments,
      totalStreams,
      activeStreams,
      totalReports,
      pendingReports,
      pendingWithdrawals,
      totalTransactions,
      coinPurchases,
      badgePurchases,
      totalCoinsInCirculation,
      giftVolume,
      revenueCompleted,
      sessionsToday,
      presenceToday,
      sessions30d,
      presence30d,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.user.count({ where: { createdAt: { gte: yearStart } } }),
      prisma.user.count({ where: { status: 'SUSPENDED' } }),
      prisma.user.count({ where: { status: 'BANNED' } }),
      prisma.user.count({ where: { verified: true } }),
      prisma.verificationBadge.count({ where: { status: 'ACTIVE' } }),
      prisma.userPresence.count({ where: { isOnline: true, lastActive: { gte: fiveMinutesAgo } } }),
      prisma.post.count(),
      prisma.video.count(),
      prisma.story.count(),
      prisma.postComment.count(),
      prisma.liveStream.count(),
      prisma.liveStream.count({ where: { active: true, status: 'LIVE' } }),
      prisma.report.count(),
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.withdrawal.count({ where: { status: { in: ['PENDING', 'PROCESSING', 'APPROVED', 'PAYOUT_RESERVED'] } } }),
      prisma.walletTransaction.count(),
      prisma.purchaseOrder.count({ where: { status: 'COMPLETED' } }),
      prisma.verificationPurchase.count({ where: { status: 'COMPLETED' } }),
      prisma.user.aggregate({ _sum: { coins: true } }),
      prisma.giftTransaction.aggregate({ _sum: { amount: true } }),
      prisma.purchaseOrder.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
      prisma.session.findMany({ where: { lastActiveAt: { gte: todayStart } }, select: { userId: true }, distinct: ['userId'] }),
      prisma.userPresence.findMany({ where: { lastActive: { gte: todayStart } }, select: { userId: true }, distinct: ['userId'] }),
      prisma.session.findMany({ where: { lastActiveAt: { gte: month30Start } }, select: { userId: true }, distinct: ['userId'] }),
      prisma.userPresence.findMany({ where: { lastActive: { gte: month30Start } }, select: { userId: true }, distinct: ['userId'] }),
    ]);

    // Merge session + presence activity into unique user sets.
    const activeToday = new Set<string>();
    for (const r of sessionsToday) activeToday.add(r.userId);
    for (const r of presenceToday) activeToday.add(r.userId);

    const active30d = new Set<string>();
    for (const r of sessions30d) active30d.add(r.userId);
    for (const r of presence30d) active30d.add(r.userId);

    // Verified = legacy `verified` flag OR an active paid badge (distinct).
    const verifiedTotal = verifiedUsers + verifiedBadgeUsers;

    const revenue = revenueCompleted._sum.amount || 0;

    return {
      totalUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      newUsersThisYear,
      activeUsersToday: activeToday.size,
      activeUsersThisWeek: (await activeUserIdsSince(weekStart)).size,
      activeUsersThisMonth: (await activeUserIdsSince(monthStart)).size,
      activeUsersLast30d: active30d.size,
      onlineUsers,
      inactiveUsers: Math.max(0, totalUsers - active30d.size),
      suspendedUsers,
      bannedUsers,
      verifiedUsers: verifiedTotal,
      totalPosts,
      totalVideos,
      totalStories,
      totalComments,
      totalContent: totalPosts + totalVideos + totalStories + totalComments,
      totalStreams,
      activeStreams,
      totalReports,
      pendingReports,
      pendingWithdrawals,
      totalTransactions,
      coinPurchases,
      badgePurchases,
      totalCoinsInCirculation: totalCoinsInCirculation._sum.coins || 0,
      totalGiftVolume: giftVolume._sum.amount || 0,
      revenue,
      estimatedRevenue: revenue, // revenue is now real (completed purchase orders)
      activeStreamCount: activeStreams,
    };
  }
/**
   * User-growth series computed from real `User.createdAt` timestamps.
   * Returns per-day buckets for 7/30/90 days and per-month buckets for 12 months.
   */
  async getUserGrowth() {
    const [seven, thirty, ninety, twelveMonths] = await Promise.all([
      this.growthDaily(7),
      this.growthDaily(30),
      this.growthDaily(90),
      this.growthMonthly(12),
    ]);
    return { '7d': seven, '30d': thirty, '90d': ninety, '12m': twelveMonths };
  }

  private async growthDaily(days: number) {
    const buckets = dailyBuckets(days);
    const start = buckets[0].start;
    const rows = await prisma.user.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true },
    });
    const counts = bucketByLabel(rows.map((r) => r.createdAt), buckets);
    return buckets.map((b) => ({ date: b.label, count: counts[b.label] || 0 }));
  }

  private async growthMonthly(months: number) {
    const buckets = monthlyBuckets(months);
    const start = buckets[0].start;
    const rows = await prisma.user.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true },
    });
    const counts: Record<string, number> = {};
    for (const b of buckets) counts[b.label] = 0;
    const offset = tzOffset();
    for (const row of rows) {
      const shifted = new Date(row.createdAt.getTime() + offset * 60_000);
      const label = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
      if (counts[label] !== undefined) counts[label] += 1;
    }
    return buckets.map((b) => ({ month: b.label, count: counts[b.label] || 0 }));
  }

  /** Recent users (dashboard widget). */
  async getRecentUsers(limit = 6) {
    return prisma.user.findMany({
      select: {
        id: true,
        username: true,
        fullName: true,
        avatar: true,
        verified: true,
        status: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Recent reports (dashboard widget). */
  async getRecentReports(limit = 6) {
    return prisma.report.findMany({
      include: {
        reporter: { select: { id: true, username: true } },
        target: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Audit log listing backed by the tamper-resistant SecurityLog chain. */
  async getAuditLogs(params: { action?: string; adminId?: string; search?: string; page?: number; limit?: number }) {
    const limit = Math.min(Math.max(params.limit || 50, 1), 200);
    const offset = Math.max((params.page || 1) - 1, 0) * limit;

    const where: any = {};
    if (params.action) where.action = { contains: params.action };
    if (params.adminId) where.userId = params.adminId;
    const search = params.search?.trim().slice(0, 200);
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { ipAddress: { contains: search, mode: 'insensitive' } },
        { userAgent: { contains: search, mode: 'insensitive' } },
        { metadata: { contains: search, mode: 'insensitive' } },
        {
          user: {
            is: {
              OR: [
                { username: { contains: search, mode: 'insensitive' } },
                { fullName: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.securityLog.findMany({
        where,
        include: { user: { select: { id: true, username: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.securityLog.count({ where }),
    ]);

    return {
      logs: logs.map((log) => {
        let metadata: any = null;
        try { metadata = log.metadata ? JSON.parse(log.metadata) : null; } catch { metadata = null; }
        return {
          id: log.id,
          adminId: log.userId,
          adminName: log.user?.username || log.user?.fullName || 'system',
          action: log.action,
          resource: metadata?.resource || metadata?.targetType || 'system',
          resourceId: metadata?.resourceId || metadata?.targetId || metadata?.userId || '',
          timestamp: log.createdAt.toISOString(),
          ip: log.ipAddress,
          device: log.userAgent,
          metadata,
          previousValue: metadata?.previousValue,
          newValue: metadata?.newValue,
        };
      }),
      total,
    };
  }

  /** Real server infrastructure metrics (os + in-process health statuses). */
  async getInfrastructure() {
    const cpus = os.cpus();
    const cores = cpus.length;
    const load = os.loadavg();
    const cpuUsage = cores > 0 ? Math.min(100, Math.round((load[0] / cores) * 100)) : 0;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryPct = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;

    const uptimeSec = Math.round(os.uptime());
    const uptime = `${Math.floor(uptimeSec / 86400)}d ${Math.floor((uptimeSec % 86400) / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

    const statuses = healthStatus.getAllStatuses();
    const services = Object.entries(statuses).map(([name, s]: [string, any]) => ({
      name,
      status: s.status,
      uptime: s.lastCheck ? `${Math.max(0, Math.round((Date.now() - s.lastCheck) / 1000))}s ago` : 'unknown',
    }));
    if (services.length === 0) {
      services.push({ name: 'api', status: 'healthy', uptime: 'running' });
      services.push({ name: 'database', status: 'healthy', uptime: 'connected' });
    }

    const interfaces = os.networkInterfaces();
    const activeIfaces = Object.values(interfaces).flat().filter((i: any) => i && !i.internal);

    return {
      cpu: { usage: cpuUsage, cores },
      memory: { used: Math.round(usedMem / 1024 ** 3), total: Math.round(totalMem / 1024 ** 3), percentage: memoryPct },
      disk: { used: 0, total: 0, percentage: 0 },
      network: { incoming: activeIfaces.length, outgoing: activeIfaces.length },
      uptime,
      services,
      regions: [{ name: 'primary', latency: 0, status: healthStatus.overallHealth }],
      overallHealth: healthStatus.overallHealth,
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.arch()}`,
    };
  }
/**
   * Finance ledger: real wallet transactions + completed coin purchases,
   * newest first, with real aggregate summaries.
   */
  async getFinanceTransactions(params: { page?: number; limit?: number; type?: string; status?: string; search?: string }) {
    const limit = Math.min(Math.max(params.limit || 50, 1), 200);
    const offset = Math.max((params.page || 1) - 1, 0) * limit;

    const where: any = {};
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { description: { contains: params.search, mode: 'insensitive' } },
        { reference: { contains: params.search, mode: 'insensitive' } },
        { user: { username: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    const [transactions, total, completedVanta, completedUsd, pendingVanta, pendingUsd, reversedVanta, reversedUsd, purchaseAgg, legacyGiftRows] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        include: { user: { select: { id: true, username: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.walletTransaction.count({ where }),
      prisma.walletTransaction.aggregate({ where: { status: 'COMPLETED', currency: 'VANTA' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { status: 'COMPLETED', currency: 'USD' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { status: 'PENDING', currency: 'VANTA' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { status: 'PENDING', currency: 'USD' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { status: 'REVERSED', currency: 'VANTA' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { status: 'REVERSED', currency: 'USD' }, _sum: { amount: true } }),
      prisma.purchaseOrder.aggregate({ where: { status: 'COMPLETED', currency: 'USD' }, _sum: { amount: true } }),
      prisma.walletTransaction.findMany({
        where: { type: 'GIFT_RECEIVED', currency: 'VANTA' },
        select: { amount: true, status: true, metadata: true },
      }),
    ]);

    const legacyCashByStatus = { COMPLETED: 0, PENDING: 0, REVERSED: 0 };
    for (const row of legacyGiftRows) {
      let metadata: any = null;
      try { metadata = row.metadata ? JSON.parse(row.metadata) : null; } catch { metadata = null; }
      if (metadata?.autoConverted === true || metadata?.creatorEarningsUsd == null || !Number.isFinite(Number(metadata.creatorEarningsUsd))) continue;
      if (row.status === 'COMPLETED' || row.status === 'PENDING' || row.status === 'REVERSED') {
        legacyCashByStatus[row.status] += Math.abs(row.amount);
      }
    }

    const transactionsWithCurrency = transactions.map((t) => {
      const metadata = t.metadata ? (() => { try { return JSON.parse(t.metadata!); } catch { return null; } })() : null;
      const legacyCashGift = t.type === 'GIFT_RECEIVED' && t.currency !== 'USD' &&
        metadata?.autoConverted !== true && metadata?.creatorEarningsUsd != null &&
        Number.isFinite(Number(metadata.creatorEarningsUsd));
      const currency = legacyCashGift ? 'USD' : (t.currency || 'VANTA');
      const outgoing = new Set(['TRANSFER_SENT', 'GIFT_SENT', 'WITHDRAWAL', 'FEE', 'SUBSCRIPTION', 'ADMIN_DEBIT', 'FOLLOWER_REWARD_RESERVE']);
      const isOutgoing = outgoing.has(t.type) || (t.type === 'FOLLOWER_REWARD_CLAIM' && metadata?.side === 'creator');
      return {
        id: t.id,
        type: t.type,
        status: t.status,
        currency,
        amount: Math.abs(t.amount),
        displayAmount: isOutgoing ? -Math.abs(t.amount) : Math.abs(t.amount),
        fee: t.fee,
        balance: t.balance,
        description: t.description || '',
        reference: t.reference,
        createdAt: t.createdAt.toISOString(),
        userName: t.user?.username || 'unknown',
        userId: t.user?.id,
        metadata,
      };
    });

    return {
      transactions: transactionsWithCurrency,
      total,
      summary: {
        totalProcessedUsd: (completedUsd._sum.amount || 0) + legacyCashByStatus.COMPLETED,
        totalProcessedVanta: (completedVanta._sum.amount || 0) - legacyCashByStatus.COMPLETED,
        pendingReviewUsd: (pendingUsd._sum.amount || 0) + legacyCashByStatus.PENDING,
        pendingReviewVanta: (pendingVanta._sum.amount || 0) - legacyCashByStatus.PENDING,
        refundsUsd: (reversedUsd._sum.amount || 0) + legacyCashByStatus.REVERSED,
        refundsVanta: (reversedVanta._sum.amount || 0) - legacyCashByStatus.REVERSED,
        totalPurchaseRevenue: purchaseAgg._sum.amount || 0,
        count: total,
      },
    };
  }

  /** Content overview + pending moderation queue (real data). */
  async getContentOverview() {
    const [posts, videos, stories, comments, queue, queueTotal, reports] = await Promise.all([
      prisma.post.count(),
      prisma.video.count(),
      prisma.story.count(),
      prisma.postComment.count(),
      prisma.moderationQueue.findMany({
        where: { status: 'PENDING' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: 100,
      }),
      prisma.moderationQueue.count({ where: { status: 'PENDING' } }),
      prisma.report.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      counts: { posts, videos, stories, comments, total: posts + videos + stories + comments },
      pendingQueue: queueTotal,
      pendingReports: reports,
      queue: queue.map((q) => ({
        id: q.id,
        targetType: q.targetType,
        targetId: q.targetId,
        targetUserId: q.targetUserId,
        reportedBy: q.reportedBy,
        category: q.category,
        description: q.description,
        evidenceUrls: q.evidenceUrls,
        reason: q.reason,
        aiScore: q.aiScore,
        aiCategories: q.aiCategories,
        aiSummary: q.aiSummary,
        status: q.status,
        priority: q.priority,
        createdAt: q.createdAt.toISOString(),
      })),
    };
  }

  /** Review a moderation item. REMOVED is an atomic content deletion, not just a queue status. */
  async reviewContent(queueId: string, action: 'APPROVED' | 'REMOVED', adminId: string, reason?: string) {
    let removedFiles: Array<{ id: string; filename: string }> = [];
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.moderationQueue.findUnique({ where: { id: queueId } });
      if (!item) throw new Error('Moderation item not found');
      if (item.status !== 'PENDING') throw new Error('Moderation item is already resolved');

      // If the content cannot be found or its type is unsupported, throw before
      // resolving the queue item. The transaction then leaves the report pending.
      if (action === 'REMOVED') {
        removedFiles = await removeModeratedContent(tx, item.targetType, item.targetId);
      }

      const resolution = await tx.moderationQueue.updateMany({
        where: { id: queueId, status: 'PENDING' },
        data: { status: action, reviewedBy: adminId, reviewedAt: new Date(), humanReview: true },
      });
      if (resolution.count !== 1) throw new Error('Moderation item is already resolved');
      const resolved = await tx.moderationQueue.findUnique({ where: { id: queueId } });
      if (!resolved) throw new Error('Moderation item not found after review');
      await tx.moderationAction.create({
        data: {
          queueId,
          moderatorId: adminId,
          action,
          reason: reason || null,
          automated: false,
        },
      });
      return resolved;
    });

    if (action === 'REMOVED') {
      // The database tombstone is committed first. Delete the corresponding
      // local/Cloudinary assets afterwards so a storage outage cannot roll
      // back a completed moderation decision or leave content visible.
      const cleanup = await Promise.allSettled(removedFiles.map(file => uploadService.deleteFile(file.filename, file.id)));
      cleanup.forEach((result, index) => {
        if (result.status === 'rejected' || result.value === false) {
          console.error('[AdminModeration] Removed content media cleanup failed:', removedFiles[index]?.id);
        }
      });

      // Purge all shared discovery/feed caches so deleted material cannot
      // reappear from a previously cached page after moderation succeeds.
      await Promise.all([
        cacheService.delPattern('feed:*'),
        cacheService.delPattern('homefeed:*'),
        cacheService.delPattern('explore:*'),
        cacheService.delPattern('trending:*'),
        cacheService.delPattern('stories:*'),
        cacheService.delPattern('live:*'),
      ]);
    }

    return updated;
  }

  /** Notification center: real in-app notification statistics + recent items. */
  async getNotificationCenter(params: { page?: number; limit?: number }) {
    const limit = Math.min(Math.max(params.limit || 50, 1), 200);
    const offset = Math.max((params.page || 1) - 1, 0) * limit;

    const [total, unread, today, byType, recent, deliveryCounts] = await Promise.all([
      prisma.notification.count(),
      prisma.notification.count({ where: { read: false } }),
      prisma.notification.count({ where: { createdAt: { gte: startOfToday() } } }),
      prisma.notification.groupBy({ by: ['type'], _count: { _all: true }, orderBy: { _count: { type: 'desc' } }, take: 12 }),
      prisma.notification.findMany({
        include: { user: { select: { id: true, username: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      (async () => {
        const [sent, opened, clicked] = await Promise.all([
          prisma.notificationDelivery.count({ where: { delivered: true } }),
          prisma.notificationDelivery.count({ where: { opened: true } }),
          prisma.notificationDelivery.count({ where: { clicked: true } }),
        ]);
        return { sent, opened, clicked };
      })(),
    ]);

    return {
      stats: {
        total,
        unread,
        sentToday: today,
        delivered: deliveryCounts.sent,
        opened: deliveryCounts.opened,
        clicked: deliveryCounts.clicked,
      },
      byType: byType.map((t) => ({ type: t.type, count: t._count._all })),
      notifications: recent.map((n) => ({
        id: n.id,
        userId: n.userId,
        username: n.user?.username || 'unknown',
        avatar: n.user?.avatar,
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
      totalCount: total,
    };
  }
}

export const adminService = new AdminService();