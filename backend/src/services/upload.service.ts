import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "../prisma";
import { imageOptimizer } from "./image-optimizer.service";

const configuredUploadDir = process.env.UPLOAD_STORAGE_DIR;
// Resolve relative storage paths against the backend project, not process.cwd().
// This keeps `npm --prefix backend ...`, Docker and direct starts consistent.
const uploadDir = configuredUploadDir
  ? (path.isAbsolute(configuredUploadDir) ? configuredUploadDir : path.resolve(__dirname, "../..", configuredUploadDir))
  : path.resolve(__dirname, "../../public/uploads");
// The HTTP server mounts this same directory at /uploads. Keeping the storage
// path exported prevents custom persistent volumes from producing dead URLs.
export const uploadStorageDir = uploadDir;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Ensure optimized subdirectory exists
const optimizedDir = path.join(uploadDir, "optimized");
if (!fs.existsSync(optimizedDir)) {
  fs.mkdirSync(optimizedDir, { recursive: true });
}

const uploadPublicBaseUrl = (process.env.UPLOAD_PUBLIC_BASE_URL || "").replace(/\/$/, "");
const useCloudinary = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
);
const execFileAsync = promisify(execFile);
const maxVideoDurationSeconds = Number(process.env.MAX_VIDEO_DURATION_SECONDS || 600);

if (useCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const sanitizeFilename = (originalName: string): string => {
  const extension = path.extname(originalName || "").toLowerCase();
  const safeBaseName = path.basename(originalName || "upload", extension)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "") || `upload-${Date.now()}`;
  return `${safeBaseName}${extension}`;
};

// Browsers send MediaRecorder output as e.g. "audio/webm;codecs=opus".
// Strip codec parameters so allow-lists and magic-byte lookups always see the
// base type ("audio/webm") regardless of browser-specific codec hints.
const normalizeMimeType = (value: string): string => String(value || "").toLowerCase().split(";")[0].trim();

const MAGIC_SIGNATURES: Record<string, (buffer: Buffer) => boolean> = {
  "image/jpeg": b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/gif": b => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii")),
  "image/webp": b => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  "image/avif": b => b.subarray(4, 12).toString("ascii").includes("ftypavif"),
  "video/mp4": b => b.subarray(4, 8).toString("ascii") === "ftyp",
  "video/quicktime": b => b.subarray(4, 8).toString("ascii") === "ftyp",
  "video/webm": b => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  "audio/webm": b => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && isAudioWebm(b),
  "audio/ogg": b => b.subarray(0, 4).toString("ascii") === "OggS",
  "audio/mpeg": b => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  "audio/wav": b => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WAVE",
  "audio/mp4": b => b.subarray(4, 8).toString("ascii") === "ftyp",
  "application/pdf": b => b.subarray(0, 5).toString("ascii") === "%PDF-",
};

// WebM is a generic EBML container that can carry audio-only (Opus) or
// audio+video. Audio recordings from MediaRecorder are audio-only WebM. We
// cannot fully enumerate tracks from a 16-byte header, so treat every WebM
// with a valid EBML start as either audio or video; the exact MIME is decided
// by the declared type (audio/webm vs video/webm) which the recorder supplies.
const isAudioWebm = (_buffer: Buffer): boolean => true;

const verifyFileContent = (file: Express.Multer.File): void => {
  const validator = MAGIC_SIGNATURES[normalizeMimeType(file.mimetype)];
  if (!validator) return;
  const fd = fs.openSync(file.path, "r");
  try {
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    if (!validator(header.subarray(0, bytesRead))) {
      throw new Error("The file contents do not match the declared file type.");
    }
  } finally {
    fs.closeSync(fd);
  }
};

/** Exported for flows that persist upload metadata without the public URL helper. */
export { verifyFileContent };

const removeLocalFile = (filePath?: string): void => {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const probeVideoDuration = async (filePath: string): Promise<number | undefined> => {
  try {
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ], { timeout: 15_000 });
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) ? duration : undefined;
  } catch {
    // ffprobe is optional in development. Cloudinary validates/probes cloud video;
    // production local-storage deployments should provide FFPROBE_PATH.
    return undefined;
  }
};

const getAllowedExtensions = (mimetype: string): string[] => {
  if (mimetype.startsWith("image/")) {
    return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];
  }
  if (mimetype.startsWith("video/")) {
    return [".mp4", ".mov", ".webm", ".m4v", ".avi"];
  }
  if (mimetype.startsWith("audio/")) {
    return [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".webm", ".opus"];
  }
  return [".pdf", ".doc", ".docx", ".txt"];
};

// ============================================================================
// UPLOAD CONFIGURATION
// ============================================================================

