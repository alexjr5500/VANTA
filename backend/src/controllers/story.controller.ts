import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { storyService, uploadService } from "../services";
import { prisma } from "../prisma";

export const createStory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const existingFileId = typeof req.body.mediaFileId === "string" ? req.body.mediaFileId : undefined;
    if (!req.file && !existingFileId) { res.status(400).json({ error: "Media file is required" }); return; }

    let fileId: string;
    let mediaUrl: string;
    let mediaType: "VIDEO" | "IMAGE";
    if (req.file) {
      const result = await uploadService.uploadFile(req, req.file, {
        category: "story", recordType: "Story", recordId: undefined,
      });
      fileId = result.id;
      mediaUrl = result.url;
      mediaType = result.type === "VIDEO" ? "VIDEO" : "IMAGE";
    } else {
      const existing = await prisma.uploadedFile.findUnique({ where: { id: existingFileId! } });
      if (!existing || existing.deletedAt || existing.userId !== userId || !["IMAGE", "VIDEO"].includes(existing.fileType)) {
        res.status(403).json({ error: "Uploaded story media was not found or is not owned by you" }); return;
      }
      fileId = existing.id;
      mediaUrl = existing.url;
      mediaType = existing.fileType === "VIDEO" ? "VIDEO" : "IMAGE";
    }
    const caption = typeof req.body.caption === "string" ? req.body.caption.trim() : undefined;

    const story = await storyService.createStory(userId, mediaUrl, mediaType, caption);

    // Link file to story
    await prisma.uploadedFile.update({
      where: { id: fileId },
      data: { recordType: "Story", recordId: story.id, category: "story" },
    });

    res.status(201).json(story);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getStories = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const stories = await storyService.getActiveStories(userId);
    res.status(200).json(stories);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getStoryById = async (req: Request, res: Response): Promise<void> => {
  try {
    const story = await storyService.getStoryById(req.params.id);
    if (!story) { res.status(404).json({ error: "Story not found" }); return; }
    res.status(200).json(story);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const viewStory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const result = await storyService.viewStory(req.params.id, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const deleteStory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    await storyService.deleteStory(req.params.id, userId);
    const files = await prisma.uploadedFile.findMany({ where: { recordType: "Story", recordId: req.params.id, deletedAt: null } });
    await Promise.all(files.map(file => uploadService.deleteFile(file.filename, file.id)));
    res.status(200).json({ message: "Story deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const reshareStory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!req.params.id) { res.status(400).json({ error: "Story id is required" }); return; }
    const caption = typeof req.body?.caption === "string" ? req.body.caption : undefined;
    const story = await storyService.reshareStory(userId, req.params.id, caption);
    res.status(201).json(story);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(message.startsWith("Story") ? 404 : 400).json({ error: message });
  }
};

export const likeStory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const result = await storyService.likeStory(req.params.id, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(message.startsWith("Story") ? 404 : 400).json({ error: message });
  }
};

export const unlikeStory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const result = await storyService.unlikeStory(req.params.id, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getStoryComments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const comments = await storyService.getComments(req.params.id);
    res.status(200).json(comments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const addStoryComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const comment = await storyService.addComment(req.params.id, userId, content);
    res.status(201).json(comment);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(message.startsWith("Story") ? 404 : 400).json({ error: message });
  }
};

export const getStoryViewers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const viewers = await storyService.getStoryViewers(req.params.id, userId);
    res.status(200).json(viewers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(message === "Forbidden" ? 403 : message === "Story not found" ? 404 : 400).json({ error: message });
  }
};