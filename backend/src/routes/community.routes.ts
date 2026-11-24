import { Router } from "express";
import { authenticateJWT, AuthRequest } from "../middleware/auth.middleware";
import { getCommunityInsights } from "../services/community-insights";
import {
  createCommunity,
  getCommunities,
  getCommunityById,
  getDiscoverCommunities,
  getDiscoverCommunityById,
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

// Communities discovery directory (public Groups & Channels). Registered
// BEFORE /:id so these dedicated routes always win over the legacy community
// by-id/segment handlers.
router.get("/discover", authenticateJWT, getDiscoverCommunities);
router.get("/discover/:id", authenticateJWT, getDiscoverCommunityById);

// Admin-only per-entity insights. Unauthorized and nonexistent ids have the
// same response to avoid exposing private community existence.
router.get("/manage/:kind/:id/insights", authenticateJWT, async (req: AuthRequest, res) => {
  const kind = req.params.kind;
  const userId = req.user?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (kind !== "group" && kind !== "channel") { res.status(404).json({ error: "Community unavailable" }); return; }
  try {
    const result = await getCommunityInsights(kind, req.params.id, userId);
    if (!result) { res.status(404).json({ error: "Community unavailable" }); return; }
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json(result);
  } catch {
    res.status(500).json({ error: "Community insights are temporarily unavailable" });
  }
});

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