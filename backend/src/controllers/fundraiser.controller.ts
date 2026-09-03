import { Response } from "express";
import { Role } from "../security";
import { AuthRequest } from "../middleware/auth.middleware";
import { fundraiserService } from "../services/fundraiser.service";
import { prisma } from "../prisma";

// ============================================================================
// PUBLIC DISCOVERY
// ============================================================================

export const getCategories = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categories = await fundraiserService.getCategories(false);
    res.status(200).json(categories);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const listFundraisers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await fundraiserService.listPublic({
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
      search: typeof req.query.search === "string" ? req.query.search.slice(0, 100) : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
    });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getPublicFundraiser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const slug = String(req.params.slug || "");
    const viewerUserId = req.user?.userId;
    const result = await fundraiserService.getPublicBySlug(slug, viewerUserId, true);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    if (message === "NOT_FOUND") {
      res.status(404).json({ error: "Fundraiser not found or not publicly available." });
      return;
    }
    res.status(400).json({ error: message });
  }
};

export const getFundraiserUpdates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const slug = String(req.params.slug || "");
    const fundraiser = await prisma.fundraiser.findUnique({ where: { slug } });
    if (!fundraiser) {
      res.status(404).json({ error: "Fundraiser not found." });
      return;
    }
    const updates = await fundraiserService.listUpdates(fundraiser.id);
    res.status(200).json(updates);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getFundraiserAudit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const fundraiserId = String(req.params.id || "");
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser || fundraiser.ownerId !== userId) {
      res.status(403).json({ error: "You do not have permission to view this fundraiser's audit history." });
      return;
    }
    const logs = await prisma.fundraiserAuditLog.findMany({
      where: { fundraiserId },
      orderBy: { createdAt: "asc" },
    });
    const rows = logs.map((row) => {
      let metadata: any = null;
      if (row.metadata) {
        try { metadata = JSON.parse(row.metadata); } catch { metadata = row.metadata; }
      }
      return { ...row, metadata };
    });
    res.status(200).json(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};
// ============================================================================
// OWNER DRAFTS & LIFECYCLE
// ============================================================================

export const createDraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const draft = await fundraiserService.createDraft(userId, req.body || {});
    res.status(201).json(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const listMyFundraisers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const fundraisers = await fundraiserService.listMyFundraisers(userId);
    res.status(200).json(fundraisers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const getMyFundraiser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const fundraiser = await fundraiserService.getDraft(userId, String(req.params.id || ""));
    res.status(200).json(fundraiser);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const updateMyFundraiser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const fundraiser = await fundraiserService.updateDraft(userId, String(req.params.id || ""), req.body || {});
    res.status(200).json(fundraiser);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const submitForReview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const fundraiser = await fundraiserService.submitForReview(userId, String(req.params.id || ""));
    res.status(200).json({ message: "Fundraiser submitted for review.", fundraiser });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const cancelMyFundraiser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const fundraiser = await fundraiserService.cancelOwn(userId, String(req.params.id || ""));
    res.status(200).json({ message: "Fundraiser cancelled.", fundraiser });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const deleteMyFundraiser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const result = await fundraiserService.deleteOwnDraft(userId, String(req.params.id || ""));
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// UPDATES
// ============================================================================

export const addUpdate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const update = await fundraiserService.addUpdate(userId, String(req.params.id || ""), {
      title: typeof req.body?.title === "string" ? req.body.title : undefined,
      body: typeof req.body?.body === "string" ? req.body.body : "",
      media: Array.isArray(req.body?.media) ? req.body.media : [],
    });
    res.status(201).json(update);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};
// ============================================================================
// EVIDENCE (PRIVATE — no public URLs)
// ============================================================================

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN, Role.CEO];

const parseRoleForEvidence = (role?: string): Role | null => {
  if (!role) return null;
  const upper = String(role).toUpperCase();
  if (upper === "ADMIN" || upper === "ADMINISTRATOR") return Role.ADMIN;
  if (upper === "SUPER_ADMIN") return Role.SUPER_ADMIN;
  if (upper === "CEO") return Role.CEO;
  return null;
};

const canAccessEvidence = async (req: AuthRequest, fundraiserId: string): Promise<boolean> => {
  const userId = req.user?.userId;
  if (!userId) return false;
  const role = parseRoleForEvidence(req.user?.role);
  if (role && ADMIN_ROLES.includes(role)) return true;
  const fundraiser = await prisma.fundraiser.findUnique({
    where: { id: fundraiserId },
    select: { ownerId: true },
  });
  return Boolean(fundraiser && fundraiser.ownerId === userId);
};

