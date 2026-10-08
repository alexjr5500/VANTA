import { Router } from "express";
import { authenticateJWT } from "../middleware/auth.middleware";
import {
  registerDevice,
  listDevices,
  unregisterDevice,
  unregisterByToken,
  getPushConfig,
} from "../controllers/push.controller";

const router = Router();

/**
 * Public, read-only push configuration (VAPID public key etc.). Rate limited
 * like every other API route.
 */
router.get("/config", getPushConfig);

// Everything below requires an authenticated session.
router.use(authenticateJWT);

router.post("/devices", registerDevice);
router.get("/devices", listDevices);
router.delete("/devices/:id", unregisterDevice);
router.delete("/devices", unregisterByToken);

export default router;