import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "../prisma";
import { imageOptimizer } from "./image-optimizer.service";
import { createPrivateMediaUrl } from "./private-media.service";

const configuredUploadDir = process.env.UPLOAD_STORAGE_DIR;
// Resolve relative storage paths against the backend project, not process.cwd().
// This keeps `npm --prefix backend ...`, Docker and direct starts consistent.
const defaultUploadDir = path.resolve(__dirname, "../../public/uploads");
const uploadDir = configuredUploadDir
  ? (path.isAbsolute(configuredUploadDir) ? configuredUploadDir : path.resolve(__dirname, "../..", configuredUploadDir))
  : defaultUploadDir;

// If production is switching from ephemeral local storage to a mounted volume,
// preserve any still-present uploads before the service starts writing to the
// new directory. Never overwrite files already on the persistent volume.
if (configuredUploadDir && path.resolve(uploadDir) !== defaultUploadDir && fs.existsSync(defaultUploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.cpSync(defaultUploadDir, uploadDir, {
      recursive: true,
      force: false,
      errorOnExist: false,
      filter: (source) => !source.split(path.sep).includes(".chunks"),
    });
  } catch (error) {
    console.warn("[UploadStorage] Could not migrate remaining local uploads to configured storage.");
  }
}

// The HTTP server mounts this same directory at /uploads. Keeping the storage
// path exported prevents custom persistent volumes from producing dead URLs.

/**
 * Generate a short-lived Cloudinary download URL only after the application
 * has authorized the requesting conversation participant.
 */
export function getPrivateCloudinaryDownloadUrl(storagePath: string, filename: string): string {
  const match = /^cloudinary:(image|video|raw):(.+)$/.exec(storagePath);
  if (!match) throw new Error('Invalid private Cloudinary storage reference');
  const format = path.extname(filename).replace(/^\./, '') || 'bin';
  return cloudinary.utils.private_download_url(match[2], format, {
    resource_type: match[1],
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
}

/**
 * One-time admin migration for previously public Cloudinary message assets.
 * New message uploads are authenticated at upload time; this converts legacy
 * public assets and invalidates their old CDN delivery URLs.
 */
export async function secureExistingPrivateCloudinaryAssets() {
  if (!useCloudinary) return { migrated: 0, alreadySecured: 0, total: 0, skipped: true };
  const files = await prisma.uploadedFile.findMany({
    where: { category: 'message', path: { startsWith: 'cloudinary:' }, deletedAt: null },
    select: { id: true, path: true, filename: true },
  });
  let migrated = 0;
  let alreadySecured = 0;
  for (const file of files) {
    const match = /^cloudinary:(image|video|raw):(.+)$/.exec(file.path || '');
    if (!match) continue;
    const resourceType = match[1];
    const oldPublicId = match[2];
    const newPublicId = `${oldPublicId}_private_${file.id}`;
    // Handle a retry after Cloudinary rename succeeded but the DB update failed.
    try {
      await cloudinary.api.resource(newPublicId, { resource_type: resourceType, type: 'authenticated' });
      if (file.path !== `cloudinary:${resourceType}:${newPublicId}`) {
        await prisma.uploadedFile.update({ where: { id: file.id }, data: { path: `cloudinary:${resourceType}:${newPublicId}` } });
      }
      alreadySecured += 1;
      continue;
    } catch (error: any) {
      if (error?.http_code !== 404 && error?.error?.http_code !== 404) throw error;
    }
    // Already-authenticated assets at their original public ID need no rename.
    try {
      await cloudinary.api.resource(oldPublicId, { resource_type: resourceType, type: 'authenticated' });
      alreadySecured += 1;
      continue;
    } catch (error: any) {
      if (error?.http_code !== 404 && error?.error?.http_code !== 404) throw error;
    }
    await cloudinary.uploader.rename(oldPublicId, newPublicId, {
      resource_type: resourceType,
      type: 'upload',
      to_type: 'authenticated',
      invalidate: true,
    });
    await prisma.uploadedFile.update({
      where: { id: file.id },
      data: { path: `cloudinary:${resourceType}:${newPublicId}` },
    });
    migrated += 1;
  }
  return { migrated, alreadySecured, total: files.length, skipped: false };
}

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
export const STATUS_MAX_VIDEO_SECONDS = 120;
export function assertStatusVideoDuration(duration: unknown): void {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) throw new Error("Unable to verify Status video duration. Choose a supported video.");
  if (duration > STATUS_MAX_VIDEO_SECONDS) throw new Error("Status videos are limited to 2 minutes (120 seconds).");
}

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
  "image/bmp": b => b.subarray(0, 2).toString("ascii") === "BM",
  "image/tiff": b => b.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || b.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])),
  "image/heic": b => /hei[cfm]|mif1|msf1/.test(b.subarray(8, 16).toString("ascii")),
  "image/heif": b => /hei[cfm]|mif1|msf1/.test(b.subarray(8, 16).toString("ascii")),
  "video/mp4": b => b.subarray(4, 8).toString("ascii") === "ftyp",
  "video/quicktime": b => b.subarray(4, 8).toString("ascii") === "ftyp",
  "video/x-m4v": b => b.subarray(4, 8).toString("ascii") === "ftyp",
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

