import { prisma } from '../prisma';
import { moderationService } from './moderation.service';

export class AdminService {
  async getDashboardStats() {
    const [totalUsers, activeStreams, pendingWithdrawals, stats] = await Promise.all([
      prisma.user.count(),
      prisma.liveStream.count({ where: { active: true } }),
      prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      moderationService.getModerationStats(),
    ]);

    const giftTransactions = await prisma.giftTransaction.aggregate({
      _sum: { amount: true },
    });

    return {
      totalUsers,
      activeStreams,
      pendingWithdrawals,
      totalReports: stats.totalReports,
      totalBanned: stats.totalBanned,
      estimatedRevenue: (giftTransactions._sum.amount || 0) * 0.2,
    };
  }

  async getUsers(limit = 100, offset = 0) {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        verified: true,
        premium: true,
        status: true,
        createdAt: true,
      },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }

  async getWithdrawals(limit = 20) {
    const withdrawals = await prisma.withdrawal.findMany({
      include: {
        user: { select: { id: true, username: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return withdrawals;
  }
}

export const adminService = new AdminService();
