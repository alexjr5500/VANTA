import { Router } from "express";
import multer from "multer";
import { authenticateJWT } from "../middleware/auth.middleware";
import {
  createStory,
  getStories,
  getStoryById,
  viewStory,
  deleteStory,
  reshareStory,
  likeStory,
  unlikeStory,
  getStoryComments,
  addStoryComment,
  getStoryViewers,
} from "../controllers/story.controller";
import { upload } from "../services";

const router = Router();

// Public route for viewing individual stories
router.get("/:id", getStoryById);

// Protected routes
router.post("/", authenticateJWT, upload.single("media"), createStory);
router.get("/", authenticateJWT, getStories);
router.post("/:id/view", authenticateJWT, viewStory);
router.delete("/:id", authenticateJWT, deleteStory);
router.post("/:id/reshare", authenticateJWT, reshareStory);
router.post("/:id/like", authenticateJWT, likeStory);
router.delete("/:id/like", authenticateJWT, unlikeStory);
router.get("/:id/comments", authenticateJWT, getStoryComments);
router.post("/:id/comments", authenticateJWT, addStoryComment);
router.get("/:id/viewers", authenticateJWT, getStoryViewers);

export default router;