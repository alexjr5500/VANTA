import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { chunkUploadService } from "../services";

// ============================================================================
// RESUMABLE / CHUNKED UPLOAD ENDPOINTS
// ============================================================================
// `POST /api/upload/chunk/init`      — create a session (declared sizes/types).
// `POST /api/upload/chunk/part`       — stream one part (multipart: sessionId, index, chunk).
// `GET  /api/upload/chunk/:sessionId` — received-state (for resume after failures).
// `POST /api/upload/chunk/complete`   — reassemble + persist through the existing pipeline.
// `POST /api/upload/chunk/:sessionId/abort` — cancel (server cleanup).
// All routes sit behind `authenticateJWT` at the router level.

export const initChunkUpload = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const session = await chunkUploadService.initChunkSession(userId, {
      fileName: typeof req.body?.fileName === "string" ? req.body.fileName : "upload",
      fileSize: typeof req.body?.fileSize === "number" ? req.body.fileSize : Number(req.body?.fileSize),
      mimeType: typeof req.body?.mimeType === "string" ? req.body.mimeType : "",
      category: typeof req.body?.category === "string" ? req.body.category : "generic",
      recordType: typeof req.body?.recordType === "string" ? req.body.recordType : undefined,
      recordId: typeof req.body?.recordId === "string" ? req.body.recordId : undefined,
    });
    res.status(201).json({
      sessionId: session.id,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      fileSize: session.fileSize,
      mimeType: session.mimeType,
      category: session.category,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload init failed";
    res.status(400).json({ error: message });
  }
};

export const uploadChunkPart = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    const result = await chunkUploadService.acceptChunkPart(userId, sessionId, req.body?.index, req.file);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chunk upload failed";
    res.status(400).json({ error: message });
  }
};

export const getChunkUploadState = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const result = await chunkUploadService.getChunkState(userId, req.params.sessionId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read upload state";
    res.status(400).json({ error: message });
  }
};

export const completeChunkUpload = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    const result = await chunkUploadService.completeChunkSession(req, sessionId, {
      category: typeof req.body?.category === "string" ? req.body.category : undefined,
      recordType: typeof req.body?.recordType === "string" ? req.body.recordType : undefined,
      recordId: typeof req.body?.recordId === "string" ? req.body.recordId : undefined,
    });
    res.status(200).json({ message: "Upload completed", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload completion failed";
    res.status(400).json({ error: message });
  }
};

export const abortChunkUpload = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const result = await chunkUploadService.cancelChunkSession(userId, req.params.sessionId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cancel failed";
    res.status(400).json({ error: message });
  }
};

export const failChunkUpload = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const result = await chunkUploadService.failChunkSession(userId, req.params.sessionId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not mark upload failed";
    res.status(400).json({ error: message });
  }
};