// ============================================================================
// STORAGE DIAGNOSTICS
// ============================================================================
// Production Reel/media failures ("Unable to load Reel — MEDIA_ELEMENT_ERROR")
// have repeatedly been caused by LOCAL storage pointing at an EPHEMERAL
// container filesystem (e.g. Railway without a persistent volume or without
// UPLOAD_STORAGE_DIR set): uploads write to the container disk, Postgres keeps
// the row, then the next restart/redeploy wipes the bytes. /api/reels keeps
// returning /uploads/... URLs that 404 as JSON, and <video> reports
// "server returned no playable video source".
//
// This diagnostic compares the uploadedFile rows the API actually serves
// against the files present on disk so the condition is visible in /health
// and at startup before a single Reel breaks.

export interface MediaStorageDiagnostics {
  /** "local" (backend disk /uploads) or "cloudinary" (CDN autodetect). */
  mode: "local" | "cloudinary";
  cloudinaryConfigured: boolean;
  /** Directory the /uploads static mount serves (local mode). */
  uploadStorageDir: string;
  /** True when UPLOAD_STORAGE_DIR is explicitly configured. */
  storageDirEnvConfigured: boolean;
  /** Raw UPLOAD_STORAGE_DIR value (may be a relative path). */
  storageDirEnv: string | null;
  /** Newest non-deleted uploadedFile rows inspected (bounded). */
  dbReferencedUploads: number;
  /** Of the inspected rows, how many files exist on disk. */
  presentOnDisk: number;
  /** Of the inspected rows, how many files are missing from disk. */
  missingOnDisk: number;
  /** Total non-optimized files found in uploadStorageDir. */
  filesOnDisk: number | null;
  /** true when every referenced file is present (or Cloudinary is used). */
  healthy: boolean;
}

export const STORAGE_DIAGNOSIS_SAMPLE_LIMIT = 500;

export async function getStorageDiagnostics(): Promise<MediaStorageDiagnostics> {
  let referenced = 0;
  let present = 0;
  let missing = 0;
  try {
    const rows = await prisma.uploadedFile.findMany({
      where: { deletedAt: null },
      select: { filename: true },
      orderBy: { createdAt: "desc" },
      take: STORAGE_DIAGNOSIS_SAMPLE_LIMIT,
    });
    referenced = rows.length;
    for (const row of rows) {
      const assetPath = path.join(uploadStorageDir, path.basename(row.filename));
      if (fs.existsSync(assetPath)) present += 1;
      else missing += 1;
    }
  } catch (error) {
    // Database may be unavailable (pre-provision, first boot). Report what we can.
    console.warn("[StorageDiagnostics] Could not inspect uploadedFile rows:", error);
  }

  let diskCount: number | null = null;
  try {
    diskCount = fs
      .readdirSync(uploadStorageDir)
      .filter((name: string) => {
        try {
          return fs.statSync(path.join(uploadStorageDir, name)).isFile();
        } catch {
          return false;
        }
      }).length;
  } catch (error) {
    console.warn("[StorageDiagnostics] Could not list upload storage dir:", error);
  }

  const mode = useCloudinary ? "cloudinary" : "local";
  return {
    mode,
    cloudinaryConfigured: useCloudinary,
    uploadStorageDir,
    storageDirEnvConfigured: Boolean(process.env.UPLOAD_STORAGE_DIR),
    storageDirEnv: process.env.UPLOAD_STORAGE_DIR || null,
    dbReferencedUploads: referenced,
    presentOnDisk: present,
    missingOnDisk: missing,
    filesOnDisk: diskCount,
    healthy: mode === "cloudinary" || missing === 0,
  };
}

const removeLocalFile = (filePath?: string): void => {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

/** Server-side media metadata only; browser-provided duration is never trusted. */
export const probeVideoDuration = async (filePath: string): Promise<number | undefined> => {
  try {
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,duration", "-of", "json", filePath,
    ], { timeout: 15_000, maxBuffer: 256 * 1024 });
    const metadata = JSON.parse(stdout);
    const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
    if (!streams.some((stream: { codec_type?: string }) => stream.codec_type === "video")) return undefined;
    const durations = [metadata.format?.duration, ...streams.map((stream: { duration?: string }) => stream.duration)]
      .map(value => Number(value)).filter(value => Number.isFinite(value) && value > 0);
    return durations.length ? Math.max(...durations) : undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "EACCES") {
      // Do not misreport a missing server dependency as a user's bad video.
      console.error("[upload] ffprobe unavailable:", code);
    }
    return undefined;
  }
};

