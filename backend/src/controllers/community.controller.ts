import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { communityService } from "../services";

const parseLimit = (value: unknown, defaultLimit = 20) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
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