export const uploadEvidence = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: "A file is required." });
      return;
    }
    const label = typeof req.body?.label === "string" ? req.body.label : undefined;
    const record = await fundraiserService.addEvidence(userId, String(req.params.id || ""), file, label);
    res.status(201).json(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const listMyEvidence = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const fundraiserId = String(req.params.id || "");
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser || fundraiser.ownerId !== userId) {
      res.status(403).json({ error: "You do not have permission to view this evidence." });
      return;
    }
    const evidence = await fundraiserService.listEvidence(fundraiserId);
    res.status(200).json(evidence);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const streamEvidence = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const fundraiserId = String(req.params.id || "");
    const evidenceId = String(req.params.evidenceId || "");
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const role = parseRoleForEvidence(req.user?.role);
    const isAdmin = role ? ADMIN_ROLES.includes(role) : false;

    if (!isAdmin && !(await canAccessEvidence(req, fundraiserId))) {
      res.status(403).json({ error: "You do not have permission to access this evidence." });
      return;
    }

    const file = await fundraiserService.resolveEvidenceFile(fundraiserId, evidenceId, userId, isAdmin);
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(file.size));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
    res.sendFile(file.absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};
// ============================================================================
// DONATIONS & REPORTS
// ============================================================================

export const donate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as { amount?: number; message?: string; anonymous?: boolean };
    if (!body.amount || Number(body.amount) <= 0) {
      res.status(400).json({ error: "Please choose a donation amount." });
      return;
    }
    const result = await fundraiserService.donate(userId, String(req.params.id || ""), {
      amount: Number(body.amount),
      message: typeof body.message === "string" ? body.message : undefined,
      anonymous: Boolean(body.anonymous),
    });
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const reportFundraiser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as { reason?: string; details?: string };
    if (!body.reason) {
      res.status(400).json({ error: "Please provide a reason for reporting this fundraiser." });
      return;
    }
    const report = await fundraiserService.createReport(userId, String(req.params.id || ""), {
      reason: body.reason,
      details: typeof body.details === "string" ? body.details : undefined,
    });
    res.status(201).json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const shareFundraiser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const destination = typeof req.body?.destination === "string" ? req.body.destination : "COPY_LINK";
    const result = await fundraiserService.recordShare(String(req.params.id || ""), userId, destination);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// ADMIN REVIEW
// ============================================================================

export const adminListFundraisers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await fundraiserService.adminListFundraisers({
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      search: typeof req.query.search === "string" ? req.query.search.slice(0, 100) : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
    });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminGetFundraiser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const detail = await fundraiserService.adminGetFundraiser(String(req.params.id || ""));
    res.status(200).json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminApprove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as { publish?: boolean; note?: string; verified?: boolean };
    const result = await fundraiserService.adminApprove(adminId, String(req.params.id || ""), {
      publish: body.publish !== false,
      note: typeof body.note === "string" ? body.note : undefined,
      verified: Boolean(body.verified),
    });
    res.status(200).json({ message: "Fundraiser approved.", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminRequestMoreInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as { message?: string };
    const result = await fundraiserService.adminRequestMoreInfo(adminId, String(req.params.id || ""), body.message || "");
    res.status(200).json({ message: "More information requested.", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminReject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as { reason?: string };
    const result = await fundraiserService.adminReject(adminId, String(req.params.id || ""), body.reason || "");
    res.status(200).json({ message: "Fundraiser rejected.", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};
export const adminSuspend = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as { reason?: string };
    const result = await fundraiserService.adminSuspend(adminId, String(req.params.id || ""), body.reason || "");
    res.status(200).json({ message: "Fundraiser suspended.", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminUnsuspend = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const result = await fundraiserService.adminUnsuspend(adminId, String(req.params.id || ""));
    res.status(200).json({ message: "Fundraiser restored.", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminComplete = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const result = await fundraiserService.adminComplete(adminId, String(req.params.id || ""));
    res.status(200).json({ message: "Fundraiser completed.", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminSetVerified = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as { verified?: boolean; note?: string };
    const fundraiser = await fundraiserService.adminSetVerified(adminId, String(req.params.id || ""), Boolean(body.verified), typeof body.note === "string" ? body.note : undefined);
    res.status(200).json({ message: "Verification updated.", fundraiser });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminToggleFeatured = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as { featured?: boolean };
    const fundraiser = await fundraiserService.adminToggleFeatured(adminId, String(req.params.id || ""), Boolean(body.featured));
    res.status(200).json({ message: "Featured state updated.", fundraiser });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminListReports = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reports = await fundraiserService.adminListReports({
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    });
    res.status(200).json(reports);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};

export const adminResolveReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body || {}) as { status?: string; note?: string };
    const result = await fundraiserService.adminResolveReport(adminId, String(req.params.reportId || ""), {
      status: body.status || "",
      note: typeof body.note === "string" ? body.note : undefined,
    });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(400).json({ error: message });
  }
};