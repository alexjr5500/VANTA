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
} from "../controllers/channel.controller";

const router = Router();

// Public routes
router.get("/", getChannels);
router.get("/:id/messages", getChannelMessages);

// Protected routes
router.post("/", authenticateJWT, createChannel);
router.get("/:id", authenticateJWT, getChannelById);
router.put("/:id", authenticateJWT, updateChannel);
router.post("/:id/join", authenticateJWT, joinChannel);
router.post("/:id/leave", authenticateJWT, leaveChannel);
router.post("/:id/messages", authenticateJWT, sendChannelMessage);
router.delete("/:id", authenticateJWT, deleteChannel);

export default router;