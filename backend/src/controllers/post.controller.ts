import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { postService } from "../services/post.service";

export const savePost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const result = await postService.savePost(userId, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const unsavePost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const result = await postService.unsavePost(userId, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getSavedPosts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = Math.min(parseInt(typeof req.query.limit === "string" ? req.query.limit : "20", 10) || 20, 50);
    const result = await postService.getSavedPosts(userId, cursor, limit);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const sharePost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const destination = typeof req.body?.destination === "string" ? req.body.destination.slice(0, 40) : "COPY_LINK";
    const result = await postService.sharePost(req.params.id, userId, destination);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getPostById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const post = await postService.getPostById(req.params.id, userId);
    res.status(200).json(post);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(404).json({ error: message });
  }
};

export const viewPost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const result = await postService.viewPost(req.params.id, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(message === "Post not found" ? 404 : 400).json({ error: message });
  }
};