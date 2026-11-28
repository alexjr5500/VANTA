import { retentionCutoff, visibleMessageWhere, messageIsVisible, removeHiddenReply } from "./chat-retention";
import { prisma } from "../prisma";
import { assertChatContactApproved } from "./chat-contact.service";
import { notificationService } from "./notification.service";
import { BADGE_USER_SELECT, enrichPublicUser } from "./public-verification";
import { createPrivateMediaUrl } from "./private-media.service";
import { COMMUNITY_REACTIONS, allowedCommunityReactions, memberWelcome } from "./community-settings";

const userSelect = {
  id: true, username: true, fullName: true, avatar: true, verified: true,
  // Presence is delivered only by the dedicated presence/profile endpoints,
  // where the owner's onlineStatus and lastSeen preferences can be applied.
  ...BADGE_USER_SELECT,
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

/**
 * Enforce the recipient's "who can message me" privacy rule for direct
 * messages. This runs server-side on every DM start and send so an alternate
 * or malicious client cannot bypass the account's messaging preference.
 */
export async function assertDirectMessageAllowed(senderId: string, recipientId: string): Promise<void> {
  if (senderId === recipientId) return;

  // Blocked accounts can never message or be messaged.
  const blocked = await prisma.blockedUser.findFirst({
    where: {
      OR: [
        { userId: senderId, targetId: recipientId },
        { userId: recipientId, targetId: senderId },
      ],
    },
    select: { id: true },
  });
  if (blocked) {
    throw new Error("Messaging with this account is not allowed");
  }

  const recipientSettings = await prisma.userSettings.findUnique({
    where: { userId: recipientId },
    select: { privacyMessages: true },
  });
  const privacyMessages = recipientSettings?.privacyMessages || "everyone";
  if (privacyMessages === "noone") {
    throw new Error("This account is not accepting messages");
  }
  if (privacyMessages === "following") {
    // Legacy setting: only accounts the recipient follows may message them.
    const recipientFollowsSender = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: recipientId,
          followingId: senderId,
        },
      },
      select: { id: true },
    });
    if (!recipientFollowsSender) {
      throw new Error("This account only accepts messages from accounts it follows");
    }
  }
  if (privacyMessages === "followers") {
    // Privacy Center setting: only the recipient's followers may message them.
    const senderFollowsRecipient = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: senderId,
          followingId: recipientId,
        },
      },
      select: { id: true },
    });
    if (!senderFollowsRecipient) {
      throw new Error("This account only accepts messages from its followers");
    }
  }
}

/**
 * Hides read-receipt entries whose owner disabled read receipts. The viewer
 * always keeps their own read entries so their local read/unread state stays
 * accurate; senders never see a "Seen" state for a reader who opted out.
 */