export const UPLOAD_LIMITS = {
  IMAGE: 15 * 1024 * 1024, // 15MB
  VIDEO: 100 * 1024 * 1024, // 100MB
  AUDIO: 25 * 1024 * 1024, // 25MB
  DOCUMENT: 10 * 1024 * 1024, // 10MB
  AVATAR: 5 * 1024 * 1024, // 5MB
  BANNER: 10 * 1024 * 1024, // 10MB
  THUMBNAIL: 5 * 1024 * 1024, // 5MB
};

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
// Local storage has no transcoding worker. Accept only formats browsers can
// reliably play from the stored original; Cloudinary deployments can add a
// conversion worker without changing this upload contract.
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm"];
export const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm"];
export const ALLOWED_DOC_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

const ALL_ALLOWED = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  ...ALLOWED_AUDIO_TYPES,
  ...ALLOWED_DOC_TYPES,
];

// ============================================================================
// CATEGORY-SPECIFIC MULTER INSTANCES
// ============================================================================

const createStorage = (destination: string) =>
  multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destination),
    filename: (_req, file, cb) => {
      const safeName = sanitizeFilename(file.originalname);
      const ext = path.extname(safeName).toLowerCase() || "";
      const randomName = crypto.randomBytes(16).toString("hex");
      cb(null, `${Date.now()}-${randomName}${ext}`);
    },
  });

const createFileFilter = (allowedTypes: string[]) =>
  (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const mimetype = normalizeMimeType(file.mimetype);
    const allowedExtensions = getAllowedExtensions(mimetype);

    if (!allowedTypes.includes(mimetype)) {
      cb(new Error(`File type ${mimetype} is not allowed`));
      return;
    }

    if (allowedExtensions.length > 0 && extension && !allowedExtensions.includes(extension)) {
      cb(new Error(`File extension ${extension} is not supported for ${file.mimetype}`));
      return;
    }

    cb(null, true);
  };

export const upload = multer({
  storage: createStorage(uploadDir),
  limits: { fileSize: UPLOAD_LIMITS.VIDEO },
  fileFilter: createFileFilter(ALL_ALLOWED),
});

export const uploadImage = multer({
  storage: createStorage(uploadDir),
  limits: { fileSize: UPLOAD_LIMITS.IMAGE },
  fileFilter: createFileFilter(ALLOWED_IMAGE_TYPES),
});

export const uploadVideo = multer({
  storage: createStorage(uploadDir),
  limits: { fileSize: UPLOAD_LIMITS.VIDEO },
  fileFilter: createFileFilter(ALLOWED_VIDEO_TYPES),
});

export const uploadAvatarMulter = multer({
  storage: createStorage(uploadDir),
  limits: { fileSize: UPLOAD_LIMITS.AVATAR },
  fileFilter: createFileFilter(ALLOWED_IMAGE_TYPES),
});

export const uploadBannerMulter = multer({
  storage: createStorage(uploadDir),
  limits: { fileSize: UPLOAD_LIMITS.BANNER },
  fileFilter: createFileFilter(ALLOWED_IMAGE_TYPES),
});

export const uploadThumbnail = multer({
  storage: createStorage(uploadDir),
  limits: { fileSize: UPLOAD_LIMITS.THUMBNAIL },
  fileFilter: createFileFilter(ALLOWED_IMAGE_TYPES),
});

export const uploadDocument = multer({
  storage: createStorage(uploadDir),
  limits: { fileSize: UPLOAD_LIMITS.DOCUMENT },
  fileFilter: createFileFilter(ALLOWED_DOC_TYPES),
});

// ============================================================================
// VANTA GIVE — PRIVATE EVIDENCE UPLOADS
// ============================================================================
// Sensitive supporting evidence (medical reports, bills, ID documents) must
// never be reachable through the public `/uploads` static mount. Files are
// written to a private directory and streamed only through an authorized
// endpoint (organizer or admin), never served as static assets.
export const evidenceUploadDir = (() => {
  const configured = process.env.EVIDENCE_UPLOAD_DIR;
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(__dirname, "../..", configured);
  // Default: <backend>/private/evidence — sibling of public/, outside the static mount.
  return path.resolve(__dirname, "../../private/evidence");
})();
if (!fs.existsSync(evidenceUploadDir)) {
  fs.mkdirSync(evidenceUploadDir, { recursive: true });
}

export const EVIDENCE_ALLOWED_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  ...ALLOWED_DOC_TYPES,
];

export const MAX_EVIDENCE_SIZE = 50 * 1024 * 1024; // 50MB

/** Evidence uploads (images, videos, PDFs/docs) stored in the PRIVATE dir. */
export const uploadEvidence = multer({
  storage: createStorage(evidenceUploadDir),
  limits: { fileSize: MAX_EVIDENCE_SIZE },
  fileFilter: createFileFilter(EVIDENCE_ALLOWED_TYPES),
});

