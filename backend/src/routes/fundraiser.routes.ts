import { NextFunction, Request, Response, Router } from "express";
import { authenticateJWT, optionallyAuthenticateJWT, AuthRequest } from "../middleware/auth.middleware";
import { authenticate, requireRole, Role } from "../security";
import { uploadEvidence } from "../services";
import {
  getCategories,
  listFundraisers,
  getPublicFundraiser,
  getFundraiserUpdates,
  getFundraiserAudit,
  createDraft,
  listMyFundraisers,
  getMyFundraiser,
  updateMyFundraiser,
  submitForReview,
  cancelMyFundraiser,
  deleteMyFundraiser,
  addUpdate,
  uploadEvidence as uploadEvidenceHandler,
  listMyEvidence,
  streamEvidence,
  donate,
  reportFundraiser,
  shareFundraiser,
  adminListFundraisers,
  adminGetFundraiser,
  adminApprove,
  adminRequestMoreInfo,
  adminReject,
  adminSuspend,
  adminUnsuspend,
  adminComplete,
  adminSetVerified,
  adminToggleFeatured,
  adminListReports,
  adminResolveReport,
} from "../controllers/fundraiser.controller";

const router = Router();

// ============================================================================
// PUBLIC ROUTES
// ============================================================================

router.get("/categories", getCategories);
router.get("/", listFundraisers);

// Optional auth lets the public page know whether the viewer owns the fundraiser.
router.get("/:slug", optionallyAuthenticateJWT, getPublicFundraiser);
router.get("/:slug/updates", getFundraiserUpdates);

// ============================================================================
// AUTHENTICATED USER ROUTES
// ============================================================================

router.use(authenticateJWT);

// Owner drafts & lifecycle
router.post("/drafts", createDraft);
router.get("/my", listMyFundraisers);
router.get("/my/:id", getMyFundraiser);
router.put("/my/:id", updateMyFundraiser);
router.post("/my/:id/submit", submitForReview);
router.post("/my/:id/cancel", cancelMyFundraiser);
router.delete("/my/:id", deleteMyFundraiser);
router.get("/my/:id/audit", getFundraiserAudit);

// Updates
router.post("/my/:id/updates", addUpdate);

// Evidence (private storage — only metadata returned; bytes streamed via /file)
router.post("/:id/evidence", uploadEvidence.single("file"), uploadEvidenceHandler);
router.get("/:id/evidence", listMyEvidence);
router.get("/:id/evidence/:evidenceId/file", streamEvidence);

// Multer forwards parsing/limit/filter failures here. Without this middleware,
// clients receive an HTML 500 response and cannot present a useful retry error.
router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    const message = err.message || "Upload failed";
    if (message.toLowerCase().includes("file too large") || message.toLowerCase().includes("limit")) {
      res.status(413).json({ error: "Evidence file is too large. The maximum size is 50MB." });
      return;
    }
    if (message.toLowerCase().includes("not allowed") || message.toLowerCase().includes("not supported")) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
    return;
  }
  res.status(400).json({ error: "Upload failed" });
});

// Donations & reports
router.post("/:id/donate", donate);
router.post("/:id/report", reportFundraiser);
router.post("/:id/share", shareFundraiser);

// ============================================================================
// ADMIN ROUTES (require ADMIN / CEO / SUPER_ADMIN)
// ============================================================================

const adminRouter = Router();
adminRouter.use(authenticate);
adminRouter.use(requireRole(Role.ADMIN, Role.CEO, Role.SUPER_ADMIN));

adminRouter.get("/list", adminListFundraisers);
adminRouter.get("/reports", adminListReports);
adminRouter.post("/reports/:reportId/resolve", adminResolveReport);
adminRouter.get("/:id", adminGetFundraiser);
adminRouter.post("/:id/approve", adminApprove);
adminRouter.post("/:id/request-info", adminRequestMoreInfo);
adminRouter.post("/:id/reject", adminReject);
adminRouter.post("/:id/suspend", adminSuspend);
adminRouter.post("/:id/unsuspend", adminUnsuspend);
adminRouter.post("/:id/complete", adminComplete);
adminRouter.post("/:id/verify", adminSetVerified);
adminRouter.post("/:id/feature", adminToggleFeatured);
adminRouter.get("/:id/evidence/:evidenceId/file", streamEvidence);

router.use("/admin", adminRouter);

export default router;