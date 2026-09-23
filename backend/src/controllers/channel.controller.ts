import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { channelService } from "../services";
import { sendError, AppError, badRequest } from "../utils/api-error";

const parseLimit = (value: unknown, defaultLimit = 20) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, 50);
};

export const createChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const { name, description, category, memberIds, avatar, handle, visibility } = req.body;
    if (!name || !name.trim()) throw badRequest("VALIDATION_ERROR", "Please give your channel a name.");

    const channel = await channelService.createChannel(userId, name.trim(), description, category, memberIds, avatar, handle, visibility);
    res.status(201).json(channel);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "createChannel" } });
  }
};

export const getChannels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const channels = await channelService.getChannels(cursor, limit);
    res.status(200).json(channels);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "getChannels" } });
  }
};

export const getChannelById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");
    const channel = await channelService.getChannelById(req.params.id, userId);
    if (!channel) throw new AppError(404, "NOT_FOUND", "This channel is no longer available.");
    res.status(200).json(channel);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "getChannelById", id: req.params.id } });
  }
};

export const updateChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");
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
    sendError(res, error, { diagnostic: { action: "updateChannel", id: req.params.id } });
  }
};

export const joinChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const result = await channelService.joinChannel(req.params.id, userId);
    res.status(200).json(result);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "joinChannel", id: req.params.id } });
  }
};

export const leaveChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    await channelService.leaveChannel(req.params.id, userId);
    res.status(200).json({ message: "Left channel" });
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "leaveChannel", id: req.params.id } });
  }
};

export const sendChannelMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const { content } = req.body;
    if (!content || !content.trim()) throw badRequest("VALIDATION_ERROR", "Message content is required.");

    const message = await channelService.sendMessage(req.params.id, userId, content.trim());
    res.status(201).json(message);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "sendChannelMessage", id: req.params.id } });
  }
};

export const getChannelMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 50);
    const messages = await channelService.getMessages(req.params.id, cursor, limit);
    res.status(200).json(messages);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "getChannelMessages", id: req.params.id } });
  }
};

export const deleteChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    await channelService.deleteChannel(req.params.id, userId);
    res.status(200).json({ message: "Channel deleted" });
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "deleteChannel", id: req.params.id } });
  }
};