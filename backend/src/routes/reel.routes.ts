import { Router } from "express";
import { authenticateJWT, optionallyAuthenticateJWT } from "../middleware/auth.middleware";
import {
  getReels,
  getReelById,
  likeReel,
  commentOnReel,
  getReelComments,
  saveReel,
  incrementReelViews,
  deleteReelComment,
  deleteReel,
  createReelDraft,
  setReelUploading,
  finalizeReel,
  failReel,
} from "../controllers/reel.controller";

const router = Router();

// Public routes
router.get("/", optionallyAuthenticateJWT, getReels);
router.get("/:id", getReelById);
router.get("/:id/comments", getReelComments);
router.post("/:id/views", authenticateJWT, incrementReelViews);

// Background-publish lifecycle (registered before the `/:id` routes so the
// literal `draft` id is never captured; `POST /` now creates a draft).
router.post("/", authenticateJWT, createReelDraft);
router.post("/:id/uploading", authenticateJWT, setReelUploading);
router.post("/:id/finalize", authenticateJWT, finalizeReel);
router.post("/:id/fail", authenticateJWT, failReel);

// Protected routes
router.post("/:id/like", authenticateJWT, likeReel);
router.post("/:id/save", authenticateJWT, saveReel);
router.post("/:id/comments", authenticateJWT, commentOnReel);
router.delete("/:id/comments/:commentId", authenticateJWT, deleteReelComment);
router.delete("/:id", authenticateJWT, deleteReel);

export default router;