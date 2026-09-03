import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../prisma";
import { contentViewService } from "../services/content-view.service";

const parseLimit = (value: unknown, defaultLimit = 20) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, 50);
};

// ============================================================================
// GET REELS
// ============================================================================

export const getReels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const feed = req.query.feed === "following" || req.query.feed === "trending" ? req.query.feed : "for-you";
    const where = feed === "following" && userId
      ? { creator: { followers: { some: { followerId: userId } } } }
      : feed === "following"
        ? { id: "__authenticated_following_feed__" }
        : undefined;

    const orderBy = feed === "trending"
      ? [{ views: "desc" as const }, { createdAt: "desc" as const }]
      : feed === "following"
        ? [{ createdAt: "desc" as const }]
        : [{ views: "desc" as const }, { createdAt: "desc" as const }];

    const reels = await prisma.video.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
            verified: true,
          },
        },
        likes: userId ? { where: { userId }, select: { id: true } } : false,
        saves: userId ? { where: { userId }, select: { id: true } } : false,
        _count: { select: { likes: true, comments: true, saves: true } },
      },
    });

    const followingCreatorIds = userId
      ? new Set((await prisma.follow.findMany({
          where: { followerId: userId, followingId: { in: reels.map((reel) => reel.creatorId) } },
          select: { followingId: true },
        })).map((follow) => follow.followingId))
      : new Set<string>();

    const nextCursor = reels.length > limit ? reels.pop()?.id : undefined;

    res.status(200).json({
      items: reels.map((reel: any) => ({
        id: reel.id,
        title: reel.title,
        description: reel.description,
        videoUrl: reel.videoUrl,
        thumbnailUrl: reel.thumbnailUrl,
        duration: reel.duration,
        views: reel.views,
        likes: reel._count.likes,
        comments: reel._count.comments,
        saves: reel._count.saves,
        isLiked: userId ? reel.likes?.length > 0 : false,
        isSaved: userId ? reel.saves?.length > 0 : false,
        isFollowing: followingCreatorIds.has(reel.creatorId),
        author: {
          ...reel.creator,
          isFollowing: followingCreatorIds.has(reel.creatorId),
        },
        createdAt: reel.createdAt,
      })),
      nextCursor,
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

export const getReelById = async (req: Request, res: Response): Promise<void> => {
  try {
    const reel = await prisma.video.findUnique({
      where: { id: req.params.id },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
            verified: true,
          },
        },
        _count: { select: { likes: true, comments: true, saves: true } },
      },
    });

    if (!reel) {
      res.status(404).json({ error: "Reel not found" });
      return;
    }

    res.status(200).json(reel);
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
    const reel = await prisma.video.findUnique({ where: { id: reelId } });
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
    const reel = await prisma.video.findUnique({ where: { id: reelId } });
    if (!reel) { res.status(404).json({ error: "Reel not found" }); return; }

    const comment = await prisma.videoComment.create({
      data: {
        userId,
        videoId: reelId,
        content: content.trim(),
      },
      include: {
        user: { select: { id: true, username: true, fullName: true, avatar: true } },
      },
    });

    res.status(201).json(comment);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getReelComments = async (req: Request, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);

    const comments = await prisma.videoComment.findMany({
      where: { videoId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: { select: { id: true, username: true, fullName: true, avatar: true } },
      },
    });

    const nextCursor = comments.length > limit ? comments.pop()?.id : undefined;
    res.status(200).json({ items: comments, nextCursor });
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
    const reel = await prisma.video.findUnique({ where: { id: reelId } });
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
    const reel = await prisma.video.findUnique({ where: { id: reelId }, select: { id: true } });
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
    const reel = await prisma.video.findUnique({ where: { id: reelId } });
    if (!reel) { res.status(404).json({ error: "Reel not found" }); return; }
    if (reel.creatorId !== userId && req.user?.role !== "ADMIN") {
      res.status(403).json({ error: "Unauthorized to delete this reel" });
      return;
    }

    await prisma.video.delete({ where: { id: reelId } });
    res.status(200).json({ message: "Reel deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};