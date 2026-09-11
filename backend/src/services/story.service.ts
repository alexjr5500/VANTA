import { prisma } from "../prisma";
import { contentViewService } from "./content-view.service";

const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Daily Status/Story quota for a standard (non-verified) user.
// A "status post" is ONE published Story row. A Story is a single piece of
// media + optional caption, so one Story with multiple media is represented as
// multiple Story rows by the existing VANTA data model — i.e. the existing
// semantic is one status post = one media item. The limit is therefore enforced
// on the Story row count so the model's existing meaning is preserved.
export const DAILY_STATUS_LIMIT = 7;

export class StoryService {
  /**
   * Enforce the daily Status/Story upload quota for a normal user (server-side,
   * never client-supplied). Verified users have no limit.
   *
   * Concurrency-safe: the count + create happen inside a single transaction so
   * a standard user cannot slip past the limit via simultaneous requests.
   */
  async assertCanCreateStory(tx: any, userId: string, isVerified: boolean) {
    if (isVerified) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const publishedToday = await tx.story.count({
      where: { userId, createdAt: { gte: startOfDay } },
    });
    if (publishedToday >= DAILY_STATUS_LIMIT) {
      throw new Error(`You've reached today's Status limit of ${DAILY_STATUS_LIMIT} posts.`);
    }
  }

  /** Return today's published Status count and the remaining quota for the UI (e.g. "3/7"). */
  async getStatusUsage(userId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const used = await prisma.story.count({
      where: { userId, createdAt: { gte: startOfDay } },
    });
    return { used, limit: DAILY_STATUS_LIMIT };
  }

  async createStory(userId: string, mediaUrl: string, mediaType: string = "IMAGE", caption?: string, options?: { isVerified?: boolean }) {
    const isVerified = Boolean(options?.isVerified);
    const expiresAt = new Date(Date.now() + STORY_TTL_MS);

    // Enforce the per-day quota atomically with the insert so concurrent uploads
    // cannot collectively exceed the limit for a normal user. Verified users
    // (`isVerified` is always resolved from the server-side User record — never
    // trusted from the client) bypass the quota entirely.
    const story = await prisma.$transaction(async tx => {
      await this.assertCanCreateStory(tx, userId, isVerified);
      return tx.story.create({
        data: {
          userId,
          mediaUrl,
          mediaType,
          caption,
          expiresAt,
        },
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      });
    });

    return story;
  }

  /**
   * Repost someone else's story directly onto the current user's own Status.
   * The new story reuses the original media (no re-upload) and keeps a snapshot
   * of the original creator so attribution survives the original expiring or
   * being deleted.
   */
  async reshareStory(userId: string, originalStoryId: string, caption?: string, options?: { isVerified?: boolean }) {
    const isVerified = Boolean(options?.isVerified);
    const original = await prisma.story.findUnique({
      where: { id: originalStoryId },
      include: { user: { select: { id: true, username: true, fullName: true, avatar: true } } },
    });
    if (!original || original.expiresAt.getTime() <= Date.now()) {
      throw new Error("Story not found or expired");
    }

    // Resharing publishes a new Story row on the caller's Status, so it must
    // respect the same daily quota (atomically) as any other story upload.
    return prisma.$transaction(async tx => {
      await this.assertCanCreateStory(tx, userId, isVerified);
      return tx.story.create({
        data: {
          userId,
          mediaUrl: original.mediaUrl,
          mediaType: original.mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
          caption: typeof caption === "string" && caption.trim() ? caption.trim() : undefined,
          resharedFromId: original.id,
          resharedFromUserId: original.userId,
          resharedFromUsername: original.user?.username || null,
          expiresAt: new Date(Date.now() + STORY_TTL_MS),
        },
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      });
    });
  }

  async likeStory(storyId: string, userId: string) {
    const story = await this.requireActiveStory(storyId);
    await prisma.storyLike.upsert({
      where: { storyId_userId: { storyId: story.id, userId } },
      create: { storyId: story.id, userId },
      update: {},
    });
    const likeCount = await prisma.storyLike.count({ where: { storyId: story.id } });
    return { liked: true, likeCount };
  }

  async unlikeStory(storyId: string, userId: string) {
    await prisma.storyLike.deleteMany({ where: { storyId, userId } });
    const likeCount = await prisma.storyLike.count({ where: { storyId } });
    return { liked: false, likeCount };
  }

  async addComment(storyId: string, userId: string, content: string) {
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) throw new Error("Comment cannot be empty");
    if (text.length > 1000) throw new Error("Comment is too long");
    const story = await this.requireActiveStory(storyId);

