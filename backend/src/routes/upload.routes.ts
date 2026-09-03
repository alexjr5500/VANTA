import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { authenticateJWT } from "../middleware/auth.middleware";
import {
  upload,
  uploadImage,
  uploadVideo,
  uploadAvatarMulter,
  uploadBannerMulter,
  uploadThumbnail,
  uploadDocument,
} from "../services";
import {
  uploadFile,
  uploadMultipleFiles,
  uploadAvatar,
  uploadBanner,
  uploadProfileMedia,
  uploadStreamThumbnail,
  uploadGroupAvatar,
  uploadChannelAvatar,
  uploadCommunityAvatar,
  uploadCommunityBanner,
  uploadVerificationDocument,
  uploadMessageAttachment,
  deleteUploadedFile,
  getUserFiles,
  uploadReel,
  uploadReelWithThumbnail,
} from "../controllers/upload.controller";

const router = Router();

const handleUploadError = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE"
      ? "File is too large. Please choose a smaller file."
      : "File upload failed. Please try again.";
    res.status(413).json({ error: message });
    return;
  }

  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(400).json({ error: "Upload failed" });
};

router.use(authenticateJWT);

// ============================================================================
// GENERIC UPLOADS
// ============================================================================

// Single file upload (images, videos, audio, documents)
router.post("/", upload.single("file"), uploadFile);

// Multiple file upload (max 10 files)
router.post("/multiple", upload.array("files", 10), uploadMultipleFiles);

// ============================================================================
// PROFILE UPLOADS
// ============================================================================

// Avatar upload (5MB max, images only)
router.post("/avatar", uploadAvatarMulter.single("avatar"), uploadAvatar);

// Banner upload (10MB max, images only)
router.post("/banner", uploadBannerMulter.single("banner"), uploadBanner);

// Profile media upload
router.post("/profile-media", uploadImage.single("media"), uploadProfileMedia);

// ============================================================================
// LIVE STREAM UPLOADS
// ============================================================================

// Live stream thumbnail (5MB max, images only)
router.post("/thumbnail", uploadThumbnail.single("thumbnail"), uploadStreamThumbnail);

// ============================================================================
// GROUP / CHANNEL / COMMUNITY UPLOADS
// ============================================================================

// Group avatar
router.post("/groups/:id/avatar", uploadAvatarMulter.single("avatar"), uploadGroupAvatar);

// Channel avatar
router.post("/channels/:id/avatar", uploadAvatarMulter.single("avatar"), uploadChannelAvatar);

// Community avatar
router.post("/communities/:id/avatar", uploadAvatarMulter.single("avatar"), uploadCommunityAvatar);

// Community banner
router.post("/communities/:id/banner", uploadBannerMulter.single("banner"), uploadCommunityBanner);

// ============================================================================
// VERIFICATION DOCUMENTS
// ============================================================================

// Verification document upload (PDF, DOC, TXT - 10MB max)
router.post("/verification", uploadDocument.single("document"), uploadVerificationDocument);

// ============================================================================
// MESSAGE ATTACHMENTS
// ============================================================================

// Message attachment upload
router.post("/message", upload.single("file"), uploadMessageAttachment);

// ============================================================================
// REELS
// ============================================================================

// Reel upload (video only, 100MB max)
router.post("/reel", uploadVideo.single("video"), uploadReel);

// Reel upload with thumbnail (multipart: video + thumbnail)
router.post(
  "/reel/with-thumbnail",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  uploadReelWithThumbnail
);

// ============================================================================
// FILE MANAGEMENT
// ============================================================================

// Get user's uploaded files
router.get("/files", getUserFiles);

// Delete a file
router.delete("/files/:fileId", deleteUploadedFile);

// Multer forwards parsing/limit/filter failures here. Without this middleware,
// clients receive an HTML 500 response and cannot present a useful retry error.
router.use(handleUploadError);

export default router;