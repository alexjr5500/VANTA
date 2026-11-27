import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createPrivateMediaUrl } from "./private-media.service";
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
import { assertVerificationUploadAvailable } from "./cloudinary-storage-config";

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

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function chunkIndex(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return NaN;
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 ? index : NaN;
}

async function requireOwnedActiveSession(userId: string, sessionId: string) {
  if (!userId || !validSessionId(sessionId)) throw new Error("Upload session not found.");
  const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) throw new Error("Upload session not found.");
  if (session.status !== "ACTIVE") throw new Error("This upload session is no longer active.");
  if (session.expiresAt.getTime() <= Date.now()) throw new Error("This upload session has expired. Please restart the upload.");
  return session;
}

// Check ownership and bounds BEFORE touching the session directory. Store a
// retry under a unique temporary name; only a fully received, validated part
// is atomically published under its canonical index.
const chunksDiskStorage = multer.diskStorage({
  destination: (req: any, _file: Express.Multer.File, cb) => {
    void (async () => {
      const session = await requireOwnedActiveSession(req.user?.userId, req.body?.sessionId);
      const index = chunkIndex(req.body?.index);
      if (!Number.isSafeInteger(index) || index >= session.totalChunks) throw new Error("Invalid chunk index.");
      const dir = chunkStagingDir(session.id);
      fs.mkdirSync(dir, { recursive: true });
      req.chunkStagingIndex = index;
      cb(null, dir);
    })().catch(error => cb(error instanceof Error ? error : new Error("Could not stage upload chunk"), ""));
  },
  filename: (req: any, _file: Express.Multer.File, cb) => {
    cb(null, `${String(req.chunkStagingIndex).padStart(6, "0")}.${crypto.randomBytes(12).toString("hex")}.pending`);
  },
});

