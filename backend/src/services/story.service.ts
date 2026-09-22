import { prisma } from "../prisma";
import { contentViewService } from "./content-view.service";

const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// Status hard limits (2026 product rules). A Status is the text a user posts
// to their Story/Status tray — whether authored as a plain Status or as a
// designed Text Story. Both composer paths funnel into the SAME Story row, so
// the limits are enforced once here (server-side, never client-supplied) and
// the database can never receive invalid Status content.
// ============================================================================
export const STATUS_MAX_CHARS = 700;
export const STATUS_MAX_LINES = 10;

/** Count text length in Unicode code points (emoji like "👨👩👧" count once, not per UTF-16 half). */
export function countStatusChars(text: string): number {
  return Array.from(text || "").length;
}

/** Count logical lines. Any of \n, \r\n or \r terminate a line. */
export function countStatusLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

/**
 * Validate Status content. Throws a human readable error when the text exceeds
 * 700 characters or 10 lines. Enforced on BOTH ends (backend + frontend).
 */
export function assertValidStatusText(text: string, label = "Status"): void {
  const chars = countStatusChars(text);
  if (chars > STATUS_MAX_CHARS) {
    throw new Error(`${label} is too long (${chars}/${STATUS_MAX_CHARS} characters). Please shorten it.`);
  }
  const lines = countStatusLines(text);
  if (lines > STATUS_MAX_LINES) {
    throw new Error(`${label} cannot exceed ${STATUS_MAX_LINES} lines.`);
  }
}

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
   * Only PUBLISHED rows count toward the quota — background drafts (UPLOADING)
   * or FAILED stories do not consume the user's daily allowance.
   *
   * Concurrency-safe: the count + create happen inside a single transaction so
   * a standard user cannot slip past the limit via simultaneous requests.
   */
  async assertCanCreateStory(tx: any, userId: string, isVerified: boolean) {
    if (isVerified) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const publishedToday = await tx.story.count({
      where: { userId, createdAt: { gte: startOfDay }, publishStatus: "PUBLISHED" },
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
      where: { userId, createdAt: { gte: startOfDay }, publishStatus: "PUBLISHED" },
    });
    return { used, limit: DAILY_STATUS_LIMIT };
  }

  async createStory(userId: string, mediaUrl: string, mediaType: string = "IMAGE", caption?: string, options?: { isVerified?: boolean }) {
    const isVerified = Boolean(options?.isVerified);
    const expiresAt = new Date(Date.now() + STORY_TTL_MS);

    // Caption is Status content (shown in the tray/viewer), so the same hard
    // limits apply. `trim()` prevents whitespace-only captions from counting.
    const normalizedCaption = typeof caption === "string" ? caption.trim() : undefined;
    if (normalizedCaption) assertValidStatusText(normalizedCaption, "Status caption");

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
          caption: normalizedCaption,
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
   * Create an instant Story draft (no media yet) when the user presses
   * "Publish Story". The media is then uploaded in the background and the
   * record flips to PUBLISHED via `finalizeStoryMedia` — the user is never
   * blocked on an upload screen.
   */
  async createStoryDraft(userId: string, caption?: string) {
    const normalizedCaption = typeof caption === "string" ? caption.trim() : undefined;
    if (normalizedCaption) assertValidStatusText(normalizedCaption, "Status caption");

    // Keep stray drafts bounded so a user cannot spam unlimited ghost records.
    const existingDrafts = await prisma.story.count({
      where: { userId, publishStatus: { in: ["UPLOADING", "FAILED"] } },
    });
    if (existingDrafts >= 10) {
      throw new Error("You have too many pending Story uploads. Retry or remove them first.");
    }

    const story = await prisma.story.create({
      data: {
        userId,
        mediaUrl: null,
        mediaType: "IMAGE",
        caption: normalizedCaption,
        publishStatus: "UPLOADING",
        expiresAt: new Date(Date.now() + STORY_TTL_MS),
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
    return story;
  }

  /** Re-open a failed draft for another upload attempt. */
  async setStoryUploading(userId: string, storyId: string) {
    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.userId !== userId) throw new Error("Story not found");
    await prisma.story.update({
      where: { id: storyId },
      data: { publishStatus: "UPLOADING", mediaUrl: null },
    });
    return prisma.story.findUnique({
      where: { id: storyId },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });
  }

  /**
   * Finalize a Story draft once its media finished uploading. Enforces the daily
   * quota atomically with the publish so a normal user cannot bypass it through
   * concurrent uploads, and never publishes a Story until its media URL exists.
   */
  async finalizeStoryMedia(userId: string, storyId: string, fileId: string, options?: { isVerified?: boolean }) {
    const isVerified = Boolean(options?.isVerified);
    const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt || file.userId !== userId) {
      throw new Error("Uploaded story media was not found or is not owned by you");
    }
    if (!file.url) {
      throw new Error("Uploaded story media has no storage URL — cannot publish.");
    }

    const story = await prisma.$transaction(async (tx) => {
      const draft = await tx.story.findUnique({ where: { id: storyId } });
      if (!draft || draft.userId !== userId) throw new Error("Story not found");
      await this.assertCanCreateStory(tx, userId, isVerified);
      return tx.story.update({
        where: { id: storyId },
        data: {
          mediaUrl: file.url,
          mediaType: file.fileType === "VIDEO" ? "VIDEO" : "IMAGE",
          publishStatus: "PUBLISHED",
          caption: typeof draft.caption === "string" ? draft.caption : undefined,
        },
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      });
    });

    // Make sure the UploadedFile row is linked to the concrete Story record.
    await prisma.uploadedFile
      .update({ where: { id: file.id }, data: { recordType: "Story", recordId: story.id, category: "story" } })
      .catch(() => undefined);
    return story;
  }

  /** Mark a Story draft FAILED (its background upload could not complete). */
  async failStoryMedia(userId: string, storyId: string) {
    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.userId !== userId) throw new Error("Story not found");
    if (story.publishStatus === "PUBLISHED") return story;
    return prisma.story.update({
      where: { id: storyId },
      data: { publishStatus: "FAILED" },
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });
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

    // Reshare caption is Status content on the caller's tray — enforce the same
    // hard limits (700 chars / 10 lines) before publishing the new row.
    const reshareCaption = typeof caption === "string" && caption.trim() ? caption.trim() : undefined;
    if (reshareCaption) assertValidStatusText(reshareCaption, "Status caption");

    // Resharing publishes a new Story row on the caller's Status, so it must
    // respect the same daily quota (atomically) as any other story upload.
    return prisma.$transaction(async tx => {
      await this.assertCanCreateStory(tx, userId, isVerified);
      return tx.story.create({
        data: {
          userId,
          mediaUrl: original.mediaUrl,
          mediaType: original.mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
          caption: reshareCaption,
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

  /**
   * Create a text-only Story/Status (no media/background image required).
   * The text lives in `caption` and the row is typed as `mediaType: "TEXT"`,
   * so the existing Story model/APIs/delete/engagement flows work unchanged.
   * Options may carry the `textStyle` JSON payload authored by the premium
   * text canvas so the viewer renders the exact design.
   */
  async createTextStory(userId: string, text: string, options?: { isVerified?: boolean; textStyle?: string }) {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) throw new Error("Text story cannot be empty");
    // Hard Status limits — 700 characters & 10 lines, independently enforced
    // on the backend. This is the single funnel for EVERY Status/Text Story.
    assertValidStatusText(trimmed);

    const isVerified = Boolean(options?.isVerified);
    const expiresAt = new Date(Date.now() + STORY_TTL_MS);
    // Only persist a well-formed style payload (small JSON string). Anything
    // larger than 8KB is rejected so the DB never stores junk.
    const textStyle = typeof options?.textStyle === "string" && options.textStyle.length <= 8192
      ? options.textStyle
      : undefined;

    const story = await prisma.$transaction(async tx => {
      await this.assertCanCreateStory(tx, userId, isVerified);
      return tx.story.create({
        data: {
          userId,
          // mediaUrl is a required column; an empty value signals "no media".
          mediaUrl: "",
          mediaType: "TEXT",
          caption: trimmed,
          textStyle,
          expiresAt,
        },
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      });
    });

    return story;
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
      where: { expiresAt: { gt: now }, publishStatus: "PUBLISHED" },
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
      where: { id: storyId, publishStatus: "PUBLISHED" },
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
    if (!story || story.expiresAt.getTime() <= Date.now() || story.publishStatus !== "PUBLISHED") {
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