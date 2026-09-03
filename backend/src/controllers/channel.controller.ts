import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { channelService } from "../services";

const parseLimit = (value: unknown, defaultLimit = 20) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, 50);
};

export const createChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { name, description, category, memberIds, avatar, handle, visibility } = req.body;
    if (!name || !name.trim()) { res.status(400).json({ error: "Name is required" }); return; }

    const channel = await channelService.createChannel(userId, name.trim(), description, category, memberIds, avatar, handle, visibility);
    res.status(201).json(channel);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getChannels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const channels = await channelService.getChannels(cursor, limit);
    res.status(200).json(channels);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getChannelById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const channel = await channelService.getChannelById(req.params.id, userId);
    if (!channel) { res.status(404).json({ error: "Channel not found" }); return; }
    res.status(200).json(channel);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const updateChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { name, description, avatar, category, visibility, handle, memberIds, memberRoles, permissions } = req.body;
    const channel = await channelService.updateChannel(req.params.id, userId, {
      name: typeof name === "string" ? name : undefined,
      description: typeof description === "string" ? description : undefined,
      avatar: typeof avatar === "string" || avatar === null ? avatar : undefined,
      category: typeof category === "string" ? category : undefined,
      visibility: typeof visibility === "string" ? visibility : undefined,
      handle: typeof handle === "string" ? handle : undefined,
      memberIds: Array.isArray(memberIds) ? memberIds.filter((id: unknown): id is string => typeof id === "string") : undefined,
      memberRoles: memberRoles && typeof memberRoles === "object" ? memberRoles : undefined,
      permissions: permissions && typeof permissions === "object" ? permissions : undefined,
    });
    res.status(200).json(channel);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("not found") ? 404 : message.includes("administrators") ? 403 : 400;
    res.status(status).json({ error: message });
  }
};

export const joinChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const result = await channelService.joinChannel(req.params.id, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const leaveChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    await channelService.leaveChannel(req.params.id, userId);
    res.status(200).json({ message: "Left channel" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const sendChannelMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { content } = req.body;
    if (!content || !content.trim()) { res.status(400).json({ error: "Content is required" }); return; }

    const message = await channelService.sendMessage(req.params.id, userId, content.trim());
    res.status(201).json(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getChannelMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 50);
    const messages = await channelService.getMessages(req.params.id, cursor, limit);
    res.status(200).json(messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const deleteChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    await channelService.deleteChannel(req.params.id, userId);
    res.status(200).json({ message: "Channel deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};