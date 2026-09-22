import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../prisma";
import { communityService } from "../services";

const parseLimit = (value: unknown, defaultLimit = 20) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, 50);
};

const parseDiscoverLimit = (value: unknown) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return 12;
  return Math.min(parsed, 50);
};

export const createCommunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { name, description, category, isPrivate } = req.body;
    if (!name || !name.trim()) { res.status(400).json({ error: "Name is required" }); return; }

    const community = await communityService.createCommunity(userId, name.trim(), description, category, isPrivate);
    res.status(201).json(community);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getCommunities = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const communities = await communityService.getCommunities(cursor, limit);
    res.status(200).json(communities);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getCommunityById = async (req: Request, res: Response): Promise<void> => {
  try {
    const community = await communityService.getCommunityById(req.params.id);
    if (!community) { res.status(404).json({ error: "Community not found" }); return; }
    res.status(200).json(community);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const joinCommunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const result = await communityService.joinCommunity(req.params.id, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const leaveCommunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    await communityService.leaveCommunity(req.params.id, userId);
    res.status(200).json({ message: "Left community" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const createCommunityPost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { content, mediaUrl } = req.body;
    if (!content || !content.trim()) { res.status(400).json({ error: "Content is required" }); return; }

    const post = await communityService.createPost(req.params.id, userId, content.trim(), mediaUrl);
    res.status(201).json(post);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getCommunityPosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const posts = await communityService.getCommunityPosts(req.params.id, cursor, limit);
    res.status(200).json(posts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const updateCommunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const community = await communityService.updateCommunity(req.params.id, req.body, userId);
    res.status(200).json(community);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const deleteCommunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    await communityService.deleteCommunity(req.params.id, userId);
    res.status(200).json({ message: "Community deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// COMMUNITIES DISCOVERY DIRECTORY
// Public Groups & public Channels already exist in the Group/Channel system.
// This surface only lists them (never private ones) and never creates a
// separate community model — the identity, membership and routing all belong
// to the existing Group/Channel architecture.
// ============================================================================

export const getDiscoverCommunities = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseDiscoverLimit(req.query.limit);

    // Only public conversations are discoverable. Group/Channel rows keep the
    // visibility on their linked Conversation (default PUBLIC for non-DIRECT).
    const publicConversations = await prisma.conversation.findMany({
      where: { visibility: { not: "PRIVATE" } },
      select: { id: true },
      take: Math.min(limit * 4, 200),
    });
    const conversationIds = publicConversations.map(conversation => conversation.id);
    if (!conversationIds.length) {
      res.status(200).json({ items: [] });
      return;
    }

    const [groups, channels] = await Promise.all([
      prisma.group.findMany({
        where: { conversationId: { in: conversationIds } },
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: {
          owner: { select: { id: true, username: true, avatar: true } },
          _count: { select: { members: true, messages: true } },
        },
      }),
      prisma.channel.findMany({
        where: { conversationId: { in: conversationIds } },
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: {
          owner: { select: { id: true, username: true, avatar: true } },
          _count: { select: { members: true, messages: true } },
        },
      }),
    ]);

    const groupIds = groups.map(group => group.id);
    const channelIds = channels.map(channel => channel.id);
    let joinedGroupIds = new Set<string>();
    let joinedChannelIds = new Set<string>();
    if (userId) {
      const [groupMembers, channelMembers] = await Promise.all([
        groupIds.length
          ? prisma.groupMember.findMany({ where: { userId, groupId: { in: groupIds } }, select: { groupId: true } })
          : Promise.resolve([]),
        channelIds.length
          ? prisma.channelMember.findMany({ where: { userId, channelId: { in: channelIds } }, select: { channelId: true } })
          : Promise.resolve([]),
      ]);
      joinedGroupIds = new Set(groupMembers.map(member => member.groupId));
      joinedChannelIds = new Set(channelMembers.map(member => member.channelId));
    }

    const toItem = (kind: "group" | "channel", entity: any) => ({
      id: entity.id,
      kind,
      name: entity.name,
      description: entity.description,
      avatar: entity.avatar,
      category: entity.category,
      owner: entity.owner ?? null,
      joined: kind === "group" ? joinedGroupIds.has(entity.id) : joinedChannelIds.has(entity.id),
      isPrivate: false,
      _count: {
        members: entity._count?.members || 0,
        posts: entity._count?.messages || 0,
      },
    });

    const items = [
      ...groups.map(group => toItem("group", group)),
      ...channels.map(channel => toItem("channel", channel)),
    ].sort((a, b) => b._count.members - a._count.members);

    res.status(200).json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getDiscoverCommunityById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const id = req.params.id;

    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        _count: { select: { members: true, messages: true } },
      },
    });
    if (group) {
      let visibility = "PUBLIC";
      if (group.conversationId) {
        const conversation = await prisma.conversation.findUnique({
          where: { id: group.conversationId },
          select: { visibility: true },
        });
        visibility = conversation?.visibility || "PUBLIC";
      }
      if (visibility === "PRIVATE") {
        res.status(404).json({ error: "Community not found" });
        return;
      }
      const joined = userId
        ? Boolean(await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: group.id, userId } }, select: { id: true } }))
        : false;
      res.status(200).json({
        id: group.id,
        kind: "group",
        name: group.name,
        description: group.description,
        avatar: group.avatar,
        category: null,
        owner: group.owner ?? null,
        conversationId: group.conversationId,
        joined,
        isPrivate: false,
        _count: { members: group._count.members, posts: group._count.messages },
      });
      return;
    }

    const channel = await prisma.channel.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        _count: { select: { members: true, messages: true } },
      },
    });
    if (channel) {
      let visibility = "PUBLIC";
      if (channel.conversationId) {
        const conversation = await prisma.conversation.findUnique({
          where: { id: channel.conversationId },
          select: { visibility: true },
        });
        visibility = conversation?.visibility || "PUBLIC";
      }
      if (visibility === "PRIVATE") {
        res.status(404).json({ error: "Community not found" });
        return;
      }
      const joined = userId
        ? Boolean(await prisma.channelMember.findUnique({ where: { channelId_userId: { channelId: channel.id, userId } }, select: { id: true } }))
        : false;
      res.status(200).json({
        id: channel.id,
        kind: "channel",
        name: channel.name,
        description: channel.description,
        avatar: channel.avatar,
        category: channel.category,
        owner: channel.owner ?? null,
        conversationId: channel.conversationId,
        joined,
        isPrivate: false,
        _count: { members: channel._count.members, posts: channel._count.messages },
      });
      return;
    }

    res.status(404).json({ error: "Community not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};