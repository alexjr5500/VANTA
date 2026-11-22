import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../prisma";
import { uploadService } from "../services";
import { contentViewService } from "../services/content-view.service";
import { buildReelFeed } from "../services/reel-feed.service";
import { BADGE_USER_SELECT, enrichItemAuthors, enrichPublicUser } from "../services/public-verification";

// This response field is enabled only after HLS acceptance testing.
// Never replace the MP4 URL: older clients need the original as fallback.
const reelHlsDeliveryEnabled = process.env.VANTA_DURABLE_QUEUE_MEDIA_DELIVERY === "true";

const parseLimit = (value: unknown, defaultLimit = 20) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, 50);
};

// ============================================================================
// REEL PUBLISHING LIFECYCLE (background upload)
// ============================================================================
// `Publish Reel` creates a draft (UPLOADING, no videoUrl) instantly, the media
// uploads in the background through the resumable chunk pipeline, and the draft
// becomes live (PUBLISHED) only when its media URL exists. Drafts are never
// returned by the feed/detail endpoints.

// Instant Reel draft — media uploads in the background afterwards.
export const createReelDraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim().slice(0, 120) : "Reel";
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : undefined;
    if (!title) { res.status(400).json({ error: "Reel title is required" }); return; }

    const pending = await prisma.video.count({
      where: { creatorId: userId, publishStatus: { in: ["UPLOADING", "FAILED"] } },
    });
    if (pending >= 10) {
      res.status(400).json({ error: "You have too many pending Reel uploads. Retry or remove them first." });
      return;
    }

    const video = await prisma.video.create({
      data: { title, description, videoUrl: null, creatorId: userId, publishStatus: "UPLOADING" },
    });
    res.status(201).json({ message: "Reel draft created", video });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

