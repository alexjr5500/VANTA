import { prisma } from "../prisma";

// Store reference to emit notifications via socket
let ioRef: any = null;

export const setNotificationIO = (io: any) => {
  ioRef = io;
};

const emitToUser = (userId: string, event: string, data: any) => {
  if (ioRef) {
    ioRef.to(`user_${userId}`).emit(event, data);
  }
};

const parseMetadata = (data: string | null) => {
  if (!data) return {};
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const DEFAULT_PREFERENCES = {
  emailAlerts: true,
  pushAlerts: true,
  chatAlerts: true,
  liveAlerts: true,
};

const normalizeType = (type: string) => type.trim().toLowerCase();

// Map notification types to the user preference flag they respect
const preferenceKeyForType: Record<string, keyof typeof DEFAULT_PREFERENCES> = {
  follow: "pushAlerts",
  like: "pushAlerts",
  comment: "pushAlerts",
  gift: "pushAlerts",
  mention: "pushAlerts",
  message: "chatAlerts",
  live: "liveAlerts",
  stream: "liveAlerts",
  // wallet, system and milestone updates are important - only gated by push
  wallet: "pushAlerts",
  system: "pushAlerts",
  milestone: "pushAlerts",
};

export class NotificationService {
  async getNotifications(
    userId: string,
    limit: number = 50,
    cursor?: string,
    filters: { unreadOnly?: boolean; types?: string[] } = {}
  ) {
    const normalizedTypes = filters.types?.map(normalizeType).filter(Boolean);
    const storedTypes = normalizedTypes
      ? [...new Set(normalizedTypes.flatMap(type => [type, type.toUpperCase()]))]
      : undefined;
    const where = {
      userId,
      ...(filters.unreadOnly ? { read: false } : {}),
      ...(storedTypes?.length ? { type: { in: storedTypes } } : {}),
    };
    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const nextCursor = notifications.length > limit ? notifications.pop()?.id : undefined;
    const actorIds = [...new Set(notifications.map(item => item.actorId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, username: true, fullName: true, avatar: true, verified: true },
        })
      : [];
    const actorById = new Map(actors.map(actor => [actor.id, actor]));
    const items = notifications.map(notification => ({
      ...notification,
      data: parseMetadata(notification.data),
      actor: notification.actorId ? actorById.get(notification.actorId) ?? null : null,
    }));
    const unreadCount = await this.getUnreadCount(userId);
    return { items, nextCursor, unreadCount };
  }

  async getUnreadCount(userId: string) {
    const count = await prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });

    return count;
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new Error("Notification not found or unauthorized");
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true, readAt: new Date() },
    });

    const unreadCount = await this.getUnreadCount(userId);
    emitToUser(userId, "notifications_read", { ids: [notificationId] });
    emitToUser(userId, "unread_count", { count: unreadCount });
    return { ...updated, notification: updated, unreadCount };
  }

  async markAllAsRead(userId: string) {
    const result = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });

    emitToUser(userId, "notifications_read", { all: true });
    emitToUser(userId, "unread_count", { count: 0 });
    return { message: "All notifications marked as read", updatedCount: result.count, unreadCount: 0 };
  }

  /**
   * Marks the message-type notifications of a conversation as read and pushes
   * the authoritative unread count to the user in realtime. The chat read flow
   * calls this after marking MessageRead rows so the Notifications badge stays
   * in sync with the Chat badge (one unread message = one unread notification).
   */
  async markConversationNotificationsRead(userId: string, conversationId: string) {
    const updated = await prisma.notification.updateMany({
      where: {
        userId,
        type: { in: ["message", "MESSAGE"] },
        entityId: conversationId,
        read: false,
      },
      data: { read: true, readAt: new Date() },
    });

    if (updated.count > 0) {
      emitToUser(userId, "notifications_read", { all: true });
      const unreadCount = await this.getUnreadCount(userId);
      emitToUser(userId, "unread_count", { count: unreadCount });
      return unreadCount;
    }
    return null;
  }

  async deleteNotification(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new Error("Notification not found or unauthorized");
    }

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    const unreadCount = await this.getUnreadCount(userId);
    emitToUser(userId, "notification_deleted", { id: notificationId });
    emitToUser(userId, "unread_count", { count: unreadCount });
    return { message: "Notification deleted", unreadCount };
  }

  /**
   * Check whether a user has enabled notifications for a given channel/type.
   * Returns true when no explicit preference exists (defaults are enabled).
   */
  async shouldDeliver(userId: string, type: string): Promise<boolean> {
    const channel = preferenceKeyForType[normalizeType(type)];
    if (!channel) return true;

    const prefs = await prisma.notificationPreferences.findUnique({
      where: { userId },
      select: { [channel]: true },
    });

    // No stored preferences -> respect default (enabled)
    if (!prefs) return DEFAULT_PREFERENCES[channel];

    return prefs[channel];
  }

  async createNotification(
    userId: string,
    type: string,
    title: string,
    body: string,
    metadata?: any
  ) {
    // Respect the user's notification preferences before delivering
    const allowed = await this.shouldDeliver(userId, type);
    if (!allowed) return null;

    const actorId = typeof metadata?.actorId === "string"
      ? metadata.actorId
      : typeof metadata?.senderId === "string"
        ? metadata.senderId
        : typeof metadata?.followerId === "string" ? metadata.followerId : undefined;
    const normalizedType = normalizeType(type);
    if (actorId === userId && !["system", "wallet_deposit", "wallet_transfer_sent", "gift"].includes(normalizedType)) return null;
    const entityType = typeof metadata?.entityType === "string" ? metadata.entityType : undefined;
    const entityId = typeof metadata?.entityId === "string" ? metadata.entityId : undefined;
    const referenceKey = typeof metadata?.referenceKey === "string" ? metadata.referenceKey : undefined;

    let notification;
    try {
      notification = await prisma.notification.create({
        data: {
          userId,
          actorId,
          type,
          title,
          message: body,
          entityType,
          entityId,
          referenceKey,
          data: metadata ? JSON.stringify(metadata) : null,
        },
      });
    } catch (error: any) {
      // A transaction reference is an idempotency key. A retry returns the
      // durable notification instead of producing another unread item.
      if (referenceKey && error?.code === "P2002") {
        return prisma.notification.findFirst({ where: { userId, referenceKey } });
      }
      throw error;
    }

    // Emit real-time notification via socket
    const actor = actorId && prisma.user?.findUnique
      ? await prisma.user.findUnique({
          where: { id: actorId },
          select: { id: true, username: true, fullName: true, avatar: true, verified: true },
        })
      : null;
    emitToUser(userId, "new_notification", {
      ...notification,
      data: parseMetadata(notification.data),
      actor,
    });
    
    // Also emit unread count update
    const unreadCount = await this.getUnreadCount(userId);
    emitToUser(userId, "unread_count", { count: unreadCount });

    return notification;
  }

  async notifyFollow(userId: string, followerUsername: string, followerId: string) {
    return this.createNotification(
      userId,
      "follow",
      "New Follower",
      `${followerUsername} started following you`,
      { actorId: followerId, followerId, followerUsername, entityType: "profile", entityId: followerId, referenceKey: `follow:${followerId}` }
    );
  }

  async notifyLike(userId: string, likerUsername: string, postId: string, likerId?: string) {
    return this.createNotification(
      userId,
      "like",
      "New Like",
      `${likerUsername} liked your post`,
      { actorId: likerId, postId, likerUsername, entityType: "post", entityId: postId, referenceKey: likerId ? `post-like:${postId}:${likerId}` : undefined }
    );
  }

  async notifyComment(userId: string, commenterUsername: string, postId: string, commentContent: string, commenterId?: string, commentId?: string) {
    return this.createNotification(
      userId,
      "comment",
      "New Comment",
      `${commenterUsername} commented: "${commentContent.substring(0, 50)}"`,
      { actorId: commenterId, postId, commentId, commenterUsername, commentContent, entityType: "post", entityId: postId, referenceKey: commentId ? `comment:${commentId}` : undefined }
    );
  }

  async notifyNewMessage(receiverId: string, senderUsername: string, conversationId: string, senderId?: string, messageId?: string) {
    return this.createNotification(
      receiverId,
      "message",
      "New Message",
      `${senderUsername} sent you a message`,
      { actorId: senderId, conversationId, senderUsername, entityType: "conversation", entityId: conversationId, referenceKey: messageId ? `message:${messageId}` : undefined }
    );
  }

  async notifyGiftReceived(receiverId: string, senderUsername: string, giftName: string, amount: number, senderId?: string, transactionId?: string) {
    return this.createNotification(
      receiverId,
      "gift",
      "Gift Received",
      `${senderUsername} sent you ${giftName} worth ${amount} coins`,
      { actorId: senderId, senderUsername, giftName, amount, transactionId, entityType: "transaction", entityId: transactionId, referenceKey: transactionId ? `gift:${transactionId}` : undefined }
    );
  }

  async notifyLiveStarted(followers: string[], hostUsername: string, streamId: string, title: string) {
    if (followers.length === 0) return [];

    // Load preference rows for all followers
    const prefRows = await prisma.notificationPreferences.findMany({
      where: {
        userId: { in: followers },
      },
      select: { userId: true, liveAlerts: true },
    });
    const prefByUser = new Map(prefRows.map(r => [r.userId, r.liveAlerts]));

    // Followers without explicit preferences are included by default (liveAlerts defaults to true)
    const recipients = followers.filter(fid => prefByUser.get(fid) !== false);

    const notifications = await Promise.all(
      recipients.map(followerId =>
        this.createNotification(
          followerId,
          "live",
            "Live Now",
          `${hostUsername} is live: "${title}"`,
          { streamId, hostUsername, title, entityType: "live", entityId: streamId, referenceKey: `live-start:${streamId}` }
        )
      )
    );
    return notifications.filter(Boolean);
  }

  async notifyStreamEnded(hostId: string, streamTitle: string) {
    return this.createNotification(
      hostId,
      "system",
      "Stream Ended",
      `Your stream "${streamTitle}" has ended. Check your analytics for details.`,
      { streamTitle }
    );
  }

  async notifyWithdrawalStatus(userId: string, status: string, amount: number) {
    const statusText = status === "COMPLETED" ? "approved" : status === "REJECTED" ? "rejected" : "pending";
    return this.createNotification(
      userId,
      "wallet",
      "Withdrawal Update",
      `Your withdrawal of $${amount} has been ${statusText}`,
      { status, amount }
    );
  }

  async notifyMilestone(userId: string, milestone: string, value: number) {
    return this.createNotification(
      userId,
      "system",
      "Milestone Reached",
      `Congratulations! You've reached ${value} ${milestone}`,
      { milestone, value }
    );
  }
}

export const notificationService = new NotificationService();