    return prisma.storyComment.create({
      data: { storyId: story.id, userId, content: text },
      include: {
        user: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
      },
    });
  }

  async getComments(storyId: string) {
    return prisma.storyComment.findMany({
      where: { storyId },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
      },
    });
  }

  async getActiveStories(currentUserId?: string) {
    const now = new Date();
    const stories = await prisma.story.findMany({
      where: { expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, username: true, avatar: true, verified: true } },
      },
    });

    const storyIds = stories.map((story) => story.id);
    const [viewerCounts, ownViews] = await Promise.all([
      prisma.contentView.groupBy({
        by: ["contentId"],
        where: { contentType: "STORY", contentId: { in: storyIds } },
        _count: { _all: true },
      }),
      currentUserId ? prisma.contentView.findMany({
        where: { contentType: "STORY", contentId: { in: storyIds }, userId: currentUserId },
        select: { contentId: true },
      }) : [],
    ]);
    const countByStory = new Map(viewerCounts.map((item) => [item.contentId, item._count._all]));
    const viewedStoryIds = new Set(ownViews.map((item) => item.contentId));

    // Engagement stats so the story owner sees real like/reshare/comment counts.
    const engagement = await this.computeEngagement(stories, currentUserId);
    const engagementByStory = new Map(stories.map((story) => [story.id, engagement.get(story.id)]));

    // Group by user for Instagram-style display
    const grouped = new Map<string, any>();
    for (const story of stories) {
      if (!grouped.has(story.userId)) {
        grouped.set(story.userId, {
          user: story.user,
          stories: [],
          hasUnviewed: false,
        });
      }
      const group = grouped.get(story.userId);
      const stats = engagementByStory.get(story.id) || { likeCount: 0, reshareCount: 0, commentCount: 0, likedByMe: false };
      group.stories.push({
        ...story,
        views: countByStory.get(story.id) || 0,
        viewed: viewedStoryIds.has(story.id),
        likeCount: stats.likeCount,
        reshareCount: stats.reshareCount,
        commentCount: stats.commentCount,
        likedByMe: stats.likedByMe,
      });
      if (!viewedStoryIds.has(story.id)) {
        group.hasUnviewed = true;
      }
    }

    return Array.from(grouped.values());
  }

  async getStoryById(storyId: string) {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
    if (!story) return story;
    const engagement = await this.computeEngagement([story]);
    const stats = engagement.get(story.id) || { likeCount: 0, reshareCount: 0, commentCount: 0 };
    return { ...story, likeCount: stats.likeCount, reshareCount: stats.reshareCount, commentCount: stats.commentCount };
  }

  async viewStory(storyId: string, userId: string) {
    return contentViewService.record("STORY", storyId, userId);
  }

  async deleteStory(storyId: string, userId: string) {
    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) throw new Error("Story not found");
    if (story.userId !== userId) throw new Error("Unauthorized");

    await prisma.story.delete({ where: { id: storyId } });
    return { success: true };
  }

  /**
   * Delete a comment on the caller's story (or their own comment). The story
   * owner may remove comments from their story; ADMIN/MODERATOR can moderate.
   */
  async deleteStoryComment(storyId: string, commentId: string, userId: string, role = "USER") {
    const existing = await prisma.storyComment.findUnique({ where: { id: commentId } });
    if (!existing || existing.storyId !== storyId) throw new Error("Comment not found");
    const story = await prisma.story.findUnique({ where: { id: storyId }, select: { userId: true } });
    const isOwner = Boolean(story && story.userId === userId);
    const canModerate = ["ADMIN", "MODERATOR"].includes(role);
    if (existing.userId !== userId && !isOwner && !canModerate) throw new Error("Unauthorized");

    await prisma.storyComment.delete({ where: { id: commentId } });
    const commentCount = await prisma.storyComment.count({ where: { storyId } });
    return { deleted: true, commentCount };
  }

  async getStoryViewers(storyId: string, ownerId: string) {
    return contentViewService.storyViewers(storyId, ownerId);
  }

  private async requireActiveStory(storyId: string) {
    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.expiresAt.getTime() <= Date.now()) {
      throw new Error("Story not found or expired");
    }
    return story;
  }

  /** Batch-compute like/reshare/comment counts (and caller's like flag) for a set of stories. */
  private async computeEngagement(stories: Array<{ id: string }>, currentUserId?: string) {
    const ids = stories.map((story) => story.id);
    const [likeRows, reshareRows, commentRows, ownLikes] = await Promise.all([
      prisma.storyLike.groupBy({
        by: ["storyId"],
        where: { storyId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.story.groupBy({
        by: ["resharedFromId"],
        where: { resharedFromId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.storyComment.groupBy({
        by: ["storyId"],
        where: { storyId: { in: ids } },
        _count: { _all: true },
      }),
      currentUserId
        ? prisma.storyLike.findMany({ where: { userId: currentUserId, storyId: { in: ids } }, select: { storyId: true } })
        : [],
    ]);
    const likeByStory = new Map(likeRows.map((row) => [row.storyId, row._count._all]));
    const reshareByStory = new Map(reshareRows.map((row) => [row.resharedFromId!, row._count._all]));
    const commentByStory = new Map(commentRows.map((row) => [row.storyId, row._count._all]));
    const likedSet = new Set(ownLikes.map((row) => row.storyId));

    return new Map(
      ids.map((id) => [
        id,
        {
          likeCount: likeByStory.get(id) || 0,
          reshareCount: reshareByStory.get(id) || 0,
          commentCount: commentByStory.get(id) || 0,
          likedByMe: Boolean(currentUserId) && likedSet.has(id),
        },
      ])
    );
  }
}

export const storyService = new StoryService();