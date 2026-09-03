import { prisma } from "../prisma";

export class CommunityService {
  async createCommunity(ownerId: string, name: string, description?: string, category?: string, isPrivate?: boolean) {
    const existing = await prisma.community.findUnique({ where: { name } });
    if (existing) throw new Error("Community name already exists");

    const community = await prisma.community.create({
      data: {
        name,
        description,
        category,
        isPrivate: isPrivate || false,
        ownerId,
        members: {
          create: { userId: ownerId, role: "ADMIN" },
        },
      },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
        },
        _count: { select: { members: true, posts: true } },
      },
    });

    return community;
  }

  async getCommunities(cursor?: string, limit: number = 20) {
    const communities = await prisma.community.findMany({
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        _count: { select: { members: true, posts: true } },
      },
    });

    const nextCursor = communities.length > limit ? communities.pop()?.id : undefined;
    return { items: communities, nextCursor };
  }

  async getCommunityById(id: string) {
    return prisma.community.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, username: true, avatar: true } } },
        },
        posts: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            author: { select: { id: true, username: true, avatar: true } },
          },
        },
        _count: { select: { members: true, posts: true } },
      },
    });
  }

  async joinCommunity(communityId: string, userId: string) {
    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) throw new Error("Community not found");
    if (community.isPrivate) throw new Error("Community is private");

    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });
    if (existing) return existing;

    return prisma.communityMember.create({
      data: { communityId, userId },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });
  }

  async leaveCommunity(communityId: string, userId: string) {
    await prisma.communityMember.deleteMany({
      where: { communityId, userId },
    });
    return { success: true };
  }

  async updateMemberRole(communityId: string, targetUserId: string, role: string, requesterId: string) {
    const requester = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: requesterId } },
    });
    if (!requester || requester.role !== "ADMIN") throw new Error("Unauthorized");

    return prisma.communityMember.update({
      where: { communityId_userId: { communityId, userId: targetUserId } },
      data: { role },
    });
  }

  async createPost(communityId: string, authorId: string, content: string, mediaUrl?: string) {
    const member = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId: authorId } },
    });
    if (!member) throw new Error("Not a member of this community");

    return prisma.communityPost.create({
      data: { communityId, authorId, content, mediaUrl },
      include: { author: { select: { id: true, username: true, avatar: true } } },
    });
  }

  async getCommunityPosts(communityId: string, cursor?: string, limit: number = 20) {
    const posts = await prisma.communityPost.findMany({
      where: { communityId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { author: { select: { id: true, username: true, avatar: true } } },
    });

    const nextCursor = posts.length > limit ? posts.pop()?.id : undefined;
    return { items: posts, nextCursor };
  }

  async updateCommunity(id: string, data: any, userId: string) {
    const community = await prisma.community.findUnique({ where: { id } });
    if (!community) throw new Error("Community not found");
    if (community.ownerId !== userId) throw new Error("Unauthorized");

    return prisma.community.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
        ...(data.bannerUrl !== undefined ? { bannerUrl: data.bannerUrl } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.isPrivate !== undefined ? { isPrivate: data.isPrivate } : {}),
      },
    });
  }

  async deleteCommunity(id: string, userId: string) {
    const community = await prisma.community.findUnique({ where: { id } });
    if (!community) throw new Error("Community not found");
    if (community.ownerId !== userId) throw new Error("Unauthorized");

    await prisma.community.delete({ where: { id } });
    return { success: true };
  }
}

export const communityService = new CommunityService();