import { prisma } from "../prisma";
import { canReceiveMention } from "../security/privacyPermissions";
import { postMentionNames } from "./post-mentions";
import { BADGE_USER_SELECT, enrichPublicUser } from "./public-verification";
import { pushNotificationService } from "./push/push-notification.service";

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

// Map every notification type to (a) its granular category preference and
// (b) the master channel that gates it. Both must be enabled for delivery so
// the category toggles and the master switches independently control behavior.
const GRANULAR_PREFERENCE_KEY: Record<string, string> = {
  follow: "followersAlerts",
  like: "likesAlerts",
  comment: "commentsAlerts",
  mention: "mentionsAlerts",
  message: "chatAlerts",
  group: "groupAlerts",
  channel: "channelAlerts",
  live: "liveAlerts",
  stream: "liveAlerts",
  live_interaction: "liveInteractionsAlerts",
  // wallet, system and milestone updates are important - only gated by push
  wallet: "pushAlerts",
  system: "pushAlerts",
  milestone: "pushAlerts",
  gift: "pushAlerts",
};

const MASTER_PREFERENCE_KEY: Record<string, keyof typeof DEFAULT_PREFERENCES> = {
  follow: "pushAlerts",
  like: "pushAlerts",
  comment: "pushAlerts",
  mention: "pushAlerts",
  message: "chatAlerts",
  group: "chatAlerts",
  channel: "chatAlerts",
  live: "liveAlerts",
  stream: "liveAlerts",
  live_interaction: "liveAlerts",
  wallet: "pushAlerts",
  system: "pushAlerts",
  milestone: "pushAlerts",
  gift: "pushAlerts",
};

// Legacy map kept for callers that only care about the master channel.
const preferenceKeyForType: Record<string, keyof typeof DEFAULT_PREFERENCES> = MASTER_PREFERENCE_KEY;

