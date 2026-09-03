import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { groupService } from "../services";

const parseLimit = (value: unknown, defaultLimit = 50) => {
  const parsed = typeof value === "string" ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, 100);
};

export const createGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { name, description, memberIds, avatar } = req.body;
    if (!name || !name.trim()) { res.status(400).json({ error: "Name is required" }); return; }

    const group = await groupService.createGroup(userId, name.trim(), description, memberIds, avatar);
    res.status(201).json(group);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getMyGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const groups = await groupService.getMyGroups(userId);
    res.status(200).json(groups);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getGroupById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const group = await groupService.getGroupById(req.params.id, userId);
    if (!group) { res.status(404).json({ error: "Group not found" }); return; }
    res.status(200).json(group);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const updateGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

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
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("not found") ? 404 : message.includes("Unauthorized") || message.includes("administrators") ? 403 : 400;
    res.status(status).json({ error: message });
  }
};

export const addGroupMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { targetUserId } = req.body;
    if (!targetUserId) { res.status(400).json({ error: "Target user ID is required" }); return; }

    const member = await groupService.addMember(req.params.id, targetUserId, userId);
    res.status(200).json(member);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const removeGroupMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { targetUserId } = req.params;
    await groupService.removeMember(req.params.id, targetUserId || userId, userId);
    res.status(200).json({ message: "Member removed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const sendGroupMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { content } = req.body;
    if (!content || !content.trim()) { res.status(400).json({ error: "Content is required" }); return; }

    const message = await groupService.sendMessage(req.params.id, userId, content.trim());
    res.status(201).json(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getGroupMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 50);
    const messages = await groupService.getMessages(req.params.id, cursor, limit);
    res.status(200).json(messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const deleteGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    await groupService.deleteGroup(req.params.id, userId);
    res.status(200).json({ message: "Group deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};