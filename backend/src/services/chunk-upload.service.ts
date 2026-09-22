import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import {
  uploadService,
  uploadStorageDir,
  UPLOAD_LIMITS,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_AUDIO_TYPES,
  ALLOWED_DOC_TYPES,
} from "./upload.service";
import { prisma } from "../prisma";

// ============================================================================
// RESUMABLE / CHUNKED UPLOADS (Story + Reel background publishing)
// ----------------------------------------------------------------------------
// Large media is sliced into fixed-size parts browser-side and streamed one part
// at a time. The server stages each part under `<uploadDir>/.chunks/<sessionId>`
// and reassembles the final file through the EXISTING `uploadService.uploadFile`
// pipeline (local disk or the auto-detected Cloudinary provider) — no new storage
// provider is introduced. A failed/interrupted transfer queries which parts
// already arrived (`getChunkState`) and resumes from there instead of restarting
// from zero.
// ============================================================================

export const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MiB per part
const CHUNK_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // sessions expire after 24h
const ALL_ALLOWED = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  ...ALLOWED_AUDIO_TYPES,
  ...ALLOWED_DOC_TYPES,
];

const normalizeMime = (value: string): string => String(value || "").toLowerCase().split(";")[0].trim();
const removeLocal = (filePath?: string): void => {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // best-effort cleanup
    }
  }
};

const sanitizeChunkFilename = (originalName: string): string => {
  const extension = path.extname(originalName || "").toLowerCase();
  const safeBase = path.basename(originalName || "upload", extension)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "") || `upload-${Date.now()}`;
  return `${safeBase}${extension}`;
};

const chunkStagingDir = (sessionId: string): string => path.join(uploadStorageDir, ".chunks", sessionId);

// Opaque-byte chunk staging. Parts are arbitrary slices of the original file, so
// multer applies NO MIME filter here; sizes/bounds are validated per-session below.
const chunksDiskStorage = multer.diskStorage({
  destination: (req: any, _file: Express.Multer.File, cb) => {
    const sessionId = String(req.body?.sessionId || "");
    if (!sessionId) {
      cb(new Error("sessionId is required"));
      return;
    }
    const dir = chunkStagingDir(sessionId);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      cb(error instanceof Error ? error : new Error("Could not stage upload chunk"));
      return;
    }
    cb(null, dir);
  },
  filename: (req: any, _file: Express.Multer.File, cb) => {
    const index = Math.floor(Number(req.body?.index));
    cb(null, `${String(Number.isFinite(index) && index >= 0 ? index : 0).padStart(6, "0")}.part`);
  },
});

/** Multer instance for a single chunk part (5 MiB + multipart overhead). */
export const uploadChunk = multer({
  storage: chunksDiskStorage,
  limits: { fileSize: UPLOAD_CHUNK_SIZE + 512 * 1024 },
});

interface InitChunkInput {
  fileName: string;
  fileSize: number;
  mimeType: string;
  category: string;
  recordType?: string;
  recordId?: string;
}

export class ChunkUploadService {
  /** Resolve the byte limit for a category + declared MIME type. */
  limitFor(category: string, mimeType: string): number {
    const normalized = normalizeMime(mimeType);
    const isImage = normalized.startsWith("image/");
    const isAudio = normalized.startsWith("audio/");
    switch (category) {
      case "avatar":
        return UPLOAD_LIMITS.AVATAR;
      case "banner":
        return UPLOAD_LIMITS.BANNER;
      case "thumbnail":
        return UPLOAD_LIMITS.THUMBNAIL;
      case "verification":
      case "document":
        return UPLOAD_LIMITS.DOCUMENT;
      default:
        if (isImage) return UPLOAD_LIMITS.IMAGE;
        if (isAudio) return UPLOAD_LIMITS.AUDIO;
        return UPLOAD_LIMITS.VIDEO;
    }
  }

