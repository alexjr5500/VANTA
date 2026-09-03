import { prisma } from "../prisma";

export class ModerationService {
  async reportUser(reporterId: string, targetId: string, reason: string) {
    if (reporterId === targetId) {
      throw new Error("Cannot report yourself");
    }

    const existingReport = await prisma.report.findFirst({
      where: {
        reporterId,
        targetId,
      },
    });

    if (existingReport) {
      throw new Error("You have already reported this user");
    }

    const report = await prisma.report.create({
      data: {
        reporterId,
        targetId,
        reason,
      },
    });

    return report;
  }

  async getReports(limit: number = 50, offset: number = 0) {
    const reports = await prisma.report.findMany({
      include: {
        submitter: { select: { id: true, username: true } },
        target: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    return reports;
  }

  async getReportsByUser(targetId: string) {
    const reports = await prisma.report.findMany({
      where: { targetId },
      include: {
        submitter: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return reports;
  }

  async banUser(userId: string, reason: string = "User violation") {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "BANNED" },
    });

    // Create notification log
    await prisma.notification.create({
      data: {
        userId,
        type: "USER_BANNED",
        title: "Account Banned",
        body: `Your account has been banned. Reason: ${reason}`,
      },
    });

    return user;
  }

  async unbanUser(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "ACTIVE" },
    });

    return user;
  }

  async blockUser(userId: string, blockedUserId: string) {
    // In a real app, you'd have a Block model
    // For now, we'll delete the match if it exists
    if (userId === blockedUserId) {
      throw new Error("Cannot block yourself");
    }

    await prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: userId, followingId: blockedUserId },
          { followerId: blockedUserId, followingId: userId },
        ],
      },
    });

    return { message: "User blocked successfully" };
  }

  async unblockUser(userId: string, unblockedUserId: string) {
    // In a real app, remove from Block table
    return { message: "User unblocked successfully" };
  }

  async deleteInappropriateContent(messageId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new Error("Message not found");
    }

    await prisma.message.delete({
      where: { id: messageId },
    });

    return { message: "Message deleted by moderator" };
  }

  async getModerationStats() {
    const [totalReports, totalBanned, totalMessages] = await Promise.all([
      prisma.report.count(),
      prisma.user.count({ where: { status: "BANNED" } }),
      prisma.message.count(),
    ]);

    const deletedMessages = 0; // Would track from audit log in production

    return {
      totalReports,
      totalBanned,
      totalMessages,
      deletedMessages,
      approvalRate: totalReports > 0 ? (totalBanned / totalReports * 100).toFixed(2) : 0,
    };
  }

  async verifyUser(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { verified: true },
    });

    await prisma.notification.create({
      data: {
        userId,
        type: "USER_VERIFIED",
        title: "Account Verified",
        body: "Your account has been verified",
      },
    });

    return user;
  }

  async suspendUser(userId: string, days: number = 7) {
    const suspendUntil = new Date();
    suspendUntil.setDate(suspendUntil.getDate() + days);

    // In a real app, store suspension info in User model or separate table
    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "SUSPENDED" },
    });

    return user;
  }

  async getBlockedUsers(userId: string) {
    // In a real app, query from Block table
    return [];
  }
}

export const moderationService = new ModerationService();