async function sanitizeReadReceipts<T extends { reads?: { userId: string }[]; senderId?: string }>(
  items: T[],
  viewerId?: string
): Promise<T[]> {
  const readerIds = [...new Set(items.flatMap(item => (item.reads || []).map(read => read.userId)))];
  if (!readerIds.length) return items;
  const preferences = await prisma.userSettings.findMany({
    where: { userId: { in: readerIds } },
    select: { userId: true, readReceipts: true, privacyReadReceipts: true },
  });
  const byReader = new Map(preferences.map(pref => [pref.userId, pref]));
  const followerChecks = items.flatMap(item => (item.reads || []).flatMap(read => {
    const pref = byReader.get(read.userId);
    const mode = String(pref?.privacyReadReceipts || "everyone").toLowerCase();
    return viewerId && item.senderId === viewerId && read.userId !== viewerId &&
      pref?.readReceipts !== false && (mode === "followers" || mode === "following")
      // The sender/viewer must follow the reader who owns this preference.
      ? [{ followerId: viewerId, followingId: read.userId }]
      : [];
  }));
  const uniqueChecks = [...new Map(followerChecks.map(check => [
    check.followerId + ":" + check.followingId, check,
  ])).values()];
  const allowedFollows = uniqueChecks.length
    ? await prisma.follow.findMany({
        where: { OR: uniqueChecks },
        select: { followerId: true, followingId: true },
      })
    : [];
  const allowedFollowKeys = new Set(allowedFollows.map(follow => follow.followerId + ":" + follow.followingId));

  return items.map(item => ({
    ...item,
    reads: (item.reads || []).filter(read => {
      if (read.userId === viewerId) return true;
      // A receipt is private to the message sender, never to every chat member.
      if (!viewerId || item.senderId !== viewerId) return false;
      const pref = byReader.get(read.userId);
      if (pref?.readReceipts === false) return false;
      const mode = String(pref?.privacyReadReceipts || "everyone").toLowerCase();
      if (mode === "nobody" || mode === "noone" || mode === "none") return false;
      if (mode === "followers" || mode === "following") {
        return allowedFollowKeys.has(viewerId + ":" + read.userId);
      }
      return true;
    }),
  }));
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

/** Enrich message sender(s) with public verification info (badge type). */
const formatMessage = (message: any): any => {
  if (!message || typeof message !== "object") return message;
  const out = { ...message };
  if (out.sender) out.sender = enrichPublicUser(out.sender);
  if (out.replyTo && out.replyTo.sender) {
    out.replyTo = { ...out.replyTo, sender: enrichPublicUser(out.replyTo.sender) };
  }
  return out;
};


function protectMessageMedia(message: any, files: Array<{ id: string; url: string }>, userId: string): any {
  const formatted = formatMessage(message);
  const byUrl = new Map(files.map(file => [file.url, file]));
  const protect = (attachments: any) => Array.isArray(attachments) ? attachments.map((attachment: any) => {
    const file = byUrl.get(attachment.url);
    return file ? { ...attachment, url: createPrivateMediaUrl(file.id, userId) } : attachment;
  }) : (attachments || []);
  formatted.attachments = protect(formatted.attachments);
  if (formatted.replyTo) formatted.replyTo = { ...formatted.replyTo, attachments: protect(formatted.replyTo.attachments) };
  return formatted;
}

async function protectPersistedMessage(message: any, userId: string, cutoff?: Date): Promise<any> {
  if (message?.replyTo && !messageIsVisible(message.replyTo, userId, cutoff)) message = { ...message, replyTo: null };
  const recordIds = [message?.id, message?.replyTo?.id].filter((id): id is string => typeof id === "string" && id.length > 0);
  const attachmentUrls = [
    ...(Array.isArray(message?.attachments) ? message.attachments : []),
    ...(Array.isArray(message?.replyTo?.attachments) ? message.replyTo.attachments : []),
  ].map((attachment: any) => attachment?.url).filter((url: unknown): url is string => typeof url === "string" && url.length > 0);
  if (!recordIds.length || !attachmentUrls.length) return protectMessageMedia(message, [], userId);

  const files = await prisma.uploadedFile.findMany({
    where: {
      recordType: "Message",
      recordId: { in: recordIds },
      url: { in: [...new Set(attachmentUrls)] },
      deletedAt: null,
    },
    select: { id: true, url: true },
  });
  return protectMessageMedia(message, files, userId);
}

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
                userPresence: { select: { isOnline: true, lastActive: true } },
                userSettings: { select: { onlineStatus: true, lastSeen: true } },
              },
            },
          },
        },
        messages: {
          where: visibleMessageWhere(userId),
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
        const participants = conversation.participants.map((p: any) => {
          const publicUser = { ...p.user };
          delete publicUser.userPresence;
          delete publicUser.userSettings;
          return {
            ...enrichPublicUser(publicUser),
            role: p.role,
          };
        });
        let visiblePartner: any = partner;
        if (partner) {
          const onlineVisibility = String(partner.userSettings?.onlineStatus || "everyone").toLowerCase();
          const lastSeenVisibility = String(partner.userSettings?.lastSeen || "everyone").toLowerCase();
          const needsFollowerCheck = ["followers", "following"].includes(onlineVisibility) ||
            ["followers", "following"].includes(lastSeenVisibility);
          const viewerFollowsPartner = needsFollowerCheck
            ? Boolean(await prisma.follow.findFirst({
                where: { followerId: userId, followingId: partner.id },
                select: { followerId: true },
              }))
            : false;
          const canSeeOnline = !["nobody", "noone", "none"].includes(onlineVisibility) &&
            (!needsFollowerCheck || viewerFollowsPartner || !["followers", "following"].includes(onlineVisibility));
          const canSeeLastSeen = !["nobody", "noone", "none"].includes(lastSeenVisibility) &&
            (!["followers", "following"].includes(lastSeenVisibility) || viewerFollowsPartner);
          const { userPresence, userSettings, ...publicPartner } = partner;
          visiblePartner = {
            ...enrichPublicUser(publicPartner),
            userPresence: {
              isOnline: canSeeOnline ? Boolean(userPresence?.isOnline) : false,
              ...(canSeeLastSeen && userPresence?.lastActive ? { lastActive: userPresence.lastActive } : {}),
            },
            isOnline: canSeeOnline ? Boolean(userPresence?.isOnline) : false,
            ...(canSeeLastSeen && userPresence?.lastActive ? { lastActive: userPresence.lastActive } : {}),
          };
        }
        const cutoff = retentionCutoff(conversation.permissions);
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conversation.id,
            ...visibleMessageWhere(userId, cutoff),
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
          partner: visiblePartner,
          lastMessage: messageIsVisible(conversation.messages[0], userId, cutoff) ? conversation.messages[0] : null,
          unreadCount,
          participants,
          updatedAt: conversation.updatedAt,
        };
      })
    );

    // Senders must not see a preview read state from participants who disabled
    // read receipts.
    await Promise.all(enriched.map(async conversation => {
      conversation.lastMessage = (await sanitizeReadReceipts(conversation.lastMessage ? [conversation.lastMessage] : [], userId))[0] || null;
    }));

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
    const cutoff = retentionCutoff(conversation.permissions);
    const messages = await prisma.message.findMany({
      // Soft-deleted messages are wiped from the conversation entirely — the
      // product treats "delete for everyone" as a hard removal, so we never
      // return deleted rows (no placeholders survive a refresh or a reload on
      // any device).
      where: { conversationId, ...visibleMessageWhere(userId, cutoff) },
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
    let page = hasMore ? messages.slice(0, -1) : messages;
    const nextCursor = hasMore ? page[page.length - 1]?.id : null;
    // Remove read-receipt entries from participants who disabled read receipts.
    page = await sanitizeReadReceipts(page.map(message => removeHiddenReply(message, userId, cutoff)), userId);
    const messageIds = [...new Set(page.flatMap((message: any) => [message.id, message.replyTo?.id].filter(Boolean)))];
    const privateFiles = messageIds.length ? await prisma.uploadedFile.findMany({
      where: { category: 'message', recordType: 'Message', recordId: { in: messageIds }, deletedAt: null },
      select: { id: true, url: true },
    }) : [];
    const isCommunity = conversation.type === "GROUP" || conversation.type === "CHANNEL";
    return {
      messages: page.reverse().map((message: any) => protectMessageMedia(message, privateFiles, userId)),
      nextCursor,
      ...(isCommunity ? {
        allowedReactions: allowedCommunityReactions(conversation.permissions),
        welcome: memberWelcome(conversation.permissions, conversation.participants.find((p: any) => p.userId === userId)),
      } : {}),
    };
  }

  async sendMessage(conversationId: string, senderId: string, content: string, type = "TEXT", attachments: AttachmentInput[] = [], replyToId?: string, storyReply?: { storyId?: string; mediaUrl?: string; caption?: string; author?: string }) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { select: { userId: true, role: true } } },
    });

    const participant = conversation?.participants.find((p: any) => p.userId === senderId);
    if (!conversation || !participant) {
      throw new Error("Conversation not found or unauthorized");
    }
    // Enforce the recipient's messaging privacy for private 1-to-1 chats.
    // Group and channel messages are governed by their own membership rules.
    if (!conversation.isGroup && conversation.type !== "GROUP" && conversation.type !== "CHANNEL") {
      const peerId = conversation.participants.find((p: any) => p.userId !== senderId)?.userId;
      if (peerId) {
        await assertDirectMessageAllowed(senderId, peerId);
        await assertChatContactApproved(senderId, peerId, conversationId);
      }
    }
    if (conversation.type === "CHANNEL") {
      const permissions = conversationPermissions(conversation.permissions);
      // Default: only channel administrators can publish. When the owner enables
      // the "Post messages" permission, any member may post.
      const memberCanPost = permissions.postMessages === true;
      if (!memberCanPost && !["OWNER", "ADMIN", "MODERATOR"].includes(participant.role)) {
        throw new Error("Only channel administrators can publish posts");
      }
    }

    let safeContent = cleanContent(content);
    if (type === "POLL") {
      let poll: any;
      try { poll = JSON.parse(safeContent); } catch { throw new Error("Poll data is invalid"); }
      if (!poll || typeof poll.question !== "string" || !poll.question.trim() || poll.question.length > 200 ||
          !Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 10 ||
          poll.options.some((option: unknown) => typeof option !== "string" || !option.trim() || option.length > 100)) {
        throw new Error("A poll needs a question and 2 to 10 valid options");
      }
      poll.votes = [];
      poll.allowMultiple = poll.allowMultiple === true;
      // Persist a normalized poll payload; never trust client-supplied vote totals.
      safeContent = JSON.stringify(poll);
    }
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
      const replyTarget = await prisma.message.findFirst({ where: { id: replyToId, conversationId, ...visibleMessageWhere(senderId, retentionCutoff(conversation.permissions)) }, select: { id: true } });
      if (!replyTarget) throw new Error("Reply target not found");
    }
    const allowedTypes = new Set(["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE", "STORY_REPLY", "CONTACT", "LOCATION", "WALLET", "POLL"]);
    // Story replies are private direct messages about a specific Story. The
    // client passes snapshot metadata so the reference survives Story expiry.
    const storyReplyRef = storyReply && typeof storyReply.storyId === "string" && storyReply.storyId.length > 0
      ? {
          storyReplyStoryId: storyReply.storyId.slice(0, 200),
          storyReplyMediaUrl: typeof storyReply.mediaUrl === "string" ? storyReply.mediaUrl.slice(0, 2000) : null,
          storyReplyCaption: typeof storyReply.caption === "string" ? storyReply.caption.slice(0, 5000) : null,
          storyReplyAuthor: typeof storyReply.author === "string" ? storyReply.author.slice(0, 200) : null,
        }
      : null;
    const message = await prisma.$transaction(async tx => {
      const created = await tx.message.create({ data: {
        conversationId,
        senderId,
        content: safeContent,
        type: storyReplyRef ? "STORY_REPLY" : (allowedTypes.has(type) ? type : "TEXT"),
        replyToId,
        ...(storyReplyRef || {}),
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
      if (safeAttachments.length) {
        const ids = [...new Set(safeAttachments.map(item => item.fileId))];
        const bound = await tx.uploadedFile.updateMany({
          where: { id: { in: ids }, userId: senderId, category: "message", recordType: "Conversation", recordId: conversationId, deletedAt: null },
          data: { recordType: "Message", recordId: created.id },
        });
        if (bound.count !== ids.length) throw new Error("Attachment already used or no longer available");
      }
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return created;
    });
    return protectMessageMedia(removeHiddenReply(message, senderId, retentionCutoff(conversation.permissions)), uploadedFiles, senderId);
  }

  async voteOnPoll(messageId: string, userId: string, optionIndex: number) {
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 9) {
      throw new Error("Invalid poll option");
    }
    // Optimistic compare-and-swap prevents simultaneous votes from overwriting
    // each other while keeping poll data compatible with the existing Message model.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const message = await prisma.message.findFirst({
        where: { id: messageId, type: "POLL", deletedAt: null, moderationRemovedAt: null },
        include: { conversation: { include: { participants: { select: { userId: true } } } } },
      });
      if (!message || !messageIsVisible(message, userId, retentionCutoff(message.conversation.permissions)) || !message.conversation.participants.some((participant: any) => participant.userId === userId)) {
        throw new Error("Poll not found or unauthorized");
      }
      let payload: any;
      try { payload = JSON.parse(message.content); } catch { throw new Error("Poll data is invalid"); }
      if (!payload || typeof payload.question !== "string" || !Array.isArray(payload.options) ||
          payload.options.length < 2 || payload.options.length > 10 || optionIndex >= payload.options.length) {
        throw new Error("Poll option not found");
      }
      const votes = Array.isArray(payload.votes) ? payload.votes.filter((vote: any) =>
        vote && typeof vote.userId === "string" && Number.isInteger(vote.optionIndex) &&
        vote.optionIndex >= 0 && vote.optionIndex < payload.options.length
      ) : [];
      if (payload.allowMultiple === true) {
        const alreadySelected = votes.some((vote: any) => vote.userId === userId && vote.optionIndex === optionIndex);
        payload.votes = alreadySelected
          ? votes.filter((vote: any) => !(vote.userId === userId && vote.optionIndex === optionIndex))
          : [...votes, { userId, optionIndex }];
      } else {
        const previousVote = votes.find((vote: any) => vote.userId === userId);
        payload.votes = previousVote?.optionIndex === optionIndex
          ? votes
          : [...votes.filter((vote: any) => vote.userId !== userId), { userId, optionIndex }];
      }
      const updated = await prisma.message.updateMany({
        where: { id: message.id, content: message.content, type: "POLL" },
        data: { content: JSON.stringify(payload) },
      });
      if (updated.count === 1) {
        await prisma.conversation.update({ where: { id: message.conversationId }, data: { updatedAt: new Date() } });
        return prisma.message.findUnique({
          where: { id: message.id },
          include: {
            sender: { select: userSelect }, reads: true, attachments: true,
            reactions: { include: { user: { select: { id: true, username: true } } } },
          },
        });
      }
    }
    throw new Error("Poll vote could not be saved. Please try again.");
  }

  async editMessage(messageId: string, userId: string, content: string) {
    const message: any = await prisma.message.findUnique({ where: { id: messageId, moderationRemovedAt: null }, include: { conversation: { include: { participants: true } } } });
    if (!message || !messageIsVisible(message, userId, retentionCutoff(message.conversation.permissions))) throw new Error("Message not found or unauthorized");
    const participant = message.conversation.participants.find((p: any) => p.userId === userId);
    // A sender who has been removed from the conversation no longer has
    // permission to mutate messages in that private space.
    if (!participant) throw new Error("Message not found or unauthorized");
    const permissions = conversationPermissions(message.conversation.permissions);
    // Channel "Edit messages" permission lets administrators edit any message;
    // otherwise users may only edit their own messages.
    const canModerateEdit = message.conversation.type === "CHANNEL"
      && participant && ["OWNER", "ADMIN", "MODERATOR"].includes(participant.role)
      && permissions.editMessages === true;
    if (message.senderId !== userId && !canModerateEdit) throw new Error("Message not found or unauthorized");
    const safeContent = cleanContent(content);
    if (!safeContent) throw new Error("Message content is required");
    return protectPersistedMessage(await prisma.message.update({ where: { id: messageId, moderationRemovedAt: null }, data: { content: safeContent, editedAt: new Date() }, include: { sender: { select: userSelect }, reads: true, attachments: true, reactions: { include: { user: { select: { id: true, username: true } } } }, replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } } } }), userId, retentionCutoff(message.conversation?.permissions));
  }

  async deleteMessage(messageId: string, userId: string, everyone = false) {
    const message = await prisma.message.findUnique({ where: { id: messageId, moderationRemovedAt: null }, include: { conversation: { include: { participants: true } } } });
    const participant = message?.conversation.participants.find((p: any) => p.userId === userId);
    const isGroupOrChannel = message?.conversation.type === "GROUP" || message?.conversation.type === "CHANNEL";
    const canModerate = Boolean(isGroupOrChannel && participant && ["OWNER", "ADMIN", "MODERATOR"].includes(participant.role));
    const permissions = conversationPermissions(message?.conversation.permissions);
    const isChannel = message?.conversation.type === "CHANNEL";
    const isChannelOwner = isChannel && participant?.role === "OWNER";
    const forceDeleteAllowed = !isChannel || isChannelOwner || permissions.deleteMessages !== false;
    if (!message || !participant) throw new Error("Message not found or unauthorized");

    // Every participant may hide any message from their own view. Removing a
    // message for everyone remains restricted to its sender or an authorized
    // group/channel moderator.
    if (everyone) {
      if (message.senderId !== userId && !canModerate) throw new Error("Message not found or unauthorized");
      if (isChannel && message.senderId !== userId && !forceDeleteAllowed) throw new Error("Message not found or unauthorized");
      return protectPersistedMessage(await prisma.message.update({
        where: { id: messageId, moderationRemovedAt: null },
        data: { content: "", deletedAt: new Date() },
        include: { sender: { select: userSelect }, reads: true, attachments: true, reactions: { include: { user: { select: { id: true, username: true } } } }, replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } } },
      }), userId);
    }

    const deletedFor = userId;
    return protectPersistedMessage(await prisma.message.update({
      where: { id: messageId, moderationRemovedAt: null },
      data: { deletedFor },
      include: { sender: { select: userSelect }, reads: true, attachments: true, reactions: { include: { user: { select: { id: true, username: true } } } }, replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } } },
    }), userId);
  }

  async reactToMessage(messageId: string, userId: string, reaction: string) {
    const allowed = new Set<string>(COMMUNITY_REACTIONS);
    if (!allowed.has(reaction)) throw new Error("Unsupported reaction");
    const message = await prisma.message.findUnique({ where: { id: messageId, moderationRemovedAt: null, deletedAt: null }, select: { conversationId: true, createdAt: true, deletedFor: true, conversation: { select: { type: true, permissions: true } } } });
    if (!message || !messageIsVisible(message, userId, retentionCutoff(message.conversation?.permissions)) || !(await this.isParticipant(message.conversationId, userId))) throw new Error("Message not found or unauthorized");
    const existing = await prisma.messageReaction.findUnique({ where: { messageId_userId: { messageId, userId } } });
    if (existing?.reaction !== reaction && ["GROUP", "CHANNEL"].includes(message.conversation?.type || "") && !allowedCommunityReactions(message.conversation.permissions).includes(reaction)) throw new Error("This reaction is disabled by community settings");
    if (existing?.reaction === reaction) await prisma.messageReaction.delete({ where: { id: existing.id } });
    else await prisma.messageReaction.upsert({ where: { messageId_userId: { messageId, userId } }, update: { reaction }, create: { messageId, userId, reaction } });
    return protectPersistedMessage(await prisma.message.findUnique({ where: { id: messageId, moderationRemovedAt: null }, include: { sender: { select: userSelect }, reads: true, attachments: true, reactions: { include: { user: { select: { id: true, username: true } } } }, replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } } } }), userId, retentionCutoff(message.conversation?.permissions));
  }

  async setMessagePinned(messageId: string, userId: string, pinned: boolean) {
    const message = await prisma.message.findUnique({ where: { id: messageId, moderationRemovedAt: null }, include: { conversation: { include: { participants: true } } } });
    const participant = message?.conversation.participants.find(p => p.userId === userId);
    if (!message || !participant || !messageIsVisible(message, userId, retentionCutoff(message.conversation.permissions))) throw new Error("Message not found or unauthorized");
    const isAdministrator = ["OWNER", "ADMIN", "MODERATOR"].includes(participant.role);
    const permissions = conversationPermissions(message.conversation.permissions);
    if (message.conversation.type === "CHANNEL" && !isAdministrator) throw new Error("Only channel administrators can pin messages");
    if (message.conversation.type === "GROUP" && !isAdministrator && permissions.pinMessages !== true) throw new Error("You do not have permission to pin messages");
    return protectPersistedMessage(await prisma.message.update({ where: { id: messageId, moderationRemovedAt: null }, data: { pinnedAt: pinned ? new Date() : null, pinnedById: pinned ? userId : null }, include: { sender: { select: userSelect }, reads: true, attachments: true, reactions: { include: { user: { select: { id: true, username: true } } } }, replyTo: { include: { sender: { select: { id: true, username: true } }, attachments: true } } } }), userId, retentionCutoff(message.conversation?.permissions));
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
      const existing = cached.messageId ? await prisma.message.findUnique({ where: { id: cached.messageId, moderationRemovedAt: null } }) : null;
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
    return prisma.message.findUnique({ where: { id: messageId, moderationRemovedAt: null }, include: messageInclude });
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
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { type: true, isGroup: true },
      });
      const conversationType = conversation?.type || (conversation?.isGroup ? "GROUP" : "DIRECT");
      // Group/channel messages map to their own notification categories so the
      // granular "Group Messages" / "Channel Updates" toggles are respected.
      const notificationType = conversationType === "GROUP" ? "group" : conversationType === "CHANNEL" ? "channel" : "message";
      const participants = await prisma.participant.findMany({
        where: { conversationId },
        select: { userId: true },
      });
      const senderUsername = message?.sender?.username || "Someone";
      await Promise.all(participants
        .filter(participant => participant.userId !== senderId)
        .map(participant =>
          notificationService
            .createNotification(
              participant.userId,
              notificationType,
              conversationType === "GROUP" || conversationType === "CHANNEL" ? "Group Activity" : "New Message",
              `${senderUsername} sent a message`,
              { actorId: senderId, conversationId, senderUsername, entityType: "conversation", entityId: conversationId, messageId, referenceKey: messageId ? `message:${messageId}` : undefined }
            )
            .catch((error: any) => console.error(`[chat] notification failed for ${participant.userId}:`, error?.message || error))
        ));

      // @mentions in chat must notify only actual conversation participants.
      const mentionedHandles = [...new Set(
        [...String(message.content || "").matchAll(/(?:^|\s)@([a-zA-Z0-9_]{1,30})\b/g)].map(match => match[1].toLowerCase())
      )];
      if (mentionedHandles.length) {
        const mentionedUsers = await prisma.user.findMany({
          where: { id: { in: participants.filter(p => p.userId !== senderId).map(p => p.userId) }, username: { in: mentionedHandles, mode: "insensitive" } },
          select: { id: true, username: true },
        });
        await Promise.all(mentionedUsers.map((mentioned: any) =>
          notificationService.createNotification(
            mentioned.id,
            "mention",
            "You were mentioned",
            `${senderUsername} mentioned you in a message`,
            { actorId: senderId, conversationId, messageId, senderUsername, entityType: "conversation", entityId: conversationId, referenceKey: `mention:${messageId}:${mentioned.id}` }
          ).catch((error: any) => console.error(`[chat] mention notification failed for ${mentioned.id}:`, error?.message || error))
        ));
      }
    } catch (error: any) {
      console.error("[chat] dispatchRecipientNotifications failed:", error?.message || error);
    }
  }

  async getUnreadCount(userId: string) {
    const now = Date.now();
    const retentionChats = await prisma.conversation.findMany({
      where: { participants: { some: { userId } }, permissions: { contains: 'autoDeleteSeconds' } },
      select: { id: true, permissions: true },
    });
    const expired = retentionChats.flatMap(chat => {
      const cutoff = retentionCutoff(chat.permissions, now);
      return cutoff ? [{ conversationId: chat.id, createdAt: { lt: cutoff } }] : [];
    });
    return prisma.message.count({
      where: {
        senderId: { not: userId },
        conversation: { participants: { some: { userId } } },
        ...visibleMessageWhere(userId),
        reads: { none: { userId } },
        ...(expired.length ? { NOT: expired } : {}),
      },
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
        ...visibleMessageWhere(userId, retentionCutoff(conversation.permissions)),
        reads: { none: { userId } },
      },
      select: { id: true },
    });

    const records = unreadMessages.map((message) => ({ messageId: message.id, userId }));
    if (records.length) {
      await prisma.messageRead.createMany({ data: records });
    }

    // When the reading user has disabled read receipts, their read state is
    // tracked locally (unread counts still clear) but is never broadcast to the
    // other participants as a "messages:read" event.
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { readReceipts: true, privacyReadReceipts: true },
    });
    const receiptMode = String(settings?.privacyReadReceipts || "everyone").toLowerCase();
    let receiptsHidden = records.length > 0 && (
      settings?.readReceipts === false ||
      receiptMode === "nobody" || receiptMode === "noone" || receiptMode === "none"
    );
    if (records.length > 0 && !receiptsHidden && (receiptMode === "followers" || receiptMode === "following")) {
      // The socket event is broadcast to the whole conversation. Only emit it
      // when every other participant is within the reader's allowed audience.
      const otherParticipantIds = conversation.participants
        .map((participant: any) => participant.userId)
        .filter((participantId: string) => participantId !== userId);
      if (otherParticipantIds.length) {
        const followed = await prisma.follow.findMany({
          where: { followerId: { in: otherParticipantIds }, followingId: userId },
          select: { followerId: true },
        });
        const followerIds = new Set(followed.map(item => item.followerId));
        receiptsHidden = otherParticipantIds.some(participantId => !followerIds.has(participantId));
      }
    }

    return { count: records.length, receiptsHidden };
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
        ...visibleMessageWhere(userId, retentionCutoff(conversation.permissions)),
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

    return sanitizeReadReceipts(messages, userId);
  }

  async createConversation(userIds: string[], name?: string, isGroup: boolean = false, options?: { type?: "DIRECT" | "GROUP" | "CHANNEL"; avatar?: string; description?: string; handle?: string; visibility?: string; createdById?: string; permissions?: Record<string, unknown> }) {
    const uniqueUserIds = [...new Set(userIds)];

    if (uniqueUserIds.length > 100) throw new Error("A conversation cannot have more than 100 participants");

    if (uniqueUserIds.length < 2 && !isGroup) {
      throw new Error("At least two users are required to start a conversation");
    }

    const type = options?.type || (isGroup ? "GROUP" : "DIRECT");
    if (type === "DIRECT" && (uniqueUserIds.length !== 2 || isGroup)) {
      throw new Error("Direct conversations must have exactly two participants");
    }
    if (type !== "DIRECT" && !options?.createdById) {
      throw new Error("Group and channel conversations require an explicit owner");
    }

    // Enforce every other participant's "who can message me" rule when a new
    // private direct conversation is being started. Groups and channels are
    // governed by their own membership and permission systems.
    if (type === "DIRECT") {
      const creatorId = options?.createdById || uniqueUserIds[0];
      for (const recipientId of uniqueUserIds) {
        if (recipientId === creatorId) continue;
        await assertDirectMessageAllowed(creatorId, recipientId);
      }
    }

    const activeUsers = await prisma.user.count({ where: { id: { in: uniqueUserIds }, status: "ACTIVE" } });
    if (activeUsers !== uniqueUserIds.length) throw new Error("One or more participants do not exist");

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

    if (type === "DIRECT") {
      const creator = options?.createdById || uniqueUserIds[0];
      const recipient = uniqueUserIds.find(id => id !== creator);
      if (!recipient) throw new Error("Invalid recipient");
      await assertChatContactApproved(creator, recipient);
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
        permissions: options?.permissions && Object.keys(options.permissions).length ? JSON.stringify(options.permissions) : null,
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
