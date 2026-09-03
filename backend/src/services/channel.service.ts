import { prisma } from "../prisma";
import { chatService } from "./chat.service";

export class ChannelService {
  private async withConversationSettings(channel: any) {
    if (!channel?.conversationId) return { ...channel, handle: null, visibility: "PUBLIC", permissions: {} };
    const conversation = await prisma.conversation.findUnique({ where: { id: channel.conversationId }, select: { handle: true, visibility: true, permissions: true } });
    let permissions: Record<string, boolean> = {};
    try { permissions = conversation?.permissions ? JSON.parse(conversation.permissions) : {}; } catch { permissions = {}; }
    return { ...channel, handle: conversation?.handle, visibility: conversation?.visibility || "PUBLIC", permissions };
  }

  async createChannel(ownerId: string, name: string, description?: string, category?: string, memberIds?: string[], avatar?: string, handle?: string, visibility: string = "PUBLIC") {
    const existing = await prisma.channel.findUnique({ where: { name } });
    if (existing) throw new Error("Channel name already exists");

    const allMemberIds = [ownerId, ...(memberIds?.filter(id => id !== ownerId) || [])];
    const uniqueMemberIds = [...new Set(allMemberIds)];

    const channel = await prisma.channel.create({
      data: {
        name,
        description,
        category,
        avatar,
        ownerId,
        members: {
          create: uniqueMemberIds.map(userId => ({
            userId,
            role: userId === ownerId ? "ADMIN" : "MEMBER",
          })),
        },
      },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
        },
        _count: { select: { members: true, messages: true } },
      },
    });

    const conversation = await chatService.createConversation(uniqueMemberIds, name, true, {
      type: "CHANNEL", avatar, description, handle, visibility, createdById: ownerId,
    });
    await prisma.channel.update({ where: { id: channel.id }, data: { conversationId: conversation.id } });

    return {
      ...channel,
      conversationId: conversation.id,
      conversation,
    };
  }

  async getChannels(cursor?: string, limit: number = 20) {
    const channels = await prisma.channel.findMany({
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        _count: { select: { members: true, messages: true } },
      },
    });

    const nextCursor = channels.length > limit ? channels.pop()?.id : undefined;
    return { items: channels, nextCursor };
  }

  async getChannelById(id: string, requesterId?: string) {
    const channel = await prisma.channel.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
        },
        _count: { select: { members: true, messages: true } },
      },
    });
    if (channel && requesterId && !channel.members.some(member => member.userId === requesterId)) throw new Error("Not a member of this channel");
    return channel ? this.withConversationSettings(channel) : null;
  }

  async updateChannel(
    channelId: string,
    requesterId: string,
    data: {
      name?: string;
      description?: string;
      avatar?: string | null;
      category?: string;
      visibility?: string;
      handle?: string;
      memberIds?: string[];
      memberRoles?: Record<string, string>;
      permissions?: Record<string, boolean>;
    }
  ) {
    const channel: any = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { members: true },
    });
    if (!channel) throw new Error("Channel not found");

    const requester = channel.members.find((m: any) => m.userId === requesterId);
    if (!requester || !["OWNER", "ADMIN", "MODERATOR"].includes(requester.role)) {
      throw new Error("Only channel administrators can edit this channel");
    }

    if (data.name !== undefined && (!data.name.trim() || data.name.trim().length > 60)) {
      throw new Error("Channel name must be between 1 and 60 characters");
    }
    const safeName = data.name?.trim() || channel.name;
    const safeDescription = data.description !== undefined ? (data.description?.trim() || null) : channel.description;
    const safeAvatar = data.avatar !== undefined ? data.avatar : channel.avatar;
    const safeCategory = data.category !== undefined ? (data.category?.trim() || null) : channel.category;
    const conversationSettings = channel.conversationId
      ? await prisma.conversation.findUnique({ where: { id: channel.conversationId }, select: { visibility: true } })
      : null;
    const currentVisibility = conversationSettings?.visibility || "PUBLIC";
    const safeVisibility = data.visibility !== undefined ? (["PUBLIC", "PRIVATE"].includes(data.visibility) ? data.visibility : currentVisibility) : currentVisibility;
    const safeHandle = data.handle !== undefined ? (data.handle.trim().replace(/^@/, "") || null) : undefined;

    const safeRoles: Record<string, string> = {};
    if (data.memberRoles) {
      if (requesterId !== channel.ownerId) throw new Error("Only the channel owner can manage administrators");
      for (const [userId, role] of Object.entries(data.memberRoles)) {
        if (userId === channel.ownerId) continue;
        if (!channel.members.some((member: any) => member.userId === userId)) throw new Error("Cannot change role for a user who is not a member");
        if (!["ADMIN", "MODERATOR", "MEMBER"].includes(role)) throw new Error(`Invalid role: ${role}`);
        safeRoles[userId] = role;
      }
    }
    const requestedMemberIds = data.memberIds ? [...new Set([...data.memberIds, channel.ownerId])] : undefined;
    if (requestedMemberIds) {
      const activeUsers = await prisma.user.count({ where: { id: { in: requestedMemberIds }, status: "ACTIVE" } });
      if (activeUsers !== requestedMemberIds.length) throw new Error("One or more members do not exist");
      const currentPrivilegedIds = channel.members.filter((member: any) => ["ADMIN", "MODERATOR"].includes(member.role)).map((member: any) => member.userId);
      const removingPrivileged = currentPrivilegedIds.some((id: string) => !requestedMemberIds.includes(id));
      if (requesterId !== channel.ownerId && removingPrivileged) throw new Error("Only the channel owner can remove administrators");
    }

    await prisma.$transaction(async tx => {
      await tx.channel.update({ where: { id: channelId }, data: { name: safeName, description: safeDescription, avatar: safeAvatar, category: safeCategory } });
      if (channel.conversationId) await tx.conversation.update({ where: { id: channel.conversationId }, data: { name: safeName, description: safeDescription, avatar: safeAvatar, visibility: safeVisibility, ...(safeHandle !== undefined ? { handle: safeHandle } : {}), ...(data.permissions !== undefined ? { permissions: JSON.stringify(Object.fromEntries(Object.entries(data.permissions).filter(([key, value]) => ["postMessages", "editMessages", "deleteMessages", "manageChannelInfo", "manageSubscribers", "manageInviteLinks"].includes(key) && typeof value === "boolean"))) } : {}) } });
      if (requestedMemberIds) {
        const currentIds = channel.members.map((member: any) => member.userId);
        const toAdd = requestedMemberIds.filter(id => !currentIds.includes(id));
        const toRemove = currentIds.filter((id: string) => !requestedMemberIds.includes(id) && id !== channel.ownerId);
        if (toAdd.length) {
          await tx.channelMember.createMany({ data: toAdd.map(userId => ({ channelId, userId })) });
          if (channel.conversationId) await tx.participant.createMany({ data: toAdd.map(userId => ({ conversationId: channel.conversationId, userId })) });
        }
        if (toRemove.length) {
          await tx.channelMember.deleteMany({ where: { channelId, userId: { in: toRemove } } });
          if (channel.conversationId) await tx.participant.deleteMany({ where: { conversationId: channel.conversationId, userId: { in: toRemove } } });
        }
      }
      for (const [userId, role] of Object.entries(safeRoles)) {
        await tx.channelMember.updateMany({ where: { channelId, userId }, data: { role } });
        if (channel.conversationId) await tx.participant.updateMany({ where: { conversationId: channel.conversationId, userId }, data: { role } });
      }
    });
    const updated = await this.getChannelById(channelId);
    return { ...updated, conversationId: channel.conversationId, visibility: safeVisibility };
  }

  async joinChannel(channelId: string, userId: string) {
    const channel: any = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new Error("Channel not found");
    if (channel.conversationId) {
      const conversation = await prisma.conversation.findUnique({ where: { id: channel.conversationId }, select: { visibility: true } });
      if (conversation?.visibility === "PRIVATE") throw new Error("This channel is private");
    }
    const existing = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (existing) return existing;

    const joined = await prisma.channelMember.create({
      data: { channelId, userId },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });
    if (channel?.conversationId) await prisma.participant.upsert({ where: { userId_conversationId: { userId, conversationId: channel.conversationId } }, create: { userId, conversationId: channel.conversationId }, update: {} });
    return joined;
  }

  async leaveChannel(channelId: string, userId: string) {
    const channel: any = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new Error("Channel not found");
    if (channel.ownerId === userId) throw new Error("The channel owner cannot leave the channel");
    await prisma.channelMember.deleteMany({
      where: { channelId, userId },
    });
    if (channel?.conversationId) await prisma.participant.deleteMany({ where: { conversationId: channel.conversationId, userId } });
    return { success: true };
  }

  async sendMessage(channelId: string, authorId: string, content: string) {
    const member = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: authorId } },
    });
    if (!member || !["OWNER", "ADMIN", "MODERATOR"].includes(member.role)) throw new Error("Only channel administrators can publish posts");

    return prisma.channelMessage.create({
      data: { channelId, authorId, content },
      include: { author: { select: { id: true, username: true, avatar: true } } },
    });
  }

  async getMessages(channelId: string, cursor?: string, limit: number = 50) {
    const messages = await prisma.channelMessage.findMany({
      where: { channelId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { author: { select: { id: true, username: true, avatar: true } } },
    });

    const nextCursor = messages.length > limit ? messages.pop()?.id : undefined;
    return { items: messages.reverse(), nextCursor };
  }

  async deleteChannel(id: string, userId: string) {
    const channel = await prisma.channel.findUnique({ where: { id } });
    if (!channel) throw new Error("Channel not found");
    if (channel.ownerId !== userId) throw new Error("Unauthorized");

    await prisma.channel.delete({ where: { id } });
    return { success: true };
  }
}

export const channelService = new ChannelService();