export class NotificationService {
  async getNotifications(
    userId: string,
    limit: number = 50,
    cursor?: string,
    filters: { unreadOnly?: boolean; types?: string[] } = {}
  ) {
    const normalizedTypes = filters.types?.map(normalizeType).filter(type => Boolean(type) && !["message", "group", "channel"].includes(type));
    const excludedChatTypes = ["message", "MESSAGE", "group", "GROUP", "channel", "CHANNEL", "direct_message", "DIRECT_MESSAGE", "chat_message", "CHAT_MESSAGE"];
    const storedTypes = normalizedTypes
      ? [...new Set(normalizedTypes.flatMap(type => [type, type.toUpperCase()]))]
      : undefined;
    if (filters.types?.length && !storedTypes?.length) {
      return { items: [], nextCursor: undefined, unreadCount: await this.getUnreadCount(userId) };
    }
    const typeFilter = storedTypes?.length
      ? { notIn: excludedChatTypes, in: storedTypes }
      : { notIn: excludedChatTypes };
    const where = {
      userId,
      // Chat activity is exclusively handled by Chats. Never surface it here.
      type: typeFilter,
      ...(filters.unreadOnly ? { read: false } : {}),
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
          select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT },
        })
      : [];
    const actorById = new Map(actors.map(actor => [actor.id, enrichPublicUser(actor)]));
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
        // Legacy chat notification rows must not inflate the Notifications badge.
        type: { notIn: ["message", "MESSAGE", "group", "GROUP", "channel", "CHANNEL", "direct_message", "DIRECT_MESSAGE", "chat_message", "CHAT_MESSAGE"] },
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
   * Legacy compatibility shim. Chat unread state is owned by the Chat system;
   * this method intentionally does not mutate notification records.
   */
  async markConversationNotificationsRead(_userId: string, _conversationId: string) {
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
    const normalized = normalizeType(type);
    const master = MASTER_PREFERENCE_KEY[normalized];
    const granular = GRANULAR_PREFERENCE_KEY[normalized];
    if (!master && !granular) return true;

    const prefs = await prisma.notificationPreferences.findUnique({
      where: { userId },
    });

    // No stored preferences -> respect defaults (enabled)
    if (!prefs) return true;

    // The master channel and the granular category must both be enabled.
    const masterAllowed = DEFAULT_PREFERENCES[master] === true ? prefs[master] !== false : prefs[master] !== false;
    const granularAllowed = granular ? prefs[granular as keyof typeof prefs] !== false : true;
    return masterAllowed && granularAllowed;
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
          select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT },
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

    // OS-level push for offline/background/terminated recipients. Foreground
    // users already received the realtime event above (socket), so the push
    // layer suppresses itself when the user has a live connection.
    try {
      void pushNotificationService.dispatchForCreatedNotification(notification);
    } catch (error: any) {
      console.error("[push] dispatch for created notification failed:", error?.message || error);
    }

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

  /** Invoke only after the content and its attachments are committed. */
  async notifyPublishedMentions(authorId: string, content: string, target: { kind: "post" | "reel"; id: string }) {
    const names = postMentionNames(content);
    if (!names.length) return;
    const [author, recipients] = await Promise.all([
      prisma.user.findUnique({ where: { id: authorId }, select: { username: true } }),
      prisma.user.findMany({ where: { username: { in: names }, status: "ACTIVE", id: { not: authorId } }, select: { id: true } }),
    ]);
    if (!author || !recipients.length) return;
    const ids = recipients.map(user => user.id);
    const [settings, follows, blocks] = await Promise.all([
      prisma.userSettings.findMany({ where: { userId: { in: ids } }, select: { userId: true, mentionPermissions: true } }),
      prisma.follow.findMany({ where: { followerId: authorId, followingId: { in: ids } }, select: { followingId: true } }),
      prisma.blockedUser.findMany({ where: { OR: [{ userId: authorId, targetId: { in: ids } }, { targetId: authorId, userId: { in: ids } }] }, select: { userId: true, targetId: true } }),
    ]);
    const preferences = new Map(settings.map(row => [row.userId, row.mentionPermissions]));
    const following = new Set(follows.map(row => row.followingId));
    const blocked = new Set(blocks.map(row => row.userId === authorId ? row.targetId : row.userId));
    const eligible = recipients.filter(user => !blocked.has(user.id) && canReceiveMention(preferences.get(user.id), following.has(user.id)));
    const results = await Promise.allSettled(eligible.map(user => this.createNotification(user.id, "mention", "You were mentioned",
      `@${author.username} mentioned you in a ${target.kind === "post" ? "post" : "Reel"}`,
      { actorId: authorId, entityType: target.kind, entityId: target.id,
        ...(target.kind === "post" ? { postId: target.id } : { reelId: target.id }),
        referenceKey: `publish-mention:${target.kind}:${target.id}:${user.id}` }
    )));
    if (results.some(result => result.status === "rejected")) console.error("[mentions] one or more published mention deliveries failed", { targetId: target.id });
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

  /**
   * Legacy compatibility shim: message events must never create Notifications.
   * Chat unread counters and push delivery are handled by the Chat subsystem.
   */
  async notifyNewMessage(_receiverId: string, _senderUsername: string, _conversationId: string, _senderId?: string, _messageId?: string) {
    return null;
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

  /**
   * Daily birthday sweep. DOB is only used to notify the account owner;
   * it is never exposed or announced to other users.
   */
  async notifyVerificationGranted(userId: string, badgeType: string) {
    return this.createNotification(
      userId,
      "system",
      "You're verified on VANTA!",
      "Your account has officially been verified. Your verified badge is now visible on your profile.",
      { destination: `/profile/${userId}`, milestone: "verification", badgeType, referenceKey: `verification-granted:${badgeType}:${Date.now()}` }
    );
  }

  async notifyBirthday(userId: string, year: number) {
    return this.createNotification(
      userId,
      "milestone",
      "Happy Birthday!",
      "Today is your special day! Everyone at VANTA wishes you happiness, success, and an amazing year ahead. Enjoy your day!",
      { destination: "/profile", milestone: "birthday", year, referenceKey: `birthday:${year}` }
    );
  }

  /**
   * Annual account anniversary; createNotification's unique referenceKey makes
   * this idempotent even if the scheduled sweep runs multiple times.
   */
  async notifyAnniversary(userId: string, years: number, year: number) {
    const yearLabel = years === 1 ? "1 year" : `${years} years`;
    return this.createNotification(
      userId,
      "milestone",
      "Happy VANTA Anniversary!",
      `You've been part of VANTA for ${yearLabel} today! Thank you for being part of our community. Here's to many more years together.`,
      { destination: "/profile", milestone: "anniversary", years, year, referenceKey: `anniversary:${year}` }
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
