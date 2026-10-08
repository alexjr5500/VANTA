import { Router } from "express";
import { authenticateJWT } from "../middleware/auth.middleware";
import { callSessionService } from "../services/call-session.service";

const router = Router();

router.use(authenticateJWT);

/**
 * Callee-side call lookup used by the push "Answer" action. Returns the stored
 * SDP offer + buffered ICE candidates ONLY when the requesting user is the
 * callee and the call is still RINGING (or their own ANSWERED session). The
 * payload never contains another user's call data and never trusts the client:
 * the server is authoritative for call existence/authorization/state.
 */
router.get("/:callId", async (req: any, res: any) => {
  try {
    const userId = req.user?.userId;
    const callId = String(req.params.callId || "").slice(0, 200);
    if (!callId) {
      res.status(400).json({ error: "callId is required" });
      return;
    }
    const result = await callSessionService.getCallForAnswer(callId, userId);
    if (!result.ok) {
      res.status(200).json({ success: false, code: result.reason });
      return;
    }
    res.status(200).json({ success: true, call: result.session });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Could not load call" });
  }
});

export default router;