export const uploadChunk = multer({
  storage: chunksDiskStorage,
  limits: { fileSize: UPLOAD_CHUNK_SIZE + 1, files: 1, fields: 2, parts: 4 },
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
    assertVerificationUploadAvailable(category, input.recordType);

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

  /** Publish a fully received part without overwriting a good part with a short retry. */
  async acceptChunkPart(userId: string, sessionId: string, indexRaw: unknown, file?: Express.Multer.File) {
    const session = await requireOwnedActiveSession(userId, sessionId);
    const index = chunkIndex(indexRaw);
    if (!Number.isSafeInteger(index) || index >= session.totalChunks) throw new Error("Invalid chunk index.");
    const chunkDir = chunkStagingDir(sessionId);
    const name = path.basename(file?.path || "");
    const match = /^(\d{6})\.[a-f0-9]{24}\.pending$/.exec(name);
    if (!file?.path || !match || Number(match[1]) !== index ||
        path.resolve(file.path) !== path.resolve(chunkDir, name)) {
      throw new Error("Chunk part could not be staged.");
    }
    const expected = Math.min(session.chunkSize, session.fileSize - index * session.chunkSize);
    try {
      if (expected <= 0 || file.size !== expected || fs.statSync(file.path).size !== expected) {
        throw new Error("Chunk part does not match the expected size.");
      }
      // Once published, a part is immutable. A retry must never replace bytes
      // that an already-running finalizer may be reading.
      const canonical = path.join(chunkDir, `${String(index).padStart(6, "0")}.part`);
      try {
        fs.linkSync(file.path, canonical);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const stat = fs.lstatSync(canonical);
        if (!stat.isFile() || stat.size !== expected) throw new Error("Existing chunk is invalid. Restart the upload.");
      }
    } finally {
      removeLocal(file.path);
    }
    const receivedChunks = fs.readdirSync(chunkDir).filter(name => /^\d{6}\.part$/.test(name)).length;
    await prisma.uploadSession.updateMany({ where: { id: sessionId, userId, status: "ACTIVE" }, data: { receivedChunks } });
    return {
      sessionId, receivedChunks, totalChunks: session.totalChunks, chunkSize: session.chunkSize,
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
      status: session.status,
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

    // Completion is not a new upload authorization. Keep the category and
    // record binding that were validated when the session was initialized.
    // Check before the completed-session lookup as well as before assembly.
    if ((options.category !== undefined && options.category !== session.category) ||
        (options.recordType !== undefined && options.recordType !== session.recordType) ||
        (options.recordId !== undefined && options.recordId !== session.recordId)) {
      throw new Error("Upload completion must match the original session category and record binding.");
    }

    assertVerificationUploadAvailable(session.category, session.recordType);

    if (session.status === "COMPLETE") {
      // Never guess from the newest file with a matching category/record.
      if (!session.completedFileId) throw new Error("Completed upload has no verified file binding.");
      const existing = await prisma.uploadedFile.findFirst({
        where: {
          id: session.completedFileId,
          userId,
          category: session.category,
          recordType: session.recordType,
          recordId: session.recordId,
          deletedAt: null,
        },
      });
      if (existing) {
        return {
          id: existing.id,
          url: existing.category === "message" ? createPrivateMediaUrl(existing.id, userId) : existing.url,
          type: existing.fileType,
          filename: existing.filename,
          mimeType: existing.mimeType,
          size: existing.size,
          category: existing.category,
        };
      }
      throw new Error("Completed upload file is no longer available.");
    }
    if (session.status === "FINALIZING") throw new Error("Upload completion is already in progress. Retry shortly.");
    if (session.status !== "ACTIVE") {
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

    for (let i = 0; i < session.totalChunks; i++) {
      const part = path.join(chunkDir, `${String(i).padStart(6, "0")}.part`);
      const expected = Math.min(session.chunkSize, session.fileSize - i * session.chunkSize);
      if (!fs.existsSync(part)) throw new Error("Upload incomplete: missing chunk.");
      const stat = fs.lstatSync(part);
      if (!stat.isFile() || expected <= 0 || stat.size !== expected) throw new Error("Upload incomplete: invalid chunk size.");
    }

    // A single database claim wins across processes. No provider write is
    // attempted before the claim; unknown outcomes must not be retried blindly.
    const claim = await prisma.uploadSession.updateMany({
      where: { id: sessionId, userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
      data: { status: "FINALIZING" },
    });
    if (claim.count !== 1) throw new Error("Upload completion is already in progress or the session is closed.");

    const extension = path.extname(sanitizeChunkFilename(session.fileName)).toLowerCase();
    const finalName = `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${extension || (session.mimeType.startsWith("video/") ? ".webm" : "")}`;
    const finalPath = path.join(uploadStorageDir, finalName);
    async function* orderedParts() {
      for (let i = 0; i < session!.totalChunks; i++) {
        const partPath = path.join(chunkDir, `${String(i).padStart(6, "0")}.part`);
        const reader = fs.createReadStream(partPath, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW });
        for await (const bytes of reader) yield bytes;
      }
    }
    try {
      await pipeline(Readable.from(orderedParts()), fs.createWriteStream(finalPath, { flags: "wx" }));
      if ((await fs.promises.stat(finalPath)).size !== session.fileSize) throw new Error("Assembled size mismatch.");
    } catch {
      removeLocal(finalPath);
      await prisma.uploadSession.updateMany({ where: { id: session.id, userId, status: "FINALIZING" }, data: { status: "FAILED" } });
      throw new Error("Could not assemble upload.");
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
        category: session.category,
        recordType: session.recordType || undefined,
        recordId: session.recordId || undefined,
        chunkSessionId: session.id,
      });
      try {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      } catch {
        // best-effort staging cleanup
      }
      return result;
    } catch (error) {
      // The upload service commits metadata and COMPLETE together. If the
      // outcome is ambiguous, retain FINALIZING for operator reconciliation;
      // never delete a possibly committed asset or allow another provider write.
      throw error;
    }
  }

  /** Cancel an active session and remove its staged parts. */
  async cancelChunkSession(userId: string, sessionId: string) {
    const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new Error("Upload session not found.");
    }
    // Media is already persisted: a late cancellation must not roll back the
    // completed session or compromise an idempotent finalize retry.
    if (session.status !== "ACTIVE") return { cancelled: false };
    const claim = await prisma.uploadSession.updateMany({
      where: { id: sessionId, userId, status: "ACTIVE" }, data: { status: "CANCELLED" },
    });
    if (claim.count !== 1) return { cancelled: false };
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
    const claim = await prisma.uploadSession.updateMany({
      where: { id: sessionId, userId, status: "ACTIVE" }, data: { status: "FAILED" },
    });
    return { failed: claim.count === 1 };
  }
}

export const chunkUploadService = new ChunkUploadService();