// MediaRecorder's streaming WebM may lack a container Duration element.
// Remux without re-encoding, then validate the actual output with ffprobe.
// Never accept the browser's requested trim range as proof of duration.
async function remuxStatusWebm(file: Express.Multer.File): Promise<number | undefined> {
  const temp = path.join(path.dirname(file.path), `.status-remux-${crypto.randomUUID()}.webm`);
  try {
    await execFileAsync(process.env.FFMPEG_PATH || "ffmpeg", [
      "-nostdin", "-v", "error", "-xerror", "-i", file.path,
      "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-f", "webm", temp,
    ], { timeout: 20_000, maxBuffer: 256 * 1024 });
    const duration = await probeVideoDuration(temp);
    if (duration === undefined) return undefined;
    assertStatusVideoDuration(duration);
    const size = fs.statSync(temp).size;
    if (size <= 0 || size > UPLOAD_LIMITS.VIDEO) return undefined;
    fs.renameSync(temp, file.path);
    file.size = size;
    return duration;
  } catch (error) {
    if (error instanceof Error && error.message.includes("2 minutes")) throw error;
    // ffmpeg is optional; if unavailable, the normal trusted storage probe
    // remains authoritative. Never accept an unverifiable Status video.
    return undefined;
  } finally {
    removeLocalFile(temp);
  }
}