  /** Create a resumable upload session owned by `userId`. */
  async initChunkSession(userId: string, input: InitChunkInput) {
    const fileName = String(input.fileName || "upload").slice(0, 255);
    const mimeType = normalizeMime(String(input.mimeType || ""));
    const category = String(input.category || "generic").slice(0, 50);
    const fileSize = Math.floor(Number(input.fileSize) || 0);

    if (!ALL_ALLOWED.includes(mimeType)) {
      throw new Error(`File type ${mimeType || "(empty)"} is not allowed`);
    }
    if (fileSize <= 0) {
      throw new Error("File size must be greater than zero.");
    }
    const limit = this.limitFor(category, mimeType);
    if (fileSize > limit) {
      const mb = Math.round(limit / (1024 * 1024));
      throw new Error(`File is too large — the ${mb} MB limit for ${category} was exceeded.`);
    }

    const totalChunks = Math.max(1, Math.ceil(fileSize / UPLOAD_CHUNK_SIZE));
    const session = await prisma.uploadSession.create({
      data: {
        userId,
        fileName,
        fileSize,
        mimeType,
        category,
        chunkSize: UPLOAD_CHUNK_SIZE,
        totalChunks,
        recordType: input.recordType || null,
        recordId: input.recordId || null,
        expiresAt: new Date(Date.now() + CHUNK_SESSION_TTL_MS),
      },
    });
    return session;
  }

