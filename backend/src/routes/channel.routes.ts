import { Router } from "express";
import { authenticateJWT } from "../middleware/auth.middleware";
import {
  createChannel,
  getChannels,
  getChannelById,
  updateChannel,
  joinChannel,
  leaveChannel,
  sendChannelMessage,
  getChannelMessages,
  deleteChannel,
  transferChannelOwnership,
} from "../controllers/channel.controller";

const router = Router();

// Public routes — discovery only. Channel posts are never public: any user
// reading messages must authenticate AND be a channel member (enforced in the
// channel service).
router.get("/", getChannels);

// Protected routes
router.post("/", authenticateJWT, createChannel);
router.get("/:id", authenticateJWT, getChannelById);
router.put("/:id", authenticateJWT, updateChannel);
router.post("/:id/join", authenticateJWT, joinChannel);
router.post("/:id/leave", authenticateJWT, leaveChannel);
router.post("/:id/messages", authenticateJWT, sendChannelMessage);
router.get("/:id/messages", authenticateJWT, getChannelMessages);
router.post("/:id/transfer-ownership", authenticateJWT, transferChannelOwnership);
router.delete("/:id", authenticateJWT, deleteChannel);

export default router;