const getAllowedExtensions = (mimetype: string): string[] => {
  if (mimetype.startsWith("image/")) {
    return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff", ".heic", ".heif"];
  }
  if (mimetype.startsWith("video/")) {
    return [".mp4", ".mov", ".webm", ".m4v"];
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

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp", "image/tiff", "image/heic", "image/heif"];
// Local storage has no transcoding worker. Accept only formats browsers can
// reliably play from the stored original; Cloudinary deployments can add a
// conversion worker without changing this upload contract.
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"];
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

    const isStatus = category === "story" || recordType === "Story";
    let probedDuration: number | undefined;
    if (fileType === "VIDEO") {
      let duration = await probeVideoDuration(file.path);
      if (isStatus && duration === undefined && normalizeMimeType(file.mimetype) === "video/webm") {
        try { duration = await remuxStatusWebm(file); }
        catch (error) { removeLocalFile(file.path); throw error; }
      }
      probedDuration = duration;
      if (isStatus && (duration !== undefined || !useCloudinary)) {
        try { assertStatusVideoDuration(duration); } catch (error) { removeLocalFile(file.path); throw error; }
      }
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
          type: category === 'message' ? 'authenticated' : 'upload',
          folder: `vanta/${category.replace(/[^a-z0-9-]/gi, "-")}`,
          use_filename: false,
          unique_filename: true,
          overwrite: false,
        });
        if (isStatus && fileType === "VIDEO") {
          try { assertStatusVideoDuration(typeof cloudResult.duration === "number" && Number.isFinite(cloudResult.duration) && cloudResult.duration > 0 ? Math.max(cloudResult.duration, probedDuration ?? 0) : probedDuration); }
          catch (error) { await cloudinary.uploader.destroy(cloudResult.public_id, { resource_type: "video", invalidate: true }); throw error; }
        }
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
      url: category === 'message' ? createPrivateMediaUrl(record.id, userId) : finalUrl,
      type: fileType,
      filename: file.filename,
      mimeType: file.mimetype,
      size: file.size,
      category,
      thumbnailUrl,
    };
  }

  /** Verify duration from trusted storage metadata, including pre-existing uploads. */
  async assertStatusMediaDuration(file: { fileType: string; path: string | null; filename: string }): Promise<void> {
    if (file.fileType !== "VIDEO") return;
    const match = /^cloudinary:video:(.+)$/.exec(file.path || "");
    if (match) {
      const resource = await cloudinary.api.resource(match[1], { resource_type: "video", type: "upload" });
      assertStatusVideoDuration(resource.duration);
      return;
    }
    if (path.basename(file.filename) !== file.filename) throw new Error("Invalid Status video storage reference.");
    assertStatusVideoDuration(await probeVideoDuration(path.join(uploadDir, file.filename)));
  }

  private async deleteStorageAsset(filename: string, storagePath?: string | null): Promise<boolean> {
    if (storagePath?.startsWith("cloudinary:")) {
      const [, resourceType, ...publicIdParts] = storagePath.split(":");
      const result = await cloudinary.uploader.destroy(publicIdParts.join(":"), { resource_type: resourceType as any, invalidate: true });
      if (result.result !== "ok" && result.result !== "not found") throw new Error("Storage provider did not confirm asset deletion");
      return result.result === "ok";
    }
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename) return false;
    const filepath = path.join(uploadDir, safeFilename);
    if (fs.existsSync(filepath)) { fs.unlinkSync(filepath); return true; }
    return false;
  }

  /**
   * Quarantine a moderation-removed asset. Local files are blocked by the
   * /uploads metadata guard; Cloudinary assets are renamed to authenticated
   * delivery so an old public URL stops resolving. Original references remain
   * on the metadata row for a possible audited restoration.
   */
  async quarantineModeratedFile(fileId: string): Promise<boolean> {
    const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file || !file.deletedAt) return false;
    if (file.category === 'message' || !file.path?.startsWith('cloudinary:')) return true;
    if (file.moderationOriginalPath) return true;

    const [, resourceType, ...publicIdParts] = file.path.split(':');
    const publicId = publicIdParts.join(':');
    if (!publicId || !['image', 'video', 'raw'].includes(resourceType)) return false;
    const quarantineId = `${publicId}_moderated_${file.id}`;

    // Retry safely if the Cloudinary rename succeeded but persisting the new
    // metadata path failed on the previous attempt.
    let alreadyQuarantined = false;
    try {
      await cloudinary.api.resource(quarantineId, { resource_type: resourceType, type: 'authenticated' });
      alreadyQuarantined = true;
    } catch (error: any) {
      if (error?.http_code !== 404 && error?.error?.http_code !== 404) throw error;
    }
    if (!alreadyQuarantined) {
      await cloudinary.uploader.rename(publicId, quarantineId, {
        resource_type: resourceType as any,
        type: 'upload',
        to_type: 'authenticated',
        invalidate: true,
      });
    }
    await prisma.uploadedFile.update({
      where: { id: file.id },
      data: {
        path: `cloudinary:${resourceType}:${quarantineId}`,
        moderationOriginalPath: file.path,
        moderationOriginalUrl: file.url,
      },
    });
    return true;
  }

  /** Restore a quarantined asset after the moderator's restoration is approved. */
  async restoreModeratedFile(fileId: string): Promise<boolean> {
    const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file || !file.deletedAt) return false;

    if (!file.moderationOriginalPath && file.category !== 'message' && file.path?.startsWith('cloudinary:')) {
      // Recover a partial quarantine where Cloudinary renamed the object but
      // the metadata update did not commit.
      const [, resourceType, ...publicIdParts] = file.path.split(':');
      const publicId = publicIdParts.join(':');
      const quarantineId = `${publicId}_moderated_${file.id}`;
      if (publicId && ['image', 'video', 'raw'].includes(resourceType)) {
        let quarantineExists = false;
        try {
          await cloudinary.api.resource(quarantineId, { resource_type: resourceType, type: 'authenticated' });
          quarantineExists = true;
        } catch (error: any) {
          if (error?.http_code !== 404 && error?.error?.http_code !== 404) throw error;
        }
        if (quarantineExists) {
          await cloudinary.uploader.rename(quarantineId, publicId, {
            resource_type: resourceType as any,
            type: 'authenticated',
            to_type: 'upload',
            invalidate: true,
          });
        }
      }
    }

    if (file.moderationOriginalPath?.startsWith('cloudinary:')) {
      if (!file.path?.startsWith('cloudinary:')) return false;
      const [, originalResourceType, ...originalIdParts] = file.moderationOriginalPath.split(':');
      const [, currentResourceType, ...currentIdParts] = file.path.split(':');
      const originalId = originalIdParts.join(':');
      const currentId = currentIdParts.join(':');
      if (!originalId || !currentId || originalResourceType !== currentResourceType) return false;

      // Retry safely if the asset was already renamed back but the metadata
      // update failed on the previous restoration attempt.
      let alreadyRestored = false;
      try {
        await cloudinary.api.resource(originalId, { resource_type: currentResourceType, type: 'upload' });
        alreadyRestored = true;
      } catch (error: any) {
        if (error?.http_code !== 404 && error?.error?.http_code !== 404) throw error;
      }
      if (!alreadyRestored) {
        await cloudinary.uploader.rename(currentId, originalId, {
          resource_type: currentResourceType as any,
          type: 'authenticated',
          to_type: 'upload',
          invalidate: true,
        });
      }
      await prisma.uploadedFile.update({
        where: { id: file.id },
        data: {
          path: file.moderationOriginalPath,
          url: file.moderationOriginalUrl || file.url,
          deletedAt: null,
          moderationOriginalPath: null,
          moderationOriginalUrl: null,
        },
      });
      return true;
    }

    await prisma.uploadedFile.update({
      where: { id: file.id },
      data: { deletedAt: null },
    });
    return true;
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