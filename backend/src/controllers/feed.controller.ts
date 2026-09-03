import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { feedService, uploadService } from "../services";

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
    const feed = await feedService.getHomeFeed(userId, cursor, limit);
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

    const { content, mediaUrl, mediaFileId } = req.body;
    if (!content || !content.trim()) {
      res.status(400).json({ error: "Content is required" });
      return;
    }

    const post = await feedService.createPost(userId, content.trim(), mediaUrl);
    if (typeof mediaFileId === "string") {
      try {
        await uploadService.linkFile(mediaFileId, userId, "Post", post.id, ["post-image", "post-video", "post-media", "generic"]);
      } catch (error) {
        await feedService.deletePost(post.id, userId);
        throw error;
      }
    }
    res.status(201).json(post);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
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
    if (!content || !content.trim()) {
      res.status(400).json({ error: "Content is required" });
      return;
    }

    const comment = await feedService.commentOnPost(req.params.id, userId, content.trim(), typeof parentId === "string" ? parentId : undefined);
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