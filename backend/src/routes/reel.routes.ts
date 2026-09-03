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
} from "../controllers/reel.controller";

const router = Router();

// Public routes
router.get("/", optionallyAuthenticateJWT, getReels);
router.get("/:id", getReelById);
router.get("/:id/comments", getReelComments);
router.post("/:id/views", authenticateJWT, incrementReelViews);

// Protected routes
router.post("/:id/like", authenticateJWT, likeReel);
router.post("/:id/save", authenticateJWT, saveReel);
router.post("/:id/comments", authenticateJWT, commentOnReel);
router.delete("/:id/comments/:commentId", authenticateJWT, deleteReelComment);
router.delete("/:id", authenticateJWT, deleteReel);

export default router;