  private async requireActiveSession(userId: string, sessionId: string) {
    const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new Error("Upload session not found.");
    }
    if (session.status !== "ACTIVE") {
      throw new Error("This upload session is no longer active.");
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new Error("This upload session has expired. Please restart the upload.");
    }
    return session;
  }

  /** Register a staged chunk part against the session and report the received set. */
  async acceptChunkPart(userId: string, sessionId: string, indexRaw: unknown, file?: Express.Multer.File) {
    const session = await this.requireActiveSession(userId, sessionId);
    const index = Math.floor(Number(indexRaw));
    if (!Number.isFinite(index) || index < 0 || index >= session.totalChunks) {
      removeLocal(file?.path);
      throw new Error(`Invalid chunk index ${index}.`);
    }
    if (
      !file?.path ||
      path.resolve(file.path) !== path.resolve(chunkStagingDir(sessionId), `${String(index).padStart(6, "0")}.part`)
    ) {
      removeLocal(file?.path);
      throw new Error("Chunk part could not be staged.");
    }
    if (file.size > session.chunkSize + 512 * 1024) {
      removeLocal(file.path);
      throw new Error("Chunk part exceeds the allowed size.");
    }

    const chunkDir = chunkStagingDir(sessionId);
    const receivedChunks = fs.existsSync(chunkDir)
      ? fs.readdirSync(chunkDir).filter((name) => name.endsWith(".part")).length
      : 0;
    await prisma.uploadSession.update({ where: { id: sessionId }, data: { receivedChunks } });
    return {
      sessionId,
      receivedChunks,
      totalChunks: session.totalChunks,
      chunkSize: session.chunkSize,
      complete: receivedChunks >= session.totalChunks,
    };
  }

  /** Report which parts already arrived (used to resume after a failure). */
  async getChunkState(userId: string, sessionId: string) {
    const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new Error("Upload session not found.");
    }
    const chunkDir = chunkStagingDir(sessionId);
    const receivedIndexes: number[] = [];
    if (fs.existsSync(chunkDir)) {
      for (const name of fs.readdirSync(chunkDir)) {
        const match = /^(\d{6})\.part$/.exec(name);
        if (match) receivedIndexes.push(Number(match[1]));
      }
    }
    const receivedChunks = receivedIndexes.length;
    return {
      sessionId,
      totalChunks: session.totalChunks,
      chunkSize: session.chunkSize,
      fileSize: session.fileSize,
      receivedChunks,
      receivedIndexes,
      complete: receivedChunks >= session.totalChunks,
    };
  }

  /** Reassemble staged parts and persist through the existing uploadFile pipeline. */
  async completeChunkSession(
    req: any,
    sessionId: string,
    options: { category?: string; recordType?: string; recordId?: string } = {}
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new Error("Authentication is required to upload files.");
    const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new Error("Upload session not found.");
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new Error("Upload session expired. Please upload again.");
    }

    if (session.status === "COMPLETE") {
      // Idempotent re-completion: return the already-uploaded file when present.
      const existing = await prisma.uploadedFile.findFirst({
        where: {
          userId,
          category: session.category,
          recordType: session.recordType,
          recordId: session.recordId,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        return {
          id: existing.id,
          url: existing.url,
          type: existing.fileType,
          filename: existing.filename,
          mimeType: existing.mimeType,
          size: existing.size,
          category: existing.category,
        };
      }
    }
    if (session.status === "FAILED" || session.status === "CANCELLED") {
      throw new Error("This upload session is closed. Please start a new upload.");
    }

    const chunkDir = chunkStagingDir(sessionId);
    if (!fs.existsSync(chunkDir)) {
      throw new Error("No upload chunks have been received yet.");
    }
    const received = fs.readdirSync(chunkDir).filter((name) => name.endsWith(".part"));
    if (received.length !== session.totalChunks) {
      throw new Error(`Upload incomplete (${received.length}/${session.totalChunks} chunks received).`);
    }

    let totalBytes = 0;
    for (const name of received) {
      const stat = fs.statSync(path.join(chunkDir, name));
      if (stat.size > session.chunkSize) {
        throw new Error("A chunk part exceeds the allowed size.");
      }
      totalBytes += stat.size;
    }
    if (totalBytes !== session.fileSize) {
      throw new Error(`Uploaded bytes (${totalBytes}) do not match the declared file size (${session.fileSize}).`);
    }

    // Assemble into a unique final file inside the upload storage directory so
    // uploadFile's path + magic-byte + duration validation all apply unchanged.
    const extension = path.extname(sanitizeChunkFilename(session.fileName)).toLowerCase();
    const finalName = `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${extension || (session.mimeType.startsWith("video/") ? ".webm" : "")}`;
    const finalPath = path.join(uploadStorageDir, finalName);
    try {
      const writeStream = fs.createWriteStream(finalPath);
      for (let i = 0; i < session.totalChunks; i++) {
        const partPath = path.join(chunkDir, `${String(i).padStart(6, "0")}.part`);
        if (!fs.existsSync(partPath)) {
          throw new Error(`Chunk ${i} is missing — resume from the parts already received.`);
        }
        writeStream.write(fs.readFileSync(partPath));
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.end((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      removeLocal(finalPath);
      throw new Error(`Could not assemble upload: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    const multerFile = {
      fieldname: "file",
      originalname: session.fileName,
      encoding: "7bit",
      mimetype: session.mimeType,
      size: session.fileSize,
      destination: uploadStorageDir,
      filename: finalName,
      path: finalPath,
      stream: fs.createReadStream(finalPath),
    } as Express.Multer.File;

    try {
      const result = await uploadService.uploadFile(req, multerFile, {
        category: options.category || session.category,
        recordType: options.recordType || session.recordType || null,
        recordId: options.recordId || session.recordId || null,
      });
      await prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: "COMPLETE", receivedChunks: session.totalChunks },
      });
      try {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      } catch {
        // best-effort staging cleanup
      }
      return result;
    } catch (error) {
      removeLocal(finalPath);
      await prisma.uploadSession.update({ where: { id: session.id }, data: { status: "FAILED" } });
      throw error;
    }
  }

  /** Cancel an active session and remove its staged parts. */
  async cancelChunkSession(userId: string, sessionId: string) {
    const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new Error("Upload session not found.");
    }
    await prisma.uploadSession.update({ where: { id: sessionId }, data: { status: "CANCELLED" } });
    try {
      fs.rmSync(chunkStagingDir(sessionId), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    return { cancelled: true };
  }

  /** Mark a session FAILED (workflow error that prevents composing a valid file). */
  async failChunkSession(userId: string, sessionId: string) {
    const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new Error("Upload session not found.");
    }
    await prisma.uploadSession.update({ where: { id: sessionId }, data: { status: "FAILED" } });
    return { failed: true };
  }
}

export const chunkUploadService = new ChunkUploadService();