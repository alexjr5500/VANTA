import { prisma } from "../prisma";
import { chatService } from "./chat.service";

export class GroupService {
  private async withConversationSettings(group: any) {
    if (!group?.conversationId) return { ...group, permissions: {} };
    const conversation = await prisma.conversation.findUnique({
      where: { id: group.conversationId },
      select: { permissions: true },
    });
    let permissions: Record<string, boolean> = {};
    try { permissions = conversation?.permissions ? JSON.parse(conversation.permissions) : {}; } catch { permissions = {}; }
    return { ...group, permissions };
  }

  async createGroup(ownerId: string, name: string, description?: string, memberIds?: string[], avatar?: string) {
    const allMemberIds = [ownerId, ...(memberIds?.filter(id => id !== ownerId) || [])];
    const uniqueMemberIds = [...new Set(allMemberIds)];

    const group = await prisma.group.create({
      data: {
        name,
        description,
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
      type: "GROUP", avatar, description, createdById: ownerId,
    });
    await prisma.group.update({ where: { id: group.id }, data: { conversationId: conversation.id } });

    return {
      ...group,
      conversationId: conversation.id,
      conversation,
    };
  }

  async getMyGroups(userId: string) {
    return prisma.group.findMany({
      where: { members: { some: { userId } } },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
        },
        _count: { select: { members: true, messages: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async getGroupById(id: string, requesterId?: string) {
    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
        },
        _count: { select: { members: true, messages: true } },
      },
    });
    if (group && requesterId && !group.members.some(member => member.userId === requesterId)) throw new Error("Not a member of this group");
    return group ? this.withConversationSettings(group) : null;
  }

  async updateGroup(
    groupId: string,
    requesterId: string,
    data: {
      name?: string;
      description?: string;
      avatar?: string | null;
      memberIds?: string[];
      memberRoles?: Record<string, string>;
      permissions?: Record<string, boolean>;
    }
  ) {
    const group: any = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });
    if (!group) throw new Error("Group not found");

    const requester = group.members.find((m: any) => m.userId === requesterId);
    if (!requester) throw new Error("Not a member of this group");
    if (requester.role !== "ADMIN" && group.ownerId !== requesterId) {
      throw new Error("Only group administrators can edit this group");
    }

    if (data.name !== undefined && (!data.name.trim() || data.name.trim().length > 60)) {
      throw new Error("Group name must be between 1 and 60 characters");
    }
    const safeName = data.name?.trim() || group.name;
    const safeDescription = data.description !== undefined ? (data.description?.trim() || null) : group.description;
    const safeAvatar = data.avatar !== undefined ? data.avatar : group.avatar;