// Re-open a failed draft for another upload attempt.
export const setReelUploading = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const reel = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (!reel || reel.creatorId !== userId) { res.status(404).json({ error: "Reel not found" }); return; }
    if (reel.publishStatus === "PUBLISHED") { res.status(200).json({ video: reel }); return; }
    const updated = await prisma.video.update({
      where: { id: reel.id },
      data: { publishStatus: "UPLOADING", videoUrl: null },
    });
    res.status(200).json({ video: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

// Bind uploaded media to a Reel draft and publish it (PUBLISHED).
export const finalizeReel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const reel = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (!reel || reel.creatorId !== userId) { res.status(404).json({ error: "Reel not found" }); return; }

    const fileId = typeof req.body?.fileId === "string" ? req.body.fileId : undefined;
    if (!fileId) { res.status(400).json({ error: "fileId is required" }); return; }
    const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt || file.userId !== userId || file.fileType !== "VIDEO") {
      res.status(403).json({ error: "Uploaded Reel media was not found, is not owned by you, or is not a video" });
      return;
    }
    if (!file.url) { res.status(400).json({ error: "Uploaded Reel media has no storage URL" }); return; }

    const duration = typeof req.body?.duration === "number" && Number.isFinite(req.body.duration)
      ? Math.max(0, Math.min(req.body.duration, 86_400))
      : null;

    // Linking the upload and publishing the Reel must succeed together.
    // Otherwise the Reel becomes public without a usable media association,
    // leaving completed Cloudinary HLS derivatives missing from its feed.
    const updated = await prisma.$transaction(async (tx) => {
      const linked = await tx.uploadedFile.updateMany({
        where: {
          id: file.id,
          userId,
          fileType: "VIDEO",
          deletedAt: null,
          OR: [
            { recordId: null },
            { recordType: "Video", recordId: reel.id },
          ],
        },
        data: { recordType: "Video", recordId: reel.id, category: "reel" },
      });
      if (linked.count !== 1) {
        throw new Error("Uploaded Reel media is no longer available for this Reel");
      }
      return tx.video.update({
        where: { id: reel.id, creatorId: userId },
        data: {
          videoUrl: file.url,
          thumbnailUrl: reel.thumbnailUrl || null,
          duration: duration ?? reel.duration,
          publishStatus: "PUBLISHED",
        },
      });
    });
    res.status(200).json({ message: "Reel published", video: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

// Mark a Reel draft FAILED when its background upload could not complete.
export const failReel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const reel = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (!reel || reel.creatorId !== userId) { res.status(404).json({ error: "Reel not found" }); return; }
    if (reel.publishStatus === "PUBLISHED") { res.status(200).json({ video: reel }); return; }
    const updated = await prisma.video.update({ where: { id: reel.id }, data: { publishStatus: "FAILED" } });
    res.status(200).json({ video: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// GET REELS
// ============================================================================

export const getReels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseLimit(req.query.limit, 20);
    const feed = req.query.feed === "following" || req.query.feed === "trending" ? req.query.feed : "for-you";
    const seed = typeof req.query.seed === "string" ? req.query.seed : undefined;
    const pageParam = typeof req.query.page === "string" ? parseInt(req.query.page, 10) : 0;
    const safePage = Number.isNaN(pageParam) || pageParam < 0 ? 0 : pageParam;
    const start = safePage * limit;

    if (feed === "following" && !userId) {
      res.status(200).json({ items: [], nextStart: null });
      return;
    }

    const { seed: resolvedSeed, nextStart, items: pageItems, followedCreators } = await buildReelFeed({
      userId,
      feed,
      seed,
      start,
      limit,
    });

    const pageReelIds = pageItems.map((item) => item.id);

    const reels = await prisma.video.findMany({
      where: { id: { in: pageReelIds }, moderationRemovedAt: null },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
            verified: true,
            ...BADGE_USER_SELECT,
          },
        },
        likes: userId ? { where: { userId }, select: { id: true } } : false,
        saves: userId ? { where: { userId }, select: { id: true } } : false,
        reposts: userId ? { where: { userId }, select: { id: true } } : false,
        _count: { select: { likes: true, comments: true, saves: true, shares: true, reposts: true } },
      },
    });

    // Re-order by the server-computed feed order (the findMany with `in` does not
    // preserve order) so pagination/rendering exactly matches the shuffled feed.
    const orderMap = new Map(pageReelIds.map((id, index) => [id, index]));
    reels.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

    const hlsFiles = reelHlsDeliveryEnabled && pageReelIds.length
      ? await prisma.uploadedFile.findMany({
        where: { recordType: "Video", recordId: { in: pageReelIds },
          category: "reel", fileType: "VIDEO", deletedAt: null, hlsUrl: { not: null } },
        select: { recordId: true, hlsUrl: true },
      }) : [];
    const hlsByReel = new Map(hlsFiles.filter(file => file.recordId && file.hlsUrl)
      .map(file => [file.recordId!, file.hlsUrl!]));

    const giftTotals = pageReelIds.length ? await prisma.giftTransaction.groupBy({
      by: ["videoId"],
      where: { videoId: { in: pageReelIds }, status: "COMPLETED" },
      _sum: { quantity: true },
    }) : [];
    const giftsByReel = new Map(giftTotals.map((row) => [row.videoId, row._sum.quantity || 0]));
    const sentGifts = userId && pageReelIds.length ? await prisma.giftTransaction.findMany({
      where: { senderId: userId, videoId: { in: pageReelIds }, status: "COMPLETED" },
      select: { videoId: true },
      distinct: ["videoId"],
    }) : [];
    const giftedByViewer = new Set(sentGifts.map((row) => row.videoId));

    res.status(200).json({
      items: reels.map((reel: any) => ({
        id: reel.id,
        title: reel.title,
        description: reel.description,
        videoUrl: reel.videoUrl,
        hlsUrl: hlsByReel.get(reel.id) ?? null,
        thumbnailUrl: reel.thumbnailUrl,
        duration: reel.duration,
        views: reel.views,
        likes: reel._count.likes,
        comments: reel._count.comments,
        saves: reel._count.saves,
        shares: reel._count.shares,
        reposts: reel._count.reposts,
        gifts: giftsByReel.get(reel.id) || 0,
        isGifted: giftedByViewer.has(reel.id),
        isReposted: userId ? reel.reposts?.length > 0 : false,
        isLiked: userId ? reel.likes?.length > 0 : false,
        isSaved: userId ? reel.saves?.length > 0 : false,
        isFollowing: followedCreators.has(reel.creatorId),
        author: {
          ...enrichPublicUser(reel.creator),
          isFollowing: followedCreators.has(reel.creatorId),
        },
        createdAt: reel.createdAt,
      })),
      nextStart,
      seed: resolvedSeed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const deleteReelComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const comment = await prisma.videoComment.findUnique({ where: { id: req.params.commentId } });
    if (!comment || comment.videoId !== req.params.id) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    if (comment.userId !== userId && req.user?.role !== "ADMIN") {
      res.status(403).json({ error: "You cannot delete this comment" });
      return;
    }
    await prisma.videoComment.delete({ where: { id: comment.id } });
    res.status(200).json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getReelById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const reel = await prisma.video.findUnique({
      where: { id: req.params.id, publishStatus: "PUBLISHED", moderationRemovedAt: null },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
            verified: true,
            ...BADGE_USER_SELECT,
          },
        },
        // Viewer-aware state (mirrors the GET /api/reels feed serialization so a
        // Reel behaves identically whether opened from the feed or a detail link).
        likes: userId ? { where: { userId }, select: { id: true } } : false,
        saves: userId ? { where: { userId }, select: { id: true } } : false,
        reposts: userId ? { where: { userId }, select: { id: true } } : false,
        _count: { select: { likes: true, comments: true, saves: true, shares: true, reposts: true } },
      },
    });

    if (!reel) {
      res.status(404).json({ error: "Reel not found" });
      return;
    }

    const derivative = reelHlsDeliveryEnabled
      ? await prisma.uploadedFile.findFirst({
        where: { recordType: "Video", recordId: reel.id, category: "reel",
          fileType: "VIDEO", deletedAt: null, hlsUrl: { not: null } },
        select: { hlsUrl: true },
      }) : null;

    const { creator, likes, saves, reposts, _count, ...rest } = reel as any;
    const gifts = await prisma.giftTransaction.aggregate({
      where: { videoId: reel.id, status: "COMPLETED" },
      _sum: { quantity: true },
    });
    const viewerGift = userId ? await prisma.giftTransaction.findFirst({
      where: { senderId: userId, videoId: reel.id, status: "COMPLETED" },
      select: { id: true },
    }) : null;
    res.status(200).json(enrichItemAuthors({
      ...rest,
      hlsUrl: derivative?.hlsUrl ?? null,
      isGifted: Boolean(viewerGift),
      creator,
      likesCount: _count.likes,
      commentsCount: _count.comments,
      savesCount: _count.saves,
      shares: _count.shares,
      reposts: _count.reposts,
      gifts: gifts._sum.quantity || 0,
      isReposted: userId ? (reposts?.length ?? 0) > 0 : false,
      isLiked: userId ? (likes?.length ?? 0) > 0 : false,
      isSaved: userId ? (saves?.length ?? 0) > 0 : false,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// REEL INTERACTIONS
// ============================================================================

export const likeReel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const reelId = req.params.id;
    const reel = await prisma.video.findUnique({ where: { id: reelId, moderationRemovedAt: null } });
    if (!reel) { res.status(404).json({ error: "Reel not found" }); return; }

    const existing = await prisma.videoLike.findUnique({
      where: { userId_videoId: { userId, videoId: reelId } },
    });

    if (existing) {
      await prisma.videoLike.delete({ where: { id: existing.id } });
      res.status(200).json({ liked: false });
    } else {
      await prisma.videoLike.create({ data: { userId, videoId: reelId } });
      res.status(200).json({ liked: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const commentOnReel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { content } = req.body;
    if (!content || !content.trim()) {
      res.status(400).json({ error: "Content is required" });
      return;
    }

    const reelId = req.params.id;
    const reel = await prisma.video.findUnique({ where: { id: reelId, moderationRemovedAt: null } });
    if (!reel) { res.status(404).json({ error: "Reel not found" }); return; }

    const comment = await prisma.videoComment.create({
      data: {
        userId,
        videoId: reelId,
        content: content.trim(),
      },
      include: {
        user: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
        _count: { select: { likes: true } },
      },
    });

    const { user, _count, ...rest } = comment as any;
    res.status(201).json({ ...rest, user: enrichPublicUser(user), liked: false, _count: { likes: _count.likes, replies: 0 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getReelComments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const userId = req.user?.userId;

    const comments = await prisma.videoComment.findMany({
      where: { videoId: req.params.id, moderationRemovedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT } },
        likes: userId ? { where: { userId }, select: { id: true } } : false,
        _count: { select: { likes: true } },
      },
    });

    const nextCursor = comments.length > limit ? comments.pop()?.id : undefined;
    const items = comments.map((comment: any) => {
      const { likes, _count, user, ...rest } = comment;
      return {
        ...rest,
        user: enrichPublicUser(user),
        liked: userId ? Boolean(likes?.length) : false,
        _count: { likes: _count?.likes ?? 0, replies: 0 },
      };
    });
    res.status(200).json({ items, nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const likeReelComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const commentId = req.params.commentId;
    const comment = await prisma.videoComment.findUnique({
      where: { id: commentId },
      select: { id: true, videoId: true },
    });
    if (!comment || comment.videoId !== req.params.id) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const existing = await prisma.videoCommentLike.findUnique({
      where: { userId_commentId: { userId, commentId } },
    });
    const liked = !existing;
    if (existing) {
      await prisma.videoCommentLike.delete({ where: { id: existing.id } });
    } else {
      await prisma.videoCommentLike.create({ data: { userId, commentId } });
    }
    const count = await prisma.videoCommentLike.count({ where: { commentId } });
    res.status(200).json({ liked, likes: count });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const shareReel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const reelId = req.params.id;
    const reel = await prisma.video.findUnique({ where: { id: reelId, publishStatus: "PUBLISHED", moderationRemovedAt: null }, select: { id: true } });
    if (!reel) { res.status(404).json({ error: "Reel not found" }); return; }
    await prisma.reelShare.create({ data: { userId, videoId: reelId } });
    const shares = await prisma.reelShare.count({ where: { videoId: reelId } });
    res.status(200).json({ shared: true, shares });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const repostReel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const reelId = req.params.id;
    const reel = await prisma.video.findUnique({ where: { id: reelId, publishStatus: "PUBLISHED", moderationRemovedAt: null }, select: { id: true } });
    if (!reel) { res.status(404).json({ error: "Reel not found" }); return; }
    const existing = await prisma.reelRepost.findUnique({ where: { userId_videoId: { userId, videoId: reelId } } });
    const reposted = !existing;
    if (existing) await prisma.reelRepost.delete({ where: { id: existing.id } });
    else await prisma.reelRepost.create({ data: { userId, videoId: reelId } });
    const reposts = await prisma.reelRepost.count({ where: { videoId: reelId } });
    res.status(200).json({ reposted, reposts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const saveReel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const reelId = req.params.id;
    const reel = await prisma.video.findUnique({ where: { id: reelId, moderationRemovedAt: null } });
    if (!reel) { res.status(404).json({ error: "Reel not found" }); return; }

    const existing = await prisma.videoSave.findUnique({
      where: { userId_videoId: { userId, videoId: reelId } },
    });

    if (existing) {
      await prisma.videoSave.delete({ where: { id: existing.id } });
      res.status(200).json({ saved: false });
    } else {
      await prisma.videoSave.create({ data: { userId, videoId: reelId } });
      res.status(200).json({ saved: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const incrementReelViews = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const reelId = req.params.id;
    const watchTime = Math.max(0, Math.min(Number(req.body?.watchTime) || 0, 86_400));
    const completed = Boolean(req.body?.completed);
    const reel = await prisma.video.findUnique({ where: { id: reelId, moderationRemovedAt: null }, select: { id: true } });
    if (!reel) { res.status(404).json({ error: "Reel not found" }); return; }
    if (watchTime < 2) { res.status(400).json({ error: "A Reel view requires at least 2 seconds of playback" }); return; }

    await prisma.watchHistory.upsert({
        where: { userId_videoId: { userId, videoId: reelId } },
        create: { userId, videoId: reelId, watchTime, completed },
        update: { watchTime: { increment: watchTime }, ...(completed ? { completed: true } : {}) },
      });
    const result = await contentViewService.record("REEL", reelId, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const deleteReel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const reelId = req.params.id;
    const reel = await prisma.video.findUnique({ where: { id: reelId, moderationRemovedAt: null } });
    if (!reel) { res.status(404).json({ error: "Reel not found" }); return; }
    if (reel.creatorId !== userId && req.user?.role !== "ADMIN") {
      res.status(403).json({ error: "Unauthorized to delete this reel" });
      return;
    }

    // Remove the uploaded media rows + physical files first so a deleted Reel
    // never leaves broken media references behind.
    const files = await prisma.uploadedFile.findMany({
      where: { recordType: "Video", recordId: reelId, deletedAt: null },
    });
    await Promise.all(files.map(file => uploadService.deleteFile(file.filename, file.id)));

    await prisma.video.delete({ where: { id: reelId, moderationRemovedAt: null } });
    res.status(200).json({ message: "Reel deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};