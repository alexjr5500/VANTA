import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { feedService, uploadService } from "../services";
import { prisma } from "../prisma";
import { cacheService, CACHE_KEYS } from "../services/cache.service";
import { parseReplyAudience } from "../security/replyAudience";

const parseLimit = (value: unknown, defaultLimit = 20) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, 50);
};

export const getFeed = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const feed = await feedService.getFeed(userId, cursor, limit);
    res.status(200).json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getHomeFeed = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 15);
    // Per-session feed seed (client-generated on refresh). A new seed produces a
    // fresh, varied ordering of eligible discovery content; a stable seed keeps
    // pagination consistent within the session. Bounded to a safe length.
    const rawSeed = typeof req.query.seed === "string" ? req.query.seed : undefined;
    const seed = rawSeed && /^[a-zA-Z0-9_-]{1,64}$/.test(rawSeed) ? rawSeed : undefined;
    const feed = await feedService.getHomeFeed(userId, cursor, limit, seed);
    res.status(200).json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getTrendingFeed = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const feed = await feedService.getTrendingFeed(cursor, limit);
    res.status(200).json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getExploreFeed = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 30);
    const feed = await feedService.getExploreFeed(cursor, limit);
    res.status(200).json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const createPost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { content, mediaUrl, mediaFileId, media } = req.body;
    const replyAudience = parseReplyAudience(req.body.replyAudience);

    const caption = typeof content === "string" ? content.trim() : "";

    // Multi-attachment contract (additive + backward compatible).
    //   media.fileIds / media.urls  -> ordered VANTA multi-media post
    //   mediaFileId / mediaUrl      -> legacy single-attachment clients
    // Everything selected in one composer is uploaded individually and linked
    // to the SAME post, so a multi-media post really stores every attachment.
    const mediaFileIds: string[] = Array.isArray(media?.fileIds)
      ? media.fileIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const mediaUrls: string[] = Array.isArray(media?.urls)
      ? media.urls.filter((value: unknown): value is string => typeof value === "string")
      : [];
    if (!mediaFileIds.length && typeof mediaFileId === "string") mediaFileIds.push(mediaFileId);

    // The primary URL keeps the legacy `media` field working for every existing
    // consumer (home feed, profile, search, share previews…).
    const primaryUrl =
      mediaUrls[0] ?? (typeof mediaUrl === "string" ? mediaUrl : undefined);

    // A video uploaded through Create Post is a Reel, not a second kind of
    // video hidden inside Posts. Split mixed selections without duplicating
    // media: image files remain a Post; each video becomes a published Reel.
    // Existing Upload Reel uses the same Video table and appears in the same
    // Reels feed. Use the trusted UploadedFile rows, never client-supplied URLs.
    const uniqueFileIds = [...new Set(mediaFileIds)];
    if (uniqueFileIds.length > 10) {
      res.status(400).json({ error: "Choose up to 10 media files per post" });
      return;
    }
    if (!caption && !uniqueFileIds.length && !primaryUrl) {
      res.status(400).json({ error: "Content or media is required" });
      return;
    }

    if (uniqueFileIds.length) {
      const owned = await prisma.uploadedFile.findMany({
        where: { id: { in: uniqueFileIds }, userId, deletedAt: null },
        select: { id: true, url: true, fileType: true, category: true, recordType: true },
      });
      if (owned.length !== uniqueFileIds.length) {
        res.status(400).json({ error: "One or more media uploads are missing or not owned by you" });
        return;
      }
      const byId = new Map(owned.map(file => [file.id, file]));
      const ordered = uniqueFileIds.map(id => byId.get(id)!);
      const videos = ordered.filter(file => file.fileType === "VIDEO");
      if (videos.length) {
        if (ordered.some(file =>
          (file.fileType !== "VIDEO" && file.fileType !== "IMAGE") ||
          !["post-image", "post-video", "post-media", "generic"].includes(file.category) ||
          file.recordType !== null || !file.url
        )) {
          res.status(400).json({ error: "Select new photo and video uploads before publishing" });
          return;
        }
        const photos = ordered.filter(file => file.fileType === "IMAGE");
        // Publish atomically. A failure must never leave a visible Reel
        // without a linked file or a half-created mixed-media Post.
        const created = await prisma.$transaction(async tx => {
          const photoPost = photos.length
            ? await tx.post.create({ data: { authorId: userId, content: caption, mediaUrl: photos[0].url, replyAudience } })
            : null;
          for (const file of photos) {
            const linked = await tx.uploadedFile.updateMany({
              where: { id: file.id, userId, deletedAt: null, recordType: null },
              data: { recordType: "Post", recordId: photoPost!.id },
            });
            if (linked.count !== 1) throw new Error("Photo upload was already used");
          }
          const reels = [];
          for (const file of videos) {
            const reel = await tx.video.create({
              data: {
                creatorId: userId,
                title: caption.slice(0, 120) || "Reel",
                description: caption || undefined,
                videoUrl: file.url,
                publishStatus: "PUBLISHED",
                replyAudience,
              },
            });
            const linked = await tx.uploadedFile.updateMany({
              where: { id: file.id, userId, deletedAt: null, recordType: null },
              data: { recordType: "Video", recordId: reel.id, category: "reel" },
            });
            if (linked.count !== 1) throw new Error("Video upload was already used");
            reels.push(reel);
          }
          return { photoPost, reels };
        });
        await Promise.allSettled([
          cacheService.delPattern(`feed:${userId}:*`),
          cacheService.delPattern("homefeed:*"),
          cacheService.del(CACHE_KEYS.TRENDING),
          cacheService.del(CACHE_KEYS.EXPLORE),
        ]);
        res.status(201).json({
          id: created.photoPost?.id ?? `video-${created.reels[0].id}`,
          type: created.photoPost ? "post" : "reel",
          post: created.photoPost,
          reels: created.reels,
        });
        return;
      }
    }

    const post = await feedService.createPost(userId, caption, primaryUrl, replyAudience);

    // Link EVERY selected upload to this post. UploadedFile rows already key on
    // (recordType, recordId), so N attachments per post need no schema change.
    const linked: string[] = [];
    try {
      for (const fileId of mediaFileIds) {
        await uploadService.linkFile(fileId, userId, "Post", post.id, ["post-image", "post-video", "post-media", "generic"]);
        linked.push(fileId);
      }
    } catch (error) {
      // Never leave a half-linked post behind: undo the links we made, delete
      // the post, and surface the real reason to the client.
      await Promise.all(
        linked.map((fileId) =>
          prismaUnlinkFile(fileId).catch(() => undefined)
        )
      );
      await feedService.deletePost(post.id, userId);
      throw error;
    }

    res.status(201).json({
      ...post,
      attachments: mediaUrls.map((url, index) => ({ url, fileId: mediaFileIds[index] })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

/** Detach an uploaded file without deleting the stored asset. */
const prismaUnlinkFile = async (fileId: string) => {
  const { prisma } = await import("../prisma");
  return prisma.uploadedFile.update({
    where: { id: fileId },
    data: { recordType: null, recordId: null },
  });
};

export const deletePost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    await feedService.deletePost(req.params.id, userId);
    const files = await prismaUploadFiles("Post", req.params.id);
    await Promise.all(files.map(file => uploadService.deleteFile(file.filename, file.id)));
    res.status(200).json({ message: "Post deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

const prismaUploadFiles = async (recordType: string, recordId: string) => {
  const { prisma } = await import("../prisma");
  return prisma.uploadedFile.findMany({ where: { recordType, recordId, deletedAt: null } });
};

export const likePost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const result = await feedService.likePost(req.params.id, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const commentOnPost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { content, parentId } = req.body;
    const cleanContent = typeof content === "string" ? content.trim() : "";
    const mediaFileIds = Array.isArray(req.body.mediaFileIds)
      ? req.body.mediaFileIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    if (!cleanContent && mediaFileIds.length === 0) {
      res.status(400).json({ error: "Write a comment or attach an image or video." });
      return;
    }

    const comment = await feedService.commentOnPost(req.params.id, userId, cleanContent, typeof parentId === "string" ? parentId : undefined, mediaFileIds);
    res.status(201).json(comment);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getPostComments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const sort = req.query.sort === "top" ? "top" : "newest";
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : undefined;
    const comments = await feedService.getPostComments(req.params.id, userId, cursor, limit, sort, search);
    res.status(200).json(comments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const updatePostComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!content) { res.status(400).json({ error: "Content is required" }); return; }
    res.status(200).json(await feedService.updateComment(req.params.commentId, userId, content));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
};

export const deletePostComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    res.status(200).json(await feedService.deleteComment(req.params.commentId, userId, req.user?.role));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
};

export const likePostComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    res.status(200).json(await feedService.likeComment(req.params.commentId, userId));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
};

export const getPostCommentReplies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    res.status(200).json(await feedService.getCommentReplies(req.params.id, req.params.commentId, userId, cursor, parseLimit(req.query.limit, 20)));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Internal server error" }); }
};

export const reportPostComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().toUpperCase() : "";
    const allowed = ["SPAM", "HARASSMENT", "HATE", "THREATS", "MISINFORMATION", "OTHER"];
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!allowed.includes(reason)) { res.status(400).json({ error: "A valid report reason is required" }); return; }
    res.status(201).json(await feedService.reportComment(req.params.commentId, userId, reason, typeof req.body?.description === "string" ? req.body.description.slice(0, 500) : undefined));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Internal server error" }); }
};

export const getFollowers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const followers = await feedService.getFollowers(userId, cursor, limit);
    res.status(200).json(followers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getFollowing = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const following = await feedService.getFollowing(userId, cursor, limit);
    res.status(200).json(following);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};