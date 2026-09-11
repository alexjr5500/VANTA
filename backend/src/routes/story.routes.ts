import { Router } from "express";
import multer from "multer";
import { authenticateJWT } from "../middleware/auth.middleware";
import {
  createStory,
  getStories,
  getStatusUsage,
  getStoryById,
  viewStory,
  deleteStory,
  reshareStory,
  likeStory,
  unlikeStory,
  getStoryComments,
  addStoryComment,
  deleteStoryComment,
  getStoryViewers,
} from "../controllers/story.controller";
import { upload } from "../services";

const router = Router();

// NOTE: `/usage` MUST be registered before the parameterised `/:id` route so
// Express routes `GET /usage` here instead of treating "usage" as a story id.
router.get("/usage", authenticateJWT, getStatusUsage);

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
router.delete("/:id/comments/:commentId", authenticateJWT, deleteStoryComment);
router.get("/:id/viewers", authenticateJWT, getStoryViewers);

export default router;