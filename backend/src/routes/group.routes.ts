import { Router } from "express";
import { authenticateJWT } from "../middleware/auth.middleware";
import {
  createGroup,
  getMyGroups,
  getGroupById,
  updateGroup,
  addGroupMember,
  removeGroupMember,
  joinGroup,
  sendGroupMessage,
  getGroupMessages,
  deleteGroup,
  transferGroupOwnership,
} from "../controllers/group.controller";

const router = Router();

router.use(authenticateJWT);

router.get("/", getMyGroups);
router.post("/", createGroup);
router.get("/:id", getGroupById);
router.put("/:id", updateGroup);
router.post("/:id/members", addGroupMember);
router.delete("/:id/members/:targetUserId", removeGroupMember);
router.post("/:id/join", joinGroup);
router.post("/:id/messages", sendGroupMessage);
router.get("/:id/messages", getGroupMessages);
router.post("/:id/transfer-ownership", transferGroupOwnership);
router.delete("/:id", deleteGroup);

export default router;