// ============================================================================
// URL & TYPE HELPERS
// ============================================================================

export const buildUploadUrl = (req: any, filename: string): string => {
  if (uploadPublicBaseUrl) {
    return `${uploadPublicBaseUrl}/uploads/${filename}`;
  }

  // Local disk storage: return portable, relative URLs so the browser always
  // requests media from the API origin it is currently configured to use.
  // Baking an absolute host here (e.g. localhost or a DHCP LAN IP) produces
  // dead media on phones and after the laptop's LAN IP rotates.
  return `/uploads/${filename}`;
};

const buildOptimizedUrl = (req: any, assetPath: string): string => {
  if (uploadPublicBaseUrl) {
    return `${uploadPublicBaseUrl}${assetPath}`;
  }

  return assetPath;
};

export const getFileType = (mimetype: string): string => {
  if (mimetype.startsWith("image/")) return "IMAGE";
  if (mimetype.startsWith("video/")) return "VIDEO";
  if (mimetype.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
};

export const getMediaType = (mimetype: string): "IMAGE" | "VIDEO" => {
  return mimetype.startsWith("video/") ? "VIDEO" : "IMAGE";
};

// ============================================================================
// UPLOAD SERVICE
// ============================================================================

export interface UploadedFileResult {
  id: string;
  url: string;
  type: string;
  filename: string;
  mimeType: string;
  size: number;
  category: string;
  thumbnailUrl?: string;
}

export class UploadService {
  /**
   * Upload a file and persist its metadata to the database.
   */
  async uploadFile(
    req: any,
    file: Express.Multer.File,
    options: {
      category?: string;
      recordType?: string;
      recordId?: string;
      optimize?: boolean;
      generateThumbnail?: boolean;
    } = {}
  ): Promise<UploadedFileResult> {
    const {
      category = "generic",
      recordType,
      recordId,
      optimize = true,
      generateThumbnail = false,
    } = options;

    const userId = req.user?.userId;
    if (!userId) {
      removeLocalFile(file?.path);
      throw new Error("Authentication is required to upload files.");
    }
    if (!file?.path || !path.resolve(file.path).startsWith(`${uploadDir}${path.sep}`)) {
      removeLocalFile(file?.path);
      throw new Error("Invalid upload path.");
    }
    try {
      verifyFileContent(file);
    } catch (error) {
      removeLocalFile(file.path);
      throw error;
    }
    const url = buildUploadUrl(req, file.filename);
    const fileType = getFileType(file.mimetype);

    if (fileType === "VIDEO") {
      const duration = await probeVideoDuration(file.path);
      if (duration !== undefined && duration > maxVideoDurationSeconds) {
        removeLocalFile(file.path);
        throw new Error(`Video duration exceeds the ${Math.floor(maxVideoDurationSeconds / 60)} minute limit.`);
      }
    }

    // Optimize images if requested and sharp is available
    let finalUrl = url;
    if (optimize && fileType === "IMAGE" && !useCloudinary) {
      try {
        const optimized = await imageOptimizer.optimize(file.path, file.filename, {
          width: 2048,
          quality: 85,
        });
        if (optimized.webp) {
          finalUrl = buildOptimizedUrl(req, optimized.webp);
        }
      } catch (error) {
        console.warn("[UploadService] Image optimization failed:", error);
        // Fall back to original file
      }
    }

    let storagePath = file.path;
    let thumbnailUrl: string | undefined;

    // Cloudinary is used automatically when fully configured. Local disk remains
    // the deterministic development fallback and must be mounted persistently in production.
    if (useCloudinary) {
      try {
        const resourceType = fileType === "VIDEO" || fileType === "AUDIO" ? "video" : fileType === "IMAGE" ? "image" : "raw";
        const cloudResult = await cloudinary.uploader.upload(file.path, {
          resource_type: resourceType,
          folder: `vanta/${category.replace(/[^a-z0-9-]/gi, "-")}`,
          use_filename: false,
          unique_filename: true,
          overwrite: false,
        });
        finalUrl = cloudResult.secure_url;
        storagePath = `cloudinary:${resourceType}:${cloudResult.public_id}`;
        if (fileType === "VIDEO") {
          thumbnailUrl = cloudinary.url(cloudResult.public_id, {
            resource_type: "video", secure: true, format: "jpg", transformation: [{ start_offset: "1" }, { width: 640, crop: "limit" }],
          });
        }
      } catch (error) {
        removeLocalFile(file.path);
        throw new Error(`Storage provider failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    // Persist only after storage succeeds; remove the asset if database persistence fails.
    let record;
    try {
      record = await prisma.uploadedFile.create({
        data: {
        userId,
        filename: file.filename,
        originalName: file.originalname,
        url: finalUrl,
        path: storagePath,
        mimeType: normalizeMimeType(file.mimetype),
        fileType,
        size: file.size,
        category,
        recordType: recordType || null,
        recordId: recordId || null,
        },
      });
    } catch (error) {
      await this.deleteStorageAsset(file.filename, storagePath);
      throw new Error(`Could not save uploaded file metadata: ${error instanceof Error ? error.message : "database error"}`);
    }

    if (useCloudinary) removeLocalFile(file.path);

    return {
      id: record.id,
      url: finalUrl,
      type: fileType,
      filename: file.filename,
      mimeType: file.mimetype,
      size: file.size,
      category,
      thumbnailUrl,
    };
  }

  private async deleteStorageAsset(filename: string, storagePath?: string | null): Promise<boolean> {
    if (storagePath?.startsWith("cloudinary:")) {
      const [, resourceType, ...publicIdParts] = storagePath.split(":");
      await cloudinary.uploader.destroy(publicIdParts.join(":"), { resource_type: resourceType as any, invalidate: true });
      return true;
    }
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename) return false;
    const filepath = path.join(uploadDir, safeFilename);
    if (fs.existsSync(filepath)) { fs.unlinkSync(filepath); return true; }
    return false;
  }

  /**
   * Delete a file from disk and soft-delete its metadata record.
   */
  async deleteFile(filename: string, fileId?: string): Promise<boolean> {
    let deleted = false;

    const metadata = fileId
      ? await prisma.uploadedFile.findUnique({ where: { id: fileId } })
      : await prisma.uploadedFile.findFirst({ where: { filename, deletedAt: null } });

    deleted = await this.deleteStorageAsset(path.basename(filename), metadata?.path);

    // Also delete optimized versions
    const baseName = path.parse(filename).name;
    const optimizedVersions = [
      path.join(uploadDir, "optimized", `${baseName}.webp`),
      path.join(uploadDir, "optimized", `${baseName}.avif`),
      path.join(uploadDir, "optimized", `${baseName}_AVATAR.webp`),
      path.join(uploadDir, "optimized", `${baseName}_THUMBNAIL.webp`),
      path.join(uploadDir, "optimized", `${baseName}_SMALL.webp`),
      path.join(uploadDir, "optimized", `${baseName}_MEDIUM.webp`),
      path.join(uploadDir, "optimized", `${baseName}_LARGE.webp`),
      path.join(uploadDir, "optimized", `${baseName}_BANNER.webp`),
    ];
    for (const optPath of optimizedVersions) {
      if (fs.existsSync(optPath)) {
        try {
          fs.unlinkSync(optPath);
          deleted = true;
        } catch {
          // Ignore deletion errors
        }
      }
    }

    // Soft-delete metadata record
    try {
      if (fileId) {
        await prisma.uploadedFile.update({
          where: { id: fileId },
          data: { deletedAt: new Date() },
        });
      } else {
        await prisma.uploadedFile.updateMany({
          where: { filename },
          data: { deletedAt: new Date() },
        });
      }
    } catch (error) {
      console.warn("[UploadService] Failed to soft-delete metadata:", error);
    }

    return deleted;
  }

  /**
   * Delete the previous file for a user+category (e.g. old avatar replaced by new one).
   */
  async deletePreviousForUser(
    userId: string,
    category: string,
    excludeFileId?: string
  ): Promise<void> {
    const previous = await prisma.uploadedFile.findFirst({
      where: {
        userId,
        category,
        deletedAt: null,
        ...(excludeFileId ? { id: { not: excludeFileId } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    if (previous) {
      await this.deleteFile(previous.filename, previous.id);
    }
  }

  /** Delete all previous assets for a single domain field before replacement. */
  async deletePreviousForRecord(recordType: string, recordId: string, category: string, excludeFileId?: string): Promise<void> {
    const previous = await prisma.uploadedFile.findMany({
      where: {
        recordType, recordId, category, deletedAt: null,
        ...(excludeFileId ? { id: { not: excludeFileId } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    await Promise.all(previous.map(file => this.deleteFile(file.filename, file.id)));
  }

  async linkFile(fileId: string, userId: string, recordType: string, recordId: string, allowedCategories?: string[]): Promise<void> {
    const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt || file.userId !== userId) throw new Error("Uploaded file was not found or is not owned by you.");
    if (allowedCategories?.length && !allowedCategories.includes(file.category)) throw new Error("Uploaded file cannot be used for this record.");
    await prisma.uploadedFile.update({ where: { id: fileId }, data: { recordType, recordId } });
  }

  /**
   * Get all files uploaded by a user.
   */
  async getUserFiles(userId: string, category?: string) {
    return prisma.uploadedFile.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Strip the URL to extract just the filename.
   */
  getFilenameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return path.basename(parsed.pathname);
    } catch {
      return path.basename(url);
    }
  }
}

export const uploadService = new UploadService();