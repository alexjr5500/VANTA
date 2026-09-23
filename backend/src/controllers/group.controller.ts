import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { groupService } from "../services";
import { sendError, AppError, badRequest } from "../utils/api-error";

const parseLimit = (value: unknown, defaultLimit = 50) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, 100);
};

export const createGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const { name, description, memberIds, avatar } = req.body;
    if (!name || !name.trim()) throw badRequest("VALIDATION_ERROR", "Please give your group a name.");

    const group = await groupService.createGroup(userId, name.trim(), description, memberIds, avatar);
    res.status(201).json(group);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "createGroup" } });
  }
};

export const getMyGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const groups = await groupService.getMyGroups(userId);
    res.status(200).json(groups);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "getMyGroups" } });
  }
};

export const getGroupById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");
    const group = await groupService.getGroupById(req.params.id, userId);
    if (!group) throw new AppError(404, "NOT_FOUND", "This group is no longer available.");
    res.status(200).json(group);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "getGroupById", id: req.params.id } });
  }
};

export const updateGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const { name, description, avatar, memberIds, memberRoles, permissions } = req.body;
    const group = await groupService.updateGroup(req.params.id, userId, {
      name: typeof name === "string" ? name : undefined,
      description: typeof description === "string" ? description : undefined,
      avatar: typeof avatar === "string" || avatar === null ? avatar : undefined,
      memberIds: Array.isArray(memberIds) ? memberIds.filter((id: unknown) => typeof id === "string") : undefined,
      memberRoles: memberRoles && typeof memberRoles === "object" ? memberRoles : undefined,
      permissions: permissions && typeof permissions === "object" ? permissions : undefined,
    });
    res.status(200).json(group);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "updateGroup", id: req.params.id } });
  }
};

export const addGroupMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const { targetUserId } = req.body;
    if (!targetUserId) throw badRequest("VALIDATION_ERROR", "Please choose a member to add.");

    const member = await groupService.addMember(req.params.id, targetUserId, userId);
    res.status(200).json(member);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "addGroupMember", id: req.params.id } });
  }
};

export const removeGroupMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const { targetUserId } = req.params;
    await groupService.removeMember(req.params.id, targetUserId || userId, userId);
    res.status(200).json({ message: "Member removed" });
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "removeGroupMember", id: req.params.id } });
  }
};

export const joinGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const result = await groupService.joinGroup(req.params.id, userId);
    res.status(200).json(result);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "joinGroup", id: req.params.id } });
  }
};

export const sendGroupMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    const { content } = req.body;
    if (!content || !content.trim()) throw badRequest("VALIDATION_ERROR", "Message content is required.");

    const message = await groupService.sendMessage(req.params.id, userId, content.trim());
    res.status(201).json(message);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "sendGroupMessage", id: req.params.id } });
  }
};

export const getGroupMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 50);
    const messages = await groupService.getMessages(req.params.id, cursor, limit);
    res.status(200).json(messages);
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "getGroupMessages", id: req.params.id } });
  }
};

export const deleteGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");

    await groupService.deleteGroup(req.params.id, userId);
    res.status(200).json({ message: "Group deleted" });
  } catch (error) {
    sendError(res, error, { diagnostic: { action: "deleteGroup", id: req.params.id } });
  }
};