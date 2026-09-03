import { Router } from "express";
import { authenticateJWT } from "../middleware/auth.middleware";
import {
  createCommunity,
  getCommunities,
  getCommunityById,
  joinCommunity,
  leaveCommunity,
  createCommunityPost,
  getCommunityPosts,
  updateCommunity,
  deleteCommunity,
} from "../controllers/community.controller";

const router = Router();

// Public routes
router.get("/", getCommunities);
router.get("/:id", getCommunityById);
router.get("/:id/posts", getCommunityPosts);

// Protected routes
router.post("/", authenticateJWT, createCommunity);
router.post("/:id/join", authenticateJWT, joinCommunity);
router.post("/:id/leave", authenticateJWT, leaveCommunity);
router.post("/:id/posts", authenticateJWT, createCommunityPost);
router.put("/:id", authenticateJWT, updateCommunity);
router.delete("/:id", authenticateJWT, deleteCommunity);

export default router;