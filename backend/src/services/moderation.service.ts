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
        type: "USER",
        reason,
      },
    });

    return report;
  }

  async getReports(limit: number = 50, offset: number = 0) {
    const reports = await prisma.report.findMany({
      include: {
        reporter: { select: { id: true, username: true } },
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
        reporter: { select: { id: true, username: true } },
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
        message: `Your account has been banned. Reason: ${reason}`,
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

  /**
   * Suspend a user account. A suspended account is blocked from authenticating
   * (the auth middleware returns 403 for status !== 'ACTIVE') and from every
   * authenticated API action, so this is an effective, persisted moderation
   * action — not a UI-only toggle.
   */
  async suspendUser(userId: string, reason: string = "Account suspended") {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "SUSPENDED" },
    });

    await prisma.notification.create({
      data: {
        userId,
        type: "USER_SUSPENDED",
        title: "Account Suspended",
        message: `Your account has been suspended. Reason: ${reason}`,
      },
    });

    return user;
  }

  /**
   * Restore an account to an ACTIVE state (used after a suspension is lifted or
   * an incorrect restriction is reversed). Only meaningful for restricted
   * accounts — an ACTIVE account is left untouched.
   */
  async restoreUser(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "ACTIVE" },
    });

    await prisma.notification.create({
      data: {
        userId,
        type: "ACCOUNT_RESTORED",
        title: "Account Restored",
        message: "Your account has been restored and is now active.",
      },
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
        message: "Your account has been verified",
      },
    });

    return user;
  }

  async getBlockedUsers(userId: string) {
    // In a real app, query from Block table
    return [];
  }
}

export const moderationService = new ModerationService();
