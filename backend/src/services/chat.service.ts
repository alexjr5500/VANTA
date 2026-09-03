import { prisma } from "../prisma";
import { notificationService } from "./notification.service";

const userSelect = {
  id: true, username: true, fullName: true, avatar: true, verified: true,
  userPresence: { select: { isOnline: true, lastActive: true } },
} as const;

export type AttachmentInput = { fileId?: string; url?: string; fileType?: string; fileName?: string; fileSize?: number };

function cleanContent(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, 10000);
}

function conversationPermissions(value: string | null | undefined): Record<string, boolean> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Shared include shape so call-history (and any future system) messages match
// the exact payload shape the chat socket/client expects for a normal message.
const messageInclude = {
  sender: { select: userSelect },
  reads: true,
  attachments: true,
  reactions: { include: { user: { select: { id: true, username: true } } } },
  replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } },
} as const;

const formatCallDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

// Both callers POST the terminal call-log at roughly the same instant. The
// short-lived in-memory map collapses the duplicate into a single message.
const recentCallLogs = new Map<string, { at: number; messageId: string }>();
const CALL_LOG_WINDOW_MS = 2 * 60 * 1000;

export class ChatService {
  async getConversations(userId: string, limit: number = 25, cursor?: string) {
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          some: { userId },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                ...userSelect,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                avatar: true,
              },
            },
            reads: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
       take: Math.min(Math.max(limit, 1), 50) + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = conversations.length > Math.min(Math.max(limit, 1), 50);
    const page = hasMore ? conversations.slice(0, -1) : conversations;
    const conversationIds = page.map((conversation: any) => conversation.id);
    const [groups, channels] = await Promise.all([
      prisma.group.findMany({ where: { conversationId: { in: conversationIds } }, select: { id: true, conversationId: true } }),
      prisma.channel.findMany({ where: { conversationId: { in: conversationIds } }, select: { id: true, conversationId: true } }),
    ]);
    const groupByConversation = new Map(groups.map(group => [group.conversationId, group.id]));
    const channelByConversation = new Map(channels.map(channel => [channel.conversationId, channel.id]));
    const enriched = await Promise.all(
      page.map(async (conversation: any) => {
        // Presence is a private-1:1 concept. Groups and channels must NOT expose a
        // single "partner" whose online state would make the whole row look online.
        const type = conversation.type || (conversation.isGroup ? "GROUP" : "DIRECT");
        const partner = type === "DIRECT"
          ? conversation.participants.find((p: any) => p.userId !== userId)?.user
          : undefined;
        const participants = conversation.participants.map((p: any) => ({ ...p.user, role: p.role }));
        const onlineMemberCount = type === "GROUP"
          ? participants.filter((p: any) => p.userPresence?.isOnline).length
          : undefined;
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: userId },
            reads: { none: { userId } },
          },
        });

        return {
          id: conversation.id,
          type,
          isGroup: conversation.isGroup,
          name: conversation.name,
          avatar: conversation.avatar,
          description: conversation.description,
          handle: conversation.handle,
          visibility: conversation.visibility,
          entityId: type === "GROUP"
            ? groupByConversation.get(conversation.id)
            : type === "CHANNEL"
              ? channelByConversation.get(conversation.id)
              : undefined,
          currentRole: conversation.participants.find((p: any) => p.userId === userId)?.role || "MEMBER",
          mutedAt: conversation.participants.find((p: any) => p.userId === userId)?.mutedAt || null,
          memberCount: conversation.participants.length,
          onlineMemberCount,
          partner,
          lastMessage: conversation.messages[0] || null,
          unreadCount,
          participants,
          updatedAt: conversation.updatedAt,
        };
      })
    );

    return { conversations: enriched, nextCursor: hasMore ? page[page.length - 1]?.id : null };
  }

  async getMessages(conversationId: string, userId: string, limit: number = 50, cursor?: string) {
    const conversation: any = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: true,
      },
    });

    if (!conversation || !conversation.participants.some((p: any) => p.userId === userId)) {
      throw new Error("Conversation not found or unauthorized");
    }

    const pageSize = Math.min(Math.max(limit, 1), 100);
    const messages = await prisma.message.findMany({
      where: { conversationId },
      include: {
        sender: {
          select: userSelect,
        },
        reads: true,
        attachments: true,
        reactions: { include: { user: { select: { id: true, username: true } } } },
        replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    const hasMore = messages.length > pageSize;
    const page = hasMore ? messages.slice(0, -1) : messages;
    const nextCursor = hasMore ? page[page.length - 1]?.id : null;
    return { messages: page.reverse(), nextCursor };
  }

  async sendMessage(conversationId: string, senderId: string, content: string, type = "TEXT", attachments: AttachmentInput[] = [], replyToId?: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { select: { userId: true, role: true } } },
    });

    const participant = conversation?.participants.find((p: any) => p.userId === senderId);
    if (!conversation || !participant) {
      throw new Error("Conversation not found or unauthorized");
    }
    if (conversation.type === "CHANNEL" && !["OWNER", "ADMIN", "MODERATOR"].includes(participant.role)) {
      throw new Error("Only channel administrators can publish posts");
    }

    const safeContent = cleanContent(content);
    const permissions = conversationPermissions(conversation.permissions);
    const isAdministrator = ["OWNER", "ADMIN", "MODERATOR"].includes(participant.role);
    if (conversation.type === "GROUP" && !isAdministrator) {
      if (permissions.sendMessages === false) throw new Error("Members cannot send messages in this group");
      if (attachments.length > 0 && permissions.sendMedia === false) throw new Error("Members cannot send media in this group");
      if (/\b(?:https?:\/\/|www\.)\S+/i.test(safeContent) && permissions.sendLinks === false) throw new Error("Members cannot send links in this group");
    }
    const requestedFileIds = [...new Set(attachments.slice(0, 10).map(item => item?.fileId).filter((id): id is string => typeof id === "string" && id.length > 0))];
    const uploadedFiles = requestedFileIds.length ? await prisma.uploadedFile.findMany({
      where: { id: { in: requestedFileIds }, userId: senderId, category: "message", recordType: "Conversation", recordId: conversationId, deletedAt: null },
    }) : [];
    if (uploadedFiles.length !== requestedFileIds.length) throw new Error("One or more attachments are invalid or unauthorized");
    const fileById = new Map(uploadedFiles.map(file => [file.id, file]));
    const safeAttachments = attachments.slice(0, 10).map(input => {
      const file = input.fileId ? fileById.get(input.fileId) : undefined;
      return file ? { fileId: file.id, url: file.url, fileType: file.fileType, fileName: file.originalName, fileSize: file.size } : null;
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!safeContent && safeAttachments.length === 0) throw new Error("Message content or attachment is required");
    if (replyToId) {
      const replyTarget = await prisma.message.findFirst({ where: { id: replyToId, conversationId }, select: { id: true } });
      if (!replyTarget) throw new Error("Reply target not found");
    }
    const allowedTypes = new Set(["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE"]);
    const message = await prisma.$transaction(async tx => {
      const created = await tx.message.create({ data: {
        conversationId,
        senderId,
        content: safeContent,
        type: allowedTypes.has(type) ? type : "TEXT",
        replyToId,
        attachments: { create: safeAttachments.map(a => ({
          url: a.url, fileType: String(a.fileType || "FILE").slice(0, 100),
          fileName: a.fileName?.slice(0, 255), fileSize: a.fileSize,
        })) },
      },
      include: {
        sender: {
          select: userSelect,
        },
        reads: true,
        attachments: true,
        reactions: { include: { user: { select: { id: true, username: true } } } },
        replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } },
      } });
      if (safeAttachments.length) await tx.uploadedFile.updateMany({
        where: { id: { in: safeAttachments.map(item => item.fileId) }, userId: senderId },
        data: { recordType: "Message", recordId: created.id },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return created;
    });
    return message;
  }

  async editMessage(messageId: string, userId: string, content: string) {
    const message: any = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { participants: true } } } });
    if (!message || message.senderId !== userId || message.deletedAt) throw new Error("Message not found or unauthorized");
    const safeContent = cleanContent(content);
    if (!safeContent) throw new Error("Message content is required");
    return prisma.message.update({ where: { id: messageId }, data: { content: safeContent, editedAt: new Date() }, include: { sender: { select: userSelect }, reads: true, attachments: true, reactions: { include: { user: { select: { id: true, username: true } } } }, replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } } } });
  }

  async deleteMessage(messageId: string, userId: string, everyone = false) {
    const message = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { participants: true } } } });
    const participant = message?.conversation.participants.find((p: any) => p.userId === userId);
    const canModerate = ["OWNER", "ADMIN", "MODERATOR"].includes(participant?.role);
    if (!message || (!canModerate && message.senderId !== userId) || (everyone && !canModerate && message.senderId !== userId)) throw new Error("Message not found or unauthorized");
    return prisma.message.update({ where: { id: messageId }, data: { content: "", deletedAt: new Date() }, include: { sender: { select: userSelect }, reads: true, attachments: true, reactions: { include: { user: { select: { id: true, username: true } } } }, replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } } } });
  }

  async reactToMessage(messageId: string, userId: string, reaction: string) {
    const allowed = new Set(["❤️", "😂", "🔥", "👏", "👍"]);
    if (!allowed.has(reaction)) throw new Error("Unsupported reaction");
    const message = await prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true } });
    if (!message || !(await this.isParticipant(message.conversationId, userId))) throw new Error("Message not found or unauthorized");
    const existing = await prisma.messageReaction.findUnique({ where: { messageId_userId: { messageId, userId } } });
    if (existing?.reaction === reaction) await prisma.messageReaction.delete({ where: { id: existing.id } });
    else await prisma.messageReaction.upsert({ where: { messageId_userId: { messageId, userId } }, update: { reaction }, create: { messageId, userId, reaction } });
    return prisma.message.findUnique({ where: { id: messageId }, include: { sender: { select: userSelect }, reads: true, attachments: true, reactions: { include: { user: { select: { id: true, username: true } } } }, replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } } } });
  }

  async setMessagePinned(messageId: string, userId: string, pinned: boolean) {
    const message = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { participants: true } } } });
    const participant = message?.conversation.participants.find(p => p.userId === userId);
    if (!message || !participant) throw new Error("Message not found or unauthorized");
    const isAdministrator = ["OWNER", "ADMIN", "MODERATOR"].includes(participant.role);
    const permissions = conversationPermissions(message.conversation.permissions);
    if (message.conversation.type === "CHANNEL" && !isAdministrator) throw new Error("Only channel administrators can pin messages");
    if (message.conversation.type === "GROUP" && !isAdministrator && permissions.pinMessages !== true) throw new Error("You do not have permission to pin messages");
    return prisma.message.update({ where: { id: messageId }, data: { pinnedAt: pinned ? new Date() : null, pinnedById: pinned ? userId : null }, include: { sender: { select: userSelect }, reads: true, attachments: true, reactions: { include: { user: { select: { id: true, username: true } } } }, replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } } } });
  }

  async setConversationMuted(conversationId: string, userId: string, muted: boolean) {
    const participant = await prisma.participant.findUnique({ where: { userId_conversationId: { userId, conversationId } } });
    if (!participant) throw new Error("Conversation not found or unauthorized");
    return prisma.participant.update({ where: { id: participant.id }, data: { mutedAt: muted ? new Date() : null }, select: { conversationId: true, mutedAt: true } });
  }

  async isParticipant(conversationId: string, userId: string) {
    return Boolean(await prisma.participant.findUnique({ where: { userId_conversationId: { userId, conversationId } } }));
  }

  /**
   * Persists a call status/history line (e.g. "Voice call · 3:05") into the
   * conversation. Private 1-to-1 chats only; calling is intentionally not
   * available for groups or channels. The message sender is always the call
   * initiator so the log does not depend on which side ended the call.
   */
  async createCallMessage(
    conversationId: string,
    actorUserId: string,
    input: { callId?: string; callType?: string; status?: string; durationSeconds?: number; callerId?: string }
  ) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { select: { userId: true } } },
    });
    if (!conversation || !conversation.participants.some(p => p.userId === actorUserId)) {
      throw new Error("Conversation not found or unauthorized");
    }
    if (conversation.type === "GROUP" || conversation.type === "CHANNEL" || conversation.isGroup) {
      throw new Error("Calls are only available in private conversations");
    }

    const participantIds = conversation.participants.map(p => p.userId);
    const callerId = input.callerId && participantIds.includes(input.callerId)
      ? input.callerId
      : participantIds.find(id => id !== actorUserId) || actorUserId;

    const callType = input.callType === "VIDEO" ? "VIDEO" : "VOICE";
    const typeLabel = callType === "VIDEO" ? "Video call" : "Voice call";
    const status = ["MISSED", "DECLINED", "ENDED", "CANCELLED"].includes(String(input.status || ""))
      ? String(input.status)
      : "ENDED";
    const rawDuration = Math.max(0, Math.floor(Number(input.durationSeconds) || 0));

    let content = typeLabel;
    if (status === "DECLINED") content = `${typeLabel} · Declined`;
    else if (status === "MISSED") content = `${typeLabel} · Missed`;
    else if (status === "CANCELLED") content = `${typeLabel} · Cancelled`;
    else content = rawDuration > 0 ? `${typeLabel} · ${formatCallDuration(rawDuration)}` : `${typeLabel} · Ended`;

    const callKey = [conversationId, input.callId].filter(Boolean).join(":");
    const cached = callKey ? recentCallLogs.get(callKey) : undefined;
    if (cached && Date.now() - cached.at < CALL_LOG_WINDOW_MS) {
      const existing = cached.messageId ? await prisma.message.findUnique({ where: { id: cached.messageId } }) : null;
      if (existing) return this.getMessageRecord(existing.id);
    }

    const duplicate = await prisma.message.findFirst({
      where: {
        conversationId,
        type: "CALL",
        senderId: callerId,
        content,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (duplicate) return this.getMessageRecord(duplicate.id);

    const created = await prisma.message.create({
      data: { conversationId, senderId: callerId, content, type: "CALL" },
      select: { id: true },
    });
    if (callKey) {
      recentCallLogs.set(callKey, { at: Date.now(), messageId: created.id });
      setTimeout(() => recentCallLogs.delete(callKey), CALL_LOG_WINDOW_MS).unref?.();
    }
    return this.getMessageRecord(created.id);
  }

  private getMessageRecord(messageId: string) {
    return prisma.message.findUnique({ where: { id: messageId }, include: messageInclude });
  }

  async getParticipantIds(conversationId: string) {
    return (await prisma.participant.findMany({ where: { conversationId }, select: { userId: true } })).map(p => p.userId);
  }

  /**
   * Creates one "New Message" notification per recipient of a freshly sent
   * message. This is what drives the Notifications unread badge in realtime
   * (via notificationService emits) while the chat unread count drives the
   * Chat badge. Idempotent per message id through the notification referenceKey.
   */
  async dispatchRecipientNotifications(message: any) {
    const conversationId = message?.conversationId;
    const senderId = message?.senderId;
    const messageId = message?.id;
    if (!conversationId || !senderId || !messageId) return;

    try {
      const participants = await prisma.participant.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      const senderUsername = message?.sender?.username || "Someone";
      await Promise.all(participants
        .filter(participant => participant.userId !== senderId)
        .map(participant =>
          notificationService
            .notifyNewMessage(participant.userId, senderUsername, conversationId, senderId, messageId)
            .catch((error: any) => console.error(`[chat] notification failed for ${participant.userId}:`, error?.message || error))
        ));
    } catch (error: any) {
      console.error("[chat] dispatchRecipientNotifications failed:", error?.message || error);
    }
  }

  async getUnreadCount(userId: string) {
    return prisma.message.count({
      where: { senderId: { not: userId }, conversation: { participants: { some: { userId } } }, reads: { none: { userId } } },
    });
  }

  async markMessagesAsRead(conversationId: string, userId: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { include: { user: { select: userSelect } } } },
    });

    if (!conversation || !conversation.participants.some((p: any) => p.userId === userId)) {
      throw new Error("Conversation not found or unauthorized");
    }

    const unreadMessages = await prisma.message.findMany({
      where: {
        conversationId,
        senderId: { not: userId },
        reads: { none: { userId } },
      },
      select: { id: true },
    });

    const records = unreadMessages.map((message) => ({ messageId: message.id, userId }));
    if (records.length) {
      await prisma.messageRead.createMany({ data: records });
    }

    return { count: records.length };
  }

  async searchMessages(conversationId: string, userId: string, query: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { select: { userId: true, role: true } } },
    });

    if (!conversation || !conversation.participants.some((p: any) => p.userId === userId)) {
      throw new Error("Conversation not found or unauthorized");
    }

    const safeQuery = cleanContent(query).slice(0, 200);
    if (!safeQuery) return [];
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        content: {
          contains: safeQuery,
        },
      },
      include: {
        sender: {
          select: { id: true, username: true, avatar: true },
        },
        reads: true,
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    return messages;
  }

  async createConversation(userIds: string[], name?: string, isGroup: boolean = false, options?: { type?: "DIRECT" | "GROUP" | "CHANNEL"; avatar?: string; description?: string; handle?: string; visibility?: string; createdById?: string }) {
    const uniqueUserIds = [...new Set(userIds)];

    if (uniqueUserIds.length > 100) throw new Error("A conversation cannot have more than 100 participants");

    if (uniqueUserIds.length < 2 && !isGroup) {
      throw new Error("At least two users are required to start a conversation");
    }
    const activeUsers = await prisma.user.count({ where: { id: { in: uniqueUserIds }, status: "ACTIVE" } });
    if (activeUsers !== uniqueUserIds.length) throw new Error("One or more participants do not exist");

    const type = options?.type || (isGroup ? "GROUP" : "DIRECT");
    const existing = type === "DIRECT" ? await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        participants: {
          every: {
            userId: { in: uniqueUserIds },
          },
        },
      },
      include: { participants: { include: { user: { select: userSelect } } } },
    }) : null;

    if (existing && existing.participants.length === uniqueUserIds.length) {
      return existing;
    }

    const conversation = await prisma.conversation.create({
      data: {
        isGroup: type !== "DIRECT",
        type,
        name,
        avatar: options?.avatar,
        description: options?.description,
        handle: options?.handle,
        visibility: options?.visibility || (type === "DIRECT" ? "PRIVATE" : "PUBLIC"),
        createdById: options?.createdById,
        participants: {
          create: uniqueUserIds.map((userId) => ({ userId, role: userId === options?.createdById ? "OWNER" : "MEMBER" })),
        },
      },
      include: {
        participants: { include: { user: { select: userSelect } } },
      },
    });

    return conversation;
  }
}

export const chatService = new ChatService();