    // Validate memberRoles (only ADMIN/MEMBER allowed, must be existing members)
    const safeRoles: Record<string, string> = {};
    if (data.memberRoles) {
      if (requesterId !== group.ownerId) throw new Error("Only the group owner can manage administrators");
      for (const [userId, role] of Object.entries(data.memberRoles)) {
        if (userId === group.ownerId) continue; // Owner role is immutable
        if (!group.members.some((m: any) => m.userId === userId)) {
          throw new Error("Cannot change role for a user who is not a member");
        }
        if (!["ADMIN", "MEMBER"].includes(role)) throw new Error(`Invalid role: ${role}`);
        safeRoles[userId] = role;
      }
    }

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: {
        name: safeName,
        description: safeDescription,
        avatar: safeAvatar,
      },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
        },
        _count: { select: { members: true, messages: true } },
      },
    });

    // Sync conversation metadata
    if (group.conversationId) {
      await prisma.conversation.update({
        where: { id: group.conversationId },
        data: {
          name: safeName,
          description: safeDescription,
          avatar: safeAvatar,
        },
      });
    }

    // Handle member additions / removals
    const requestedMemberIds = data.memberIds;
    if (requestedMemberIds) {
      const normalizedMemberIds = [...new Set([...requestedMemberIds, group.ownerId])];
      const currentIds = group.members.map((m: any) => m.userId);
      const toAdd = normalizedMemberIds.filter((id: string) => !currentIds.includes(id));
      const toRemove = currentIds.filter((id: string) => !normalizedMemberIds.includes(id) && id !== group.ownerId);
      if (requesterId !== group.ownerId && toRemove.some((id: string) => group.members.some((member: any) => member.userId === id && member.role === "ADMIN"))) {
        throw new Error("Only the group owner can remove administrators");
      }

      const activeUsers = await prisma.user.count({ where: { id: { in: normalizedMemberIds }, status: "ACTIVE" } });
      if (activeUsers !== normalizedMemberIds.length) throw new Error("One or more members do not exist");

      if (toAdd.length) {
        await prisma.groupMember.createMany({
          data: toAdd.map((userId: string) => ({ groupId, userId })),
        });
        if (group.conversationId) {
          await prisma.participant.createMany({
            data: toAdd.map((userId: string) => ({ userId, conversationId: group.conversationId })),
          });
        }
      }
      if (toRemove.length) {
        await prisma.groupMember.deleteMany({ where: { groupId, userId: { in: toRemove } } });
        if (group.conversationId) {
          await prisma.participant.deleteMany({
            where: { conversationId: group.conversationId, userId: { in: toRemove } },
          });
        }
      }
    }

    if (data.permissions !== undefined) {
      const allowedPermissionKeys = ["sendMessages", "sendMedia", "sendLinks", "addMembers", "pinMessages", "changeGroupInfo"];
      const permissions = Object.fromEntries(Object.entries(data.permissions).filter(([key, value]) => allowedPermissionKeys.includes(key) && typeof value === "boolean"));
      if (group.conversationId) await prisma.conversation.update({ where: { id: group.conversationId }, data: { permissions: JSON.stringify(permissions) } });
    }

    // Apply role updates
    const roleUpdates = Object.entries(safeRoles);
    for (const [userId, role] of roleUpdates) {
      await prisma.groupMember.updateMany({ where: { groupId, userId }, data: { role } });
      if (group.conversationId) {
        await prisma.participant.updateMany({
          where: { conversationId: group.conversationId, userId },
          data: { role },
        });
      }
    }

    // Re-fetch when membership changed so response reflects all mutations
    if (data.memberIds || roleUpdates.length) {
      const refreshed = await prisma.group.findUnique({
        where: { id: groupId },
        include: {
          owner: { select: { id: true, username: true, avatar: true } },
          members: {
            include: { user: { select: { id: true, username: true, avatar: true } } },
          },
          _count: { select: { members: true, messages: true } },
        },
      });
      if (refreshed) return this.withConversationSettings({ ...refreshed, conversationId: group.conversationId });
    }

    return this.withConversationSettings({ ...updated, conversationId: group.conversationId });
  }

  async addMember(groupId: string, userId: string, requesterId: string) {
    const group: any = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new Error("Group not found");

    // Only admins can add members
    const requester = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: requesterId } },
    });
    if (!requester || (requester.role !== "ADMIN" && group.ownerId !== requesterId)) throw new Error("Unauthorized");

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing) throw new Error("Already a member");

    const added = await prisma.groupMember.create({
      data: { groupId, userId },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });
    if (group.conversationId) await prisma.participant.upsert({ where: { userId_conversationId: { userId, conversationId: group.conversationId } }, create: { userId, conversationId: group.conversationId }, update: {} });
    return added;
  }

  async removeMember(groupId: string, userId: string, requesterId: string) {
    const group: any = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new Error("Group not found");
    if (userId === group.ownerId) throw new Error("The group owner cannot leave or be removed");
    if (userId === requesterId) {
      // User leaving themselves
      await prisma.groupMember.deleteMany({ where: { groupId, userId } });
      if (group?.conversationId) await prisma.participant.deleteMany({ where: { conversationId: group.conversationId, userId } });
      return { success: true };
    }

    const requester = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: requesterId } },
    });
    if (!requester || (requester.role !== "ADMIN" && group.ownerId !== requesterId)) throw new Error("Unauthorized");
    const target = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (target?.role === "ADMIN" && requesterId !== group.ownerId) throw new Error("Only the group owner can remove administrators");

    await prisma.groupMember.deleteMany({ where: { groupId, userId } });
    if (group.conversationId) await prisma.participant.deleteMany({ where: { conversationId: group.conversationId, userId } });
    return { success: true };
  }

  async sendMessage(groupId: string, authorId: string, content: string) {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: authorId } },
    });
    if (!member) throw new Error("Not a member of this group");

    return prisma.groupMessage.create({
      data: { groupId, authorId, content },
      include: { author: { select: { id: true, username: true, avatar: true } } },
    });
  }

  async getMessages(groupId: string, cursor?: string, limit: number = 50) {
    const messages = await prisma.groupMessage.findMany({
      where: { groupId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { author: { select: { id: true, username: true, avatar: true } } },
    });

    const nextCursor = messages.length > limit ? messages.pop()?.id : undefined;
    return { items: messages.reverse(), nextCursor };
  }

  async deleteGroup(id: string, userId: string) {
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) throw new Error("Group not found");
    if (group.ownerId !== userId) throw new Error("Unauthorized");

    await prisma.group.delete({ where: { id } });
    return { success: true };
  }
}

export const groupService = new GroupService();