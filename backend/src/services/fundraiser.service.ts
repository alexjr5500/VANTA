import { prisma } from "../prisma";
import fs from "fs";
import path from "path";
import { auditLog } from "../security";
import { notificationService } from "./notification.service";
import {
  MIN_FUNDRAISER_DONATION_COINS,
  currencyToCoins,
  calculateFundraiserFeeCoins,
} from "../config/wallet.config";
import { walletService } from "./wallet.service";
import { evidenceUploadDir } from "./upload.service";

// ============================================================================
// FUNDRAISER STATUS MODEL (single source of truth)
// ============================================================================

export const FUNDRAISER_STATUS = {
  DRAFT: "DRAFT",
  UNDER_REVIEW: "UNDER_REVIEW",
  MORE_INFORMATION_REQUIRED: "MORE_INFORMATION_REQUIRED",
  APPROVED: "APPROVED",
  PUBLISHED: "PUBLISHED",
  SUSPENDED: "SUSPENDED",
  REJECTED: "REJECTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type FundraiserStatus = (typeof FUNDRAISER_STATUS)[keyof typeof FUNDRAISER_STATUS];

export const RAISING_FOR_OPTIONS = ["SELF", "FAMILY_MEMBER", "FRIEND", "COMMUNITY", "OTHER"] as const;
export const PAYOUT_METHODS = ["WALLET_BALANCE", "BANK_TRANSFER", "USDT"] as const;

export const PUBLIC_BROWSEABLE_STATUSES: FundraiserStatus[] = [
  FUNDRAISER_STATUS.PUBLISHED,
  FUNDRAISER_STATUS.COMPLETED,
];

/** Statuses a donor may place a donation against. */
export const DONATABLE_STATUSES: FundraiserStatus[] = [
  FUNDRAISER_STATUS.PUBLISHED,
];

const isPubliclyVisible = (status: string) => PUBLIC_BROWSEABLE_STATUSES.includes(status as FundraiserStatus);

// ============================================================================
// INPUT & OUTPUT SHAPES
// ============================================================================

export interface FundraiserDraftInput {
  title?: string;
  summary?: string;
  categoryId?: string;
  raisingFor?: string;
  country?: string;
  location?: string;
  currency?: string;
  targetAmount?: number;
  deadline?: string;
  story?: string;
  fundsNeededFor?: string;
  fundsUsage?: string;
  whoBenefits?: string;
  coverMediaType?: string;
  coverMediaUrl?: string;
  coverMediaThumbnailUrl?: string;
  beneficiaryName?: string;
  beneficiaryRelationship?: string;
  beneficiarySummary?: string;
  payoutMethod?: string;
  organizerNotes?: string;
}

export interface DonationInput {
  amount: number;
  message?: string;
  anonymous?: boolean;
}

export interface SubmissionValidationResult {
  ok: boolean;
  errors: string[];
}

export interface PublicSupportersItem {
  id: string;
  amount: number;
  currency: string;
  message: string | null;
  anonymous: boolean;
  donor: { id: string; username: string; fullName: string | null; avatar: string | null } | null;
  createdAt: string;
}
// ============================================================================
// CATEGORY HELPERS
// ============================================================================

const DEFAULT_CATEGORIES = [
  { slug: "medical", name: "Medical", description: "Medical bills, treatment, surgeries and care", emoji: "🩺" },
  { slug: "emergency", name: "Emergency", description: "Urgent unexpected emergencies", emoji: "🚨" },
  { slug: "education", name: "Education", description: "Tuition, school fees and learning costs", emoji: "🎓" },
  { slug: "family-support", name: "Family Support", description: "Supporting family essentials and household needs", emoji: "🏠" },
  { slug: "disaster-relief", name: "Disaster Relief", description: "Recovery from disasters and natural events", emoji: "🛟" },
  { slug: "community", name: "Community", description: "Community projects and shared local needs", emoji: "🤝" },
  { slug: "other", name: "Other", description: "Other legitimate causes and personal needs", emoji: "💛" },
] as const;

/** Idempotently ensure the default configurable categories exist. */
export async function ensureDefaultCategories(): Promise<void> {
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i += 1) {
    const category = DEFAULT_CATEGORIES[i];
    await prisma.fundraiserCategory.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        emoji: category.emoji,
        sortOrder: i + 1,
        isActive: true,
      },
      create: {
        slug: category.slug,
        name: category.name,
        description: category.description,
        emoji: category.emoji,
        sortOrder: i + 1,
        isActive: true,
      },
    });
  }
}

export async function getCategories(includeInactive = false) {
  await ensureDefaultCategories();
  return prisma.fundraiserCategory.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}
// ============================================================================
// SLUG & VALIDATION HELPERS
// ============================================================================

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "fundraiser";
}

async function uniqueSlug(base: string): Promise<string> {
  const clean = slugify(base);
  const existing = await prisma.fundraiser.findMany({
    where: { slug: { startsWith: clean } },
    select: { slug: true },
  });
  const used = new Set(existing.map((row) => row.slug));
  if (!used.has(clean)) return clean;
  let n = 2;
  while (used.has(`${clean}-${n}`)) n += 1;
  return `${clean}-${n}`;
}

const clampText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
};

export function validateSubmission(fundraiser: any): SubmissionValidationResult {
  const errors: string[] = [];
  if (!fundraiser.title || String(fundraiser.title).trim().length < 3) errors.push("A fundraiser title of at least 3 characters is required.");
  if (!fundraiser.categoryId) errors.push("Please choose a category.");
  if (!fundraiser.summary || String(fundraiser.summary).trim().length < 10) errors.push("A short summary of at least 10 characters is required.");
  if (!fundraiser.story || String(fundraiser.story).trim().length < 20) errors.push("Please tell your fundraiser story (at least 20 characters).");
  if (!fundraiser.country) errors.push("Please select a country.");
  if (!fundraiser.targetAmount || Number(fundraiser.targetAmount) <= 0) errors.push("Please set a target amount greater than zero.");
  if (!fundraiser.deadline) {
    errors.push("Please set a fundraising deadline.");
  } else {
    const deadline = new Date(fundraiser.deadline);
    if (Number.isNaN(deadline.getTime())) errors.push("The fundraising deadline is invalid.");
    else if (deadline.getTime() <= Date.now()) errors.push("The fundraising deadline must be in the future.");
  }
  if (!fundraiser.beneficiaryName) errors.push("Please tell us who the beneficiary is.");
  return { ok: errors.length === 0, errors };
}

// ============================================================================
// AUDIT TRAIL
// ============================================================================

async function writeAudit(
  fundraiserId: string,
  actorId: string | null,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.fundraiserAuditLog.create({
      data: { fundraiserId, actorId, action, fromStatus, toStatus, metadata: metadata ? JSON.stringify(metadata) : null },
    });
  } catch (error) {
    console.error("[Fundraiser] audit write failed:", error);
  }
}

function collectAuditRows(rows: any[]): any[] {
  return rows
    .map((row) => {
      let metadata: any = null;
      if (row.metadata) {
        try { metadata = JSON.parse(row.metadata); } catch { metadata = row.metadata; }
      }
      return { ...row, metadata };
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
// ============================================================================
// FUNDRAISER SERVICE
// ============================================================================

export class FundraiserService {
  /**
   * Normalize a draft input into Prisma update/create data. Handles safe
   * truncation, type coercion and optional field mapping. Server-side
   * validation must never rely on the client.
   */
  private toData(input: FundraiserDraftInput) {
    const data: any = {};
    if (input.title !== undefined) {
      const title = String(input.title).trim();
      if (title.length < 3) throw new Error("A fundraiser title of at least 3 characters is required.");
      if (title.length > 120) throw new Error("A fundraiser title cannot exceed 120 characters.");
      data.title = title;
    }
    if (input.summary !== undefined) data.summary = clampText(input.summary, 400);
    if (input.categoryId !== undefined) data.categoryId = clampText(input.categoryId, 50);
    if (input.raisingFor !== undefined) {
      const value = String(input.raisingFor).toUpperCase();
      if (!RAISING_FOR_OPTIONS.includes(value as any)) throw new Error("Invalid raising-for option.");
      data.raisingFor = value;
    }
    if (input.country !== undefined) data.country = clampText(input.country, 80);
    if (input.location !== undefined) data.location = clampText(input.location, 120);
    if (input.currency !== undefined) {
      const currency = String(input.currency).toUpperCase().slice(0, 8);
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid currency code.");
      data.currency = currency;
    }
    if (input.targetAmount !== undefined) {
      const amount = Number(input.targetAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Target amount must be a positive number.");
      if (amount > 1_000_000_000) throw new Error("Target amount is too large.");
      data.targetAmount = Math.round(amount * 100) / 100;
    }
    if (input.deadline !== undefined) {
      if (input.deadline === null || input.deadline === "") {
        data.deadline = null;
      } else {
        const deadline = new Date(String(input.deadline));
        if (Number.isNaN(deadline.getTime())) throw new Error("The fundraising deadline is invalid.");
        data.deadline = deadline;
      }
    }
    if (input.story !== undefined) data.story = clampText(input.story, 50_000);
    if (input.fundsNeededFor !== undefined) data.fundsNeededFor = clampText(input.fundsNeededFor, 2_000);
    if (input.fundsUsage !== undefined) data.fundsUsage = clampText(input.fundsUsage, 2_000);
    if (input.whoBenefits !== undefined) data.whoBenefits = clampText(input.whoBenefits, 2_000);
    if (input.coverMediaType !== undefined) {
      const type = String(input.coverMediaType || "").toUpperCase();
      if (!["IMAGE", "VIDEO"].includes(type)) throw new Error("Invalid cover media type.");
      data.coverMediaType = type;
    }
    if (input.coverMediaUrl !== undefined) data.coverMediaUrl = clampText(input.coverMediaUrl, 2_000);
    if (input.coverMediaThumbnailUrl !== undefined) data.coverMediaThumbnailUrl = clampText(input.coverMediaThumbnailUrl, 2_000);
    if (input.beneficiaryName !== undefined) data.beneficiaryName = clampText(input.beneficiaryName, 120);
    if (input.beneficiaryRelationship !== undefined) data.beneficiaryRelationship = clampText(input.beneficiaryRelationship, 120);
    if (input.beneficiarySummary !== undefined) data.beneficiarySummary = clampText(input.beneficiarySummary, 1_200);
    if (input.payoutMethod !== undefined) {
      if (input.payoutMethod) {
        const method = String(input.payoutMethod).toUpperCase();
        if (!PAYOUT_METHODS.includes(method as any)) throw new Error("Invalid payout method.");
        data.payoutMethod = method;
      } else {
        data.payoutMethod = null;
      }
    }
    if (input.organizerNotes !== undefined) data.organizerNotes = clampText(input.organizerNotes, 2_000);
    return data;
  }

  /**
   * List fundraiser categories. Public discovery uses `includeInactive = false`
   * while the admin tooling may opt into inactive categories.
   */
  async getCategories(includeInactive = false) {
    return prisma.fundraiserCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  // ------------------------------------------------------------------
  // CREATE / UPDATE (DRAFT)
  // ------------------------------------------------------------------

  /**
   * Only VERIFIED users may create/start fundraisers. This is the server-side
   * authority for the policy — the frontend button state is UX only and must
   * never be relied on for security. Platform staff can still administer and
   * create campaigns even if their own profile badge is disabled.
   */
  async assertCanCreateFundraiser(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { verified: true, role: true, status: true },
    });
    if (!user) throw new Error("User not found.");
    if (user.status !== "ACTIVE") throw new Error("Your account must be active to create a fundraiser.");
    const adminRoles = ["ADMIN", "CEO", "SUPER_ADMIN"];
    if (!user.verified && !adminRoles.includes(String(user.role || "").toUpperCase())) {
      throw new Error("Verification required to create a fundraiser.");
    }
  }

  async createDraft(userId: string, input: FundraiserDraftInput) {
    await this.assertCanCreateFundraiser(userId);
    const data = this.toData(input);
    const title = typeof data.title === "string" ? data.title : "Untitled Fundraiser";
    const slug = await uniqueSlug(title);
    return prisma.fundraiser.create({
      data: {
        ownerId: userId,
        slug,
        title,
        status: FUNDRAISER_STATUS.DRAFT,
        ...data,
      },
      include: { category: true },
    });
  }

  async updateDraft(userId: string, fundraiserId: string, input: FundraiserDraftInput) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser || fundraiser.ownerId !== userId) throw new Error("Fundraiser not found or you do not own it.");
    const editable: FundraiserStatus[] = [
      FUNDRAISER_STATUS.DRAFT,
      FUNDRAISER_STATUS.MORE_INFORMATION_REQUIRED,
      FUNDRAISER_STATUS.REJECTED,
    ];
    if (!editable.includes(fundraiser.status as FundraiserStatus)) {
      throw new Error(`A fundraiser in ${fundraiser.status} status cannot be edited.`);
    }
    const data = this.toData(input);
    if (data.title !== undefined && data.title !== fundraiser.title) {
      data.slug = await uniqueSlug(data.title);
    }
    return prisma.fundraiser.update({
      where: { id: fundraiserId },
      data,
      include: { category: true },
    });
  }

  async getDraft(userId: string, fundraiserId: string) {
    const fundraiser = await prisma.fundraiser.findUnique({
      where: { id: fundraiserId },
      include: {
        category: true,
        media: { orderBy: { sortOrder: "asc" } },
        evidence: { select: { id: true, originalName: true, fileType: true, mimeType: true, size: true, label: true, createdAt: true } },
        updates: { orderBy: { createdAt: "desc" }, take: 3 },
        auditLogs: { orderBy: { createdAt: "asc" }, take: 20 },
      },
    });
    if (!fundraiser || fundraiser.ownerId !== userId) throw new Error("Fundraiser not found or you do not own it.");
    return fundraiser;
  }

  async listMyFundraisers(userId: string) {
    return prisma.fundraiser.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: "desc" },
      include: { category: true },
    });
  }

  // ------------------------------------------------------------------
  // SUBMIT FOR REVIEW
  // ------------------------------------------------------------------

  async submitForReview(userId: string, fundraiserId: string) {
    await this.assertCanCreateFundraiser(userId);
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser || fundraiser.ownerId !== userId) throw new Error("Fundraiser not found or you do not own it.");

    if (fundraiser.slug === slugify("Untitled Fundraiser")) {
      throw new Error("Please give your fundraiser a title before submitting.");
    }

    const validation = validateSubmission(fundraiser);
    if (!validation.ok) {
      throw new Error(`Please complete the missing information before submitting: ${validation.errors.join(" ")}`);
    }

    const allowedFrom: FundraiserStatus[] = [
      FUNDRAISER_STATUS.DRAFT,
      FUNDRAISER_STATUS.MORE_INFORMATION_REQUIRED,
      FUNDRAISER_STATUS.REJECTED,
      FUNDRAISER_STATUS.UNDER_REVIEW,
    ];
    if (!allowedFrom.includes(fundraiser.status as FundraiserStatus)) {
      throw new Error(`A fundraiser in ${fundraiser.status} status cannot be submitted.`);
    }

    const previousStatus = fundraiser.status;
    const updated = await prisma.fundraiser.update({
      where: { id: fundraiserId },
      data: { status: FUNDRAISER_STATUS.UNDER_REVIEW, submittedAt: new Date() },
    });

    await writeAudit(fundraiserId, userId, "SUBMITTED", previousStatus, FUNDRAISER_STATUS.UNDER_REVIEW);
    await notificationService.createNotification(
      userId,
      "fundraiser",
      "Fundraiser submitted",
      `Your fundraiser "${updated.title}" has been submitted for review.`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: updated.slug, fundraiserTitle: updated.title, referenceKey: `fundraiser-submitted:${fundraiserId}` }
    );

    return updated;
  }
// ------------------------------------------------------------------
  // PUBLIC LISTING & DETAIL
  // ------------------------------------------------------------------

  async listPublic(options: {
    category?: string;
    sort?: string;
    search?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  } = {}) {
    await ensureDefaultCategories();
    const limit = Math.min(Math.max(options.limit || 20, 1), 50);
    const where: any = {};

    if (options.category && options.category !== "all") {
      const category = await prisma.fundraiserCategory.findUnique({
        where: { slug: options.category },
      });
      where.categoryId = category ? category.id : "__none__";
    }

    if (options.status) {
      const statuses = String(options.status).toUpperCase().split(",");
      where.status = { in: statuses };
    } else {
      where.status = { in: PUBLIC_BROWSEABLE_STATUSES };
    }

    if (options.search) {
      where.OR = [
        { title: { contains: options.search } },
        { summary: { contains: options.search } },
        { country: { contains: options.search } },
        { location: { contains: options.search } },
        { beneficiaryName: { contains: options.search } },
      ];
    }

    const orderBy: any[] = [];
    switch (options.sort) {
      case "ending-soon":
      case "ending":
        orderBy.push({ deadline: "asc" });
        break;
      case "most-supported":
      case "supporters":
        orderBy.push({ supporterCount: "desc" }, { createdAt: "desc" });
        break;
      case "recent":
      case "latest":
      case "recently-verified":
        orderBy.push({ publishedAt: "desc" });
        break;
      case "most-raised":
        orderBy.push({ raisedAmount: "desc" });
        break;
      default:
        orderBy.push({ isFeatured: "desc" }, { createdAt: "desc" });
    }

    const items = await prisma.fundraiser.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        status: true,
        verified: true,
        isFeatured: true,
        country: true,
        location: true,
        currency: true,
        targetAmount: true,
        raisedAmount: true,
        supporterCount: true,
        deadline: true,
        coverMediaType: true,
        coverMediaUrl: true,
        coverMediaThumbnailUrl: true,
        beneficiaryName: true,
        publishedAt: true,
        createdAt: true,
        category: { select: { id: true, slug: true, name: true, emoji: true } },
        owner: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
      },
    });

    const nextCursor = items.length > limit ? items.pop()?.id : undefined;
    return { items, nextCursor };
  }
async getPublicBySlug(slug: string, viewerUserId?: string, incrementViews = true) {
    const fundraiser = await prisma.fundraiser.findUnique({
      where: { slug },
      include: {
        category: true,
        owner: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
        media: { orderBy: { sortOrder: "asc" } },
        updates: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { author: { select: { id: true, username: true, fullName: true, avatar: true } } },
        },
      },
    });
    if (!fundraiser || !isPubliclyVisible(fundraiser.status)) {
      throw new Error("NOT_FOUND");
    }

    if (incrementViews) {
      await prisma.fundraiser.update({ where: { id: fundraiser.id }, data: { viewCount: { increment: 1 } } });
    }

    const recentDonations = await prisma.fundraiserDonation.findMany({
      where: { fundraiserId: fundraiser.id, status: "COMPLETED", anonymous: false },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        amount: true,
        currency: true,
        message: true,
        anonymous: true,
        createdAt: true,
        donor: { select: { id: true, username: true, fullName: true, avatar: true } },
      },
    });

    const supporters: PublicSupportersItem[] = recentDonations
      .filter((s) => !s.anonymous)
      .map((item) => ({
        id: item.id,
        amount: item.amount,
        currency: item.currency,
        message: item.message,
        anonymous: Boolean(item.anonymous),
        donor: item.donor,
        createdAt: item.createdAt.toISOString(),
      }));

    return {
      fundraiser,
      isOwner: viewerUserId ? fundraiser.ownerId === viewerUserId : false,
      supporters,
      deadlinePassed: Boolean(fundraiser.deadline && new Date(fundraiser.deadline).getTime() <= Date.now()),
    };
  }
// ------------------------------------------------------------------
  // CANCEL (OWNER)
  // ------------------------------------------------------------------

  async cancelOwn(userId: string, fundraiserId: string) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser || fundraiser.ownerId !== userId) throw new Error("Fundraiser not found or you do not own it.");
    if (fundraiser.status === FUNDRAISER_STATUS.COMPLETED || fundraiser.status === FUNDRAISER_STATUS.CANCELLED) {
      throw new Error("This fundraiser has already reached a final state.");
    }
    const previousStatus = fundraiser.status;
    const updated = await prisma.fundraiser.update({
      where: { id: fundraiserId },
      data: { status: FUNDRAISER_STATUS.CANCELLED, cancelledAt: new Date() },
    });
    await writeAudit(fundraiserId, userId, "CANCELLED", previousStatus, FUNDRAISER_STATUS.CANCELLED);
    await notificationService.createNotification(
      userId,
      "fundraiser",
      "Fundraiser cancelled",
      `Your fundraiser "${updated.title}" has been cancelled.`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: updated.slug }
    );
    return updated;
  }

  /**
   * Delete a draft owned by the user (removed from their dashboard).
   * Final statuses may never be deleted by the owner.
   */
  async deleteOwnDraft(userId: string, fundraiserId: string) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser || fundraiser.ownerId !== userId) throw new Error("Fundraiser not found or you do not own it.");
    if (!(FUNDRAISER_STATUS.DRAFT === fundraiser.status || FUNDRAISER_STATUS.REJECTED === fundraiser.status)) {
      throw new Error("Only draft or rejected fundraisers can be deleted.");
    }
    await prisma.fundraiser.delete({ where: { id: fundraiserId } });
    return { message: "Fundraiser deleted" };
  }
// ------------------------------------------------------------------
  // UPDATES
  // ------------------------------------------------------------------

  async addUpdate(userId: string, fundraiserId: string, input: { title?: string; body: string; media?: any[] }) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser || fundraiser.ownerId !== userId) throw new Error("Fundraiser not found or you do not own it.");
    if (!(FUNDRAISER_STATUS.PUBLISHED === fundraiser.status || FUNDRAISER_STATUS.COMPLETED === fundraiser.status || FUNDRAISER_STATUS.APPROVED === fundraiser.status)) {
      throw new Error("Updates can only be posted once the fundraiser is live.");
    }
    const body = String(input.body || "").trim();
    if (body.length < 5) throw new Error("An update needs a little more text (at least 5 characters).");
    const title = input.title !== undefined ? String(input.title).trim().slice(0, 140) || null : null;
    const media = Array.isArray(input.media) ? input.media.slice(0, 10) : [];
    for (const item of media) {
      if (!item || typeof item.url !== "string") throw new Error("Update media entries must include a url.");
    }
    const created = await prisma.fundraiserUpdate.create({
      data: {
        fundraiserId,
        authorId: userId,
        title,
        body,
        media: media.length ? JSON.stringify(media) : null,
      },
    });

    await writeAudit(fundraiserId, userId, "UPDATE_POSTED", null, null, { updateId: created.id });
    await notificationService.createNotification(
      userId,
      "fundraiser",
      "Fundraiser update published",
      `Your update on "${fundraiser.title}" is now live.`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, referenceKey: `fundraiser-update:${created.id}` }
    );

    // Notify recent supporters (bounded) when an update is posted.
    const recentDonors = await prisma.fundraiserDonation.findMany({
      where: { fundraiserId, status: "COMPLETED", donorId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { donorId: true },
      distinct: ["donorId"],
    });
    const donorIds = [...new Set(recentDonors.map((d) => d.donorId as string).filter((id): id is string => Boolean(id) && id !== userId))];
    await Promise.all(
      donorIds.map((donorId) =>
        notificationService.createNotification(
          donorId,
          "fundraiser",
          "Fundraiser update",
          `${fundraiser.title} just posted an update.`,
          { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, actorId: userId, referenceKey: `fundraiser-update:${created.id}:${donorId}` }
        )
      )
    );

    return created;
  }

  async listUpdates(fundraiserId: string) {
    return prisma.fundraiserUpdate.findMany({
      where: { fundraiserId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { author: { select: { id: true, username: true, fullName: true, avatar: true } } },
    });
  }
// ------------------------------------------------------------------
  // DONATIONS (VANTA COIN SETTLEMENT VIA EXISTING WALLET ECONOMY)
  // ------------------------------------------------------------------

  /**
   * Place a donation. Coins move atomically inside the existing VANTA wallet
   * system (denominated in the fundraiser currency at 100 coins per unit):
   *  - donor wallet is debited (FUNDRAISER_DONATION tx)
   *  - organizer wallet is credited net of the platform fee (FUNDRAISER_RECEIVED tx)
   *  - fundraiser raisedAmount/supporterCount update
   * The organizer later withdraws through the existing Balance/withdrawal flow.
   */
  async donate(userId: string, fundraiserId: string, input: DonationInput) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser || !DONATABLE_STATUSES.includes(fundraiser.status as FundraiserStatus)) {
      throw new Error("This fundraiser is not currently accepting donations.");
    }
    if (Date.now() > new Date(fundraiser.deadline).getTime()) {
      throw new Error("Sadly this fundraiser has passed its deadline and is no longer accepting donations.");
    }
    if (fundraiser.ownerId === userId) {
      throw new Error("You cannot donate to your own fundraiser.");
    }

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Donation amount must be a positive number.");

    const coins = currencyToCoins(amount);
    if (coins < MIN_FUNDRAISER_DONATION_COINS) {
      throw new Error(`The minimum donation is ${(MIN_FUNDRAISER_DONATION_COINS / 100).toFixed(2)} ${fundraiser.currency} (100 VANTA Coins).`);
    }

    const donorWallet = await walletService.ensureWallet(userId);
    if (donorWallet.isFrozen) throw new Error("Your wallet is frozen. Contact support.");
    if (donorWallet.coinBalance < coins) {
      throw new Error(
        `Insufficient VANTA Coins. You need ${coins.toLocaleString()} coins (${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${fundraiser.currency}) but have ${donorWallet.coinBalance.toLocaleString()}.`
      );
    }

    const feeCoins = calculateFundraiserFeeCoins(coins);
    const netCoins = coins - feeCoins;
    const message = input.message !== undefined ? String(input.message).trim().slice(0, 280) || null : null;
    const anonymous = Boolean(input.anonymous);
    const result = await prisma.$transaction(async (tx) => {
      const currentWallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      if (currentWallet.isFrozen) throw new Error("Your wallet is frozen. Contact support.");
      if (currentWallet.coinBalance < coins) throw new Error("Insufficient VANTA Coins.");

      const updatedDonorWallet = await tx.wallet.update({
        where: { userId },
        data: { coinBalance: { decrement: coins }, totalCoinsSent: { increment: coins } },
      });

      const donorTx = await tx.walletTransaction.create({
        data: {
          walletId: updatedDonorWallet.id,
          userId,
          type: "FUNDRAISER_DONATION",
          amount: coins,
          fee: 0,
          balance: updatedDonorWallet.coinBalance,
          status: "COMPLETED",
          description: `Donation to ${fundraiser.title}`,
          reference: fundraiser.id,
          metadata: JSON.stringify({
            fundraiserId: fundraiser.id,
            fundraiserSlug: fundraiser.slug,
            fundraiserTitle: fundraiser.title,
            anonymous,
            netCoins,
          }),
        },
      });

      // Credit the organizer wallet net of the platform fee.
      const organizerWallet = await tx.wallet.upsert({
        where: { userId: fundraiser.ownerId },
        update: {},
        create: { userId: fundraiser.ownerId },
      });
      const updatedOrganizerWallet = await tx.wallet.update({
        where: { userId: fundraiser.ownerId },
        data: { coinBalance: { increment: netCoins }, totalCoinsReceived: { increment: netCoins } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: organizerWallet.id,
          userId: fundraiser.ownerId,
          type: "FUNDRAISER_RECEIVED",
          amount: netCoins,
          fee: feeCoins,
          balance: updatedOrganizerWallet.coinBalance,
          status: "COMPLETED",
          description: `Donations received for ${fundraiser.title}`,
          reference: fundraiser.id,
          metadata: JSON.stringify({
            fundraiserId: fundraiser.id,
            fundraiserSlug: fundraiser.slug,
            fundraiserTitle: fundraiser.title,
            grossCoins: coins,
            feeCoins,
            donorId: anonymous ? null : userId,
          }),
        },
      });
      const updatedFundraiser = await tx.fundraiser.update({
        where: { id: fundraiser.id },
        data: { raisedAmount: { increment: amount }, supporterCount: { increment: 1 } },
      });

      const donation = await tx.fundraiserDonation.create({
        data: {
          fundraiserId: fundraiser.id,
          donorId: userId,
          amount: Math.round(amount * 100) / 100,
          coins,
          currency: fundraiser.currency,
          fee: feeCoins,
          netCoins,
          message,
          anonymous,
          transactionId: donorTx.id,
          status: "COMPLETED",
        },
      });

      return { donation, updatedFundraiser };
    });

    // Notifications (outside the wallet transaction).
    await notificationService.createNotification(
      fundraiser.ownerId,
      "fundraiser",
      "New donation received",
      `Your fundraiser "${fundraiser.title}" received a ${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${fundraiser.currency} donation.`,
      { entityType: "fundraiser", entityId: fundraiser.id, fundraiserId: fundraiser.id, fundraiserSlug: fundraiser.slug, actorId: anonymous ? undefined : userId, referenceKey: `fundraiser-donation:${result.donation.id}` }
    );
    await notificationService.createNotification(
      userId,
      "wallet",
      "Donation confirmed",
      `Your donation of ${coins.toLocaleString()} VANTA Coins to "${fundraiser.title}" is confirmed.`,
      { entityType: "fundraiser", entityId: fundraiser.id, fundraiserId: fundraiser.id, fundraiserSlug: fundraiser.slug, fundraiserTitle: fundraiser.title, transactionId: result.donation.transactionId, referenceKey: `fundraiser-donor:${result.donation.id}` }
    );

    const progress = fundraiser.targetAmount > 0 ? result.updatedFundraiser.raisedAmount / fundraiser.targetAmount : 0;
    if (progress >= 1) {
      await notificationService.createNotification(
        fundraiser.ownerId,
        "fundraiser",
        "Goal reached 🎉",
        `Congratulations! "${fundraiser.title}" reached its goal.`,
        { entityType: "fundraiser", entityId: fundraiser.id, fundraiserId: fundraiser.id, fundraiserSlug: fundraiser.slug, referenceKey: `fundraiser-goal:${fundraiser.id}` }
      );
    } else if (progress >= 0.5) {
      await notificationService.createNotification(
        fundraiser.ownerId,
        "fundraiser",
        "Milestone reached",
        `"${fundraiser.title}" is more than halfway to its goal. Amazing!`,
        { entityType: "fundraiser", entityId: fundraiser.id, fundraiserId: fundraiser.id, fundraiserSlug: fundraiser.slug, referenceKey: `fundraiser-halfway:${fundraiser.id}` }
      );
    }

    return {
      donation: result.donation,
      fundraiser: result.updatedFundraiser,
      coins,
      netCoins,
      feeCoins,
    };
  }
  // ------------------------------------------------------------------
  // SHARE TRACKING (social integration)
  // ------------------------------------------------------------------

  /**
   * Record a share of a fundraiser (COPY_LINK / MESSAGE / POST / REEL / STORY).
   * The actual content creation happens through the existing VANTA composer
   * flows; this endpoint only keeps a lightweight audit/safety trail.
   */
  async recordShare(fundraiserId: string, userId: string, destination: string) {
    const destinationClean = String(destination || "COPY_LINK").toUpperCase().slice(0, 40);
    await writeAudit(fundraiserId, userId, "SHARED", null, null, { destination: destinationClean });
    return { shared: true, destination: destinationClean };
  }

// ------------------------------------------------------------------
  // EVIDENCE (PRIVATE, AUTHORIZATION-GATED)
  // ------------------------------------------------------------------

  /**
   * Record an evidence upload. The file itself was written by the multer
   * `uploadEvidence` middleware into the private evidence directory; only
   * metadata is persisted, and only an authorized stream endpoint can read
   * the bytes back. No public URL is produced anywhere.
   */
  async addEvidence(
    userId: string,
    fundraiserId: string,
    file: Express.Multer.File,
    label?: string
  ) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser || fundraiser.ownerId !== userId) {
      // Remove the private file immediately when unauthorized.
      if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      throw new Error("Fundraiser not found or you do not own it.");
    }

    let fileType = "DOCUMENT";
    if ((file.mimetype || "").startsWith("image/")) fileType = "IMAGE";
    else if ((file.mimetype || "").startsWith("video/")) fileType = "VIDEO";

    const record = await prisma.fundraiserEvidence.create({
      data: {
        fundraiserId,
        uploadedById: userId,
        filePath: path.basename(file.path), // store only the basename inside the private dir
        originalName: file.originalname || "evidence",
        mimeType: file.mimetype || "application/octet-stream",
        size: file.size || 0,
        fileType,
        label: label ? String(label).trim().slice(0, 140) || null : null,
      },
      select: { id: true, originalName: true, fileType: true, mimeType: true, size: true, label: true, createdAt: true },
    });

    await writeAudit(fundraiserId, userId, "EVIDENCE_UPLOADED", null, null, { evidenceId: record.id });
    return record;
  }

  /** Authorization check + resolved file path for streaming an evidence item. */
  async resolveEvidenceFile(
    fundraiserId: string,
    evidenceId: string,
    requesterId: string,
    isAdmin: boolean
  ): Promise<{ absolutePath: string; originalName: string; mimeType: string; size: number }> {
    const evidence = await prisma.fundraiserEvidence.findUnique({
      where: { id: evidenceId },
      include: { fundraiser: { select: { ownerId: true } } },
    });
    if (!evidence || evidence.fundraiserId !== fundraiserId) throw new Error("Evidence not found.");

    const isOwner = evidence.fundraiser.ownerId === requesterId;
    const isUploader = evidence.uploadedById === requesterId;
    if (!isAdmin && !isOwner && !isUploader) {
      throw new Error("You do not have permission to access this evidence.");
    }

    const safeName = path.basename(evidence.filePath);
    const absolutePath = path.join(evidenceUploadDir, safeName);
    if (!fs.existsSync(absolutePath) || !path.resolve(absolutePath).startsWith(path.resolve(evidenceUploadDir))) {
      throw new Error("Evidence file is missing from secure storage.");
    }

    return { absolutePath, originalName: evidence.originalName, mimeType: evidence.mimeType, size: evidence.size };
  }

  async listEvidence(fundraiserId: string) {
    return prisma.fundraiserEvidence.findMany({
      where: { fundraiserId },
      orderBy: { createdAt: "desc" },
      select: { id: true, originalName: true, fileType: true, mimeType: true, size: true, label: true, createdAt: true, uploadedById: true },
    });
  }

  // ------------------------------------------------------------------
  // REPORTS
  // ------------------------------------------------------------------

  async createReport(userId: string, fundraiserId: string, input: { reason: string; details?: string }) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser) throw new Error("Fundraiser not found.");
    const reason = String(input.reason || "").trim();
    if (!reason || reason.length < 3) throw new Error("Please provide a reason for reporting this fundraiser.");
    const existing = await prisma.fundraiserReport.findFirst({
      where: { fundraiserId, reporterId: userId, status: { in: ["OPEN", "INVESTIGATING"] } },
    });
    if (existing) throw new Error("You have already reported this fundraiser. Our team is reviewing it.");

    const report = await prisma.fundraiserReport.create({
      data: {
        fundraiserId,
        reporterId: userId,
        reason,
        details: input.details ? String(input.details).trim().slice(0, 2_000) || null : null,
      },
    });
    await writeAudit(fundraiserId, userId, "REPORTED", null, null, { reportId: report.id, reason });
    return report;
  }
// ------------------------------------------------------------------
  // ADMIN REVIEW SYSTEM
  // ------------------------------------------------------------------

  async adminListFundraisers(options: { status?: string; search?: string; limit?: number; cursor?: string } = {}) {
    const limit = Math.min(Math.max(options.limit || 20, 1), 50);
    const where: any = {};
    if (options.status) {
      const statuses = String(options.status).toUpperCase().split(",").filter(Boolean);
      where.status = { in: statuses };
    }
    if (options.search) {
      where.OR = [
        { title: { contains: options.search } },
        { summary: { contains: options.search } },
        { beneficiaryName: { contains: options.search } },
        { owner: { username: { contains: options.search } } },
        { owner: { fullName: { contains: options.search } } },
      ];
    }

    const items = await prisma.fundraiser.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: {
        category: { select: { id: true, slug: true, name: true, emoji: true } },
        owner: { select: { id: true, username: true, fullName: true, email: true, phone: true, avatar: true, verified: true, role: true } },
        _count: { select: { donations: true, evidence: true, reports: true, updates: true } },
      },
    });

    const nextCursor = items.length > limit ? items.pop()?.id : undefined;
    return { items, nextCursor };
  }

  async adminGetFundraiser(fundraiserId: string) {
    const fundraiser = await prisma.fundraiser.findUnique({
      where: { id: fundraiserId },
      include: {
        category: true,
        owner: { select: { id: true, username: true, fullName: true, email: true, phone: true, avatar: true, verified: true, role: true, country: true, city: true, createdAt: true, status: true } },
        media: { orderBy: { sortOrder: "asc" } },
        evidence: { orderBy: { createdAt: "desc" }, include: { uploader: { select: { id: true, username: true, fullName: true } } } },
        updates: { orderBy: { createdAt: "desc" }, include: { author: { select: { id: true, username: true, fullName: true, avatar: true } } } },
        donations: { orderBy: { createdAt: "desc" }, take: 50, include: { donor: { select: { id: true, username: true, fullName: true, avatar: true } } } },
        reports: { orderBy: { createdAt: "desc" }, include: { reporter: { select: { id: true, username: true, fullName: true } } } },
      },
    });
    if (!fundraiser) throw new Error("Fundraiser not found.");

    const auditLogs = await prisma.fundraiserAuditLog.findMany({
      where: { fundraiserId },
      orderBy: { createdAt: "asc" },
      include: { actor: { select: { id: true, username: true, fullName: true } } },
    });

    // Prior fundraiser history for the owner (safety review aid).
    const previousFundraisers = await prisma.fundraiser.findMany({
      where: { ownerId: fundraiser.ownerId, id: { not: fundraiser.id } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, slug: true, title: true, status: true, targetAmount: true, raisedAmount: true, createdAt: true },
    });

    return { fundraiser, auditLogs: collectAuditRows(auditLogs), previousFundraisers };
  }

  /**
   * Centralized admin status transition with audit trail, security logging and
   * organizer notifications. `extra` provides per-action data (messages etc).
   * Validates that the transition is legal from the current state.
   */
  private async adminTransition(
    adminId: string,
    fundraiserId: string,
    toStatus: FundraiserStatus,
    actionName: string,
    extra: Record<string, unknown> = {},
    legalFrom: FundraiserStatus[]
  ) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser) throw new Error("Fundraiser not found.");
    if (!legalFrom.includes(fundraiser.status as FundraiserStatus)) {
      throw new Error(`Cannot move a fundraiser from ${fundraiser.status} to ${toStatus}.`);
    }

    const previousStatus = fundraiser.status;
    const timestamps: Record<string, unknown> = {};
    if (actionName === "APPROVED") {
      timestamps.approvedAt = new Date();
      timestamps.reviewedAt = new Date();
      timestamps.reviewedById = adminId;
    } else if (actionName === "PUBLISHED") {
      timestamps.publishedAt = new Date();
      timestamps.reviewedAt = new Date();
      timestamps.reviewedById = adminId;
    } else if (actionName === "REJECTED") {
      timestamps.reviewedAt = new Date();
      timestamps.reviewedById = adminId;
    }

    const updated = await prisma.fundraiser.update({
      where: { id: fundraiserId },
      data: { status: toStatus, ...timestamps },
    });

    await writeAudit(fundraiserId, adminId, actionName, previousStatus, toStatus, extra);
    await auditLog.log({
      userId: adminId,
      action: `FUNDRAISER_${actionName}`,
      metadata: { fundraiserId, slug: fundraiser.slug, title: fundraiser.title, fromStatus: previousStatus, toStatus, ...extra },
      severity: "INFO",
    });

    return { fundraiser: updated, previousStatus };
  }
/** APPROVE → APPROVED. Optionally PUBLISH immediately (default: published). */
  async adminApprove(adminId: string, fundraiserId: string, options: { publish?: boolean; note?: string; verified?: boolean } = {}) {
    const { fundraiser, previousStatus } = await this.adminTransition(
      adminId,
      fundraiserId,
      FUNDRAISER_STATUS.APPROVED,
      "APPROVED",
      { note: options.note || null },
      [FUNDRAISER_STATUS.UNDER_REVIEW, FUNDRAISER_STATUS.MORE_INFORMATION_REQUIRED, FUNDRAISER_STATUS.SUSPENDED, FUNDRAISER_STATUS.DRAFT]
    );

    if (options.note) await prisma.fundraiser.update({ where: { id: fundraiserId }, data: { adminNote: String(options.note).slice(0, 500) } });
    if (options.verified === true) await prisma.fundraiser.update({ where: { id: fundraiserId }, data: { verified: true } });

    await notificationService.createNotification(
      fundraiser.ownerId,
      "fundraiser",
      "Fundraiser approved",
      `Great news — "${fundraiser.title}" has been approved${options.publish ? " and is now live" : ""}.`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, fundraiserTitle: fundraiser.title, referenceKey: `fundraiser-approved:${fundraiserId}` }
    );

    if (options.publish !== false) {
      const published = await this.adminTransition(adminId, fundraiserId, FUNDRAISER_STATUS.PUBLISHED, "PUBLISHED", { approvedFrom: previousStatus }, [
        FUNDRAISER_STATUS.APPROVED,
      ]);
      await notificationService.createNotification(
        fundraiser.ownerId,
        "fundraiser",
        "Your fundraiser is live",
        `"${fundraiser.title}" is now live and accepting donations.`,
        { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, fundraiserTitle: fundraiser.title }
      );
      return { ...published, approved: true };
    }
    return { fundraiser, approved: true };
  }
/** REQUEST MORE INFORMATION → MORE_INFORMATION_REQUIRED (mandatory message). */
  async adminRequestMoreInfo(adminId: string, fundraiserId: string, message: string) {
    if (!message || String(message).trim().length < 5) throw new Error("Please explain what information is missing.");
    const { fundraiser, previousStatus } = await this.adminTransition(
      adminId,
      fundraiserId,
      FUNDRAISER_STATUS.MORE_INFORMATION_REQUIRED,
      "REQUEST_MORE_INFO",
      { message: String(message).slice(0, 2_000) },
      [FUNDRAISER_STATUS.UNDER_REVIEW, FUNDRAISER_STATUS.DRAFT, FUNDRAISER_STATUS.MORE_INFORMATION_REQUIRED, FUNDRAISER_STATUS.SUSPENDED]
    );
    await prisma.fundraiser.update({ where: { id: fundraiserId }, data: { infoRequestMessage: String(message).slice(0, 2_000) } });
    await notificationService.createNotification(
      fundraiser.ownerId,
      "fundraiser",
      "More information needed",
      `We need a little more information on "${fundraiser.title}" before it can be approved.`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, fundraiserTitle: fundraiser.title, message: String(message).slice(0, 2_000), referenceKey: `fundraiser-more-info:${fundraiserId}` }
    );
    return { fundraiser, previousStatus };
  }

  /** REJECT → REJECTED (mandatory reason). */
  async adminReject(adminId: string, fundraiserId: string, reason: string) {
    if (!reason || String(reason).trim().length < 5) throw new Error("Please provide a reason for rejecting this fundraiser.");
    const { fundraiser, previousStatus } = await this.adminTransition(
      adminId,
      fundraiserId,
      FUNDRAISER_STATUS.REJECTED,
      "REJECTED",
      { reason: String(reason).slice(0, 2_000) },
      [FUNDRAISER_STATUS.UNDER_REVIEW, FUNDRAISER_STATUS.MORE_INFORMATION_REQUIRED, FUNDRAISER_STATUS.DRAFT, FUNDRAISER_STATUS.SUSPENDED]
    );
    await prisma.fundraiser.update({ where: { id: fundraiserId }, data: { rejectionReason: String(reason).slice(0, 2_000) } });
    await notificationService.createNotification(
      fundraiser.ownerId,
      "fundraiser",
      "Fundraiser not approved",
      `We were unable to approve "${fundraiser.title}". Reason: ${String(reason).slice(0, 160)}`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, fundraiserTitle: fundraiser.title, reason: String(reason).slice(0, 2_000), referenceKey: `fundraiser-rejected:${fundraiserId}` }
    );
    return { fundraiser, previousStatus };
  }
/** SUSPEND → temporarily removes a published fundraiser from public visibility. */
  async adminSuspend(adminId: string, fundraiserId: string, reason: string) {
    if (!reason || String(reason).trim().length < 5) throw new Error("Please provide a reason for suspending this fundraiser.");
    const { fundraiser, previousStatus } = await this.adminTransition(
      adminId,
      fundraiserId,
      FUNDRAISER_STATUS.SUSPENDED,
      "SUSPENDED",
      { reason: String(reason).slice(0, 2_000) },
      [FUNDRAISER_STATUS.PUBLISHED, FUNDRAISER_STATUS.APPROVED, FUNDRAISER_STATUS.UNDER_REVIEW]
    );
    await prisma.fundraiser.update({ where: { id: fundraiserId }, data: { suspensionReason: String(reason).slice(0, 2_000) } });
    await notificationService.createNotification(
      fundraiser.ownerId,
      "fundraiser",
      "Fundraiser suspended",
      `"${fundraiser.title}" has been temporarily suspended. Reason: ${String(reason).slice(0, 160)}`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, fundraiserTitle: fundraiser.title, reason: String(reason).slice(0, 2_000), referenceKey: `fundraiser-suspended:${fundraiserId}` }
    );
    return { fundraiser, previousStatus };
  }

  /** RESTORE a suspended fundraiser back to PUBLIC visibility. */
  async adminUnsuspend(adminId: string, fundraiserId: string) {
    const { fundraiser, previousStatus } = await this.adminTransition(
      adminId,
      fundraiserId,
      FUNDRAISER_STATUS.PUBLISHED,
      "UNSUSPENDED",
      {},
      [FUNDRAISER_STATUS.SUSPENDED]
    );
    await prisma.fundraiser.update({ where: { id: fundraiserId }, data: { suspensionReason: null } });
    await notificationService.createNotification(
      fundraiser.ownerId,
      "fundraiser",
      "Fundraiser restored",
      `"${fundraiser.title}" is live again.`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, fundraiserTitle: fundraiser.title, referenceKey: `fundraiser-restored:${fundraiserId}` }
    );
    return { fundraiser, previousStatus };
  }

  /** Manually mark a fundraiser COMPLETED (goal achieved / withdraw concluded). */
  async adminComplete(adminId: string, fundraiserId: string) {
    const { fundraiser, previousStatus } = await this.adminTransition(
      adminId,
      fundraiserId,
      FUNDRAISER_STATUS.COMPLETED,
      "COMPLETED",
      {},
      [FUNDRAISER_STATUS.PUBLISHED, FUNDRAISER_STATUS.APPROVED]
    );
    await prisma.fundraiser.update({ where: { id: fundraiserId }, data: { completedAt: new Date() } });
    await notificationService.createNotification(
      fundraiser.ownerId,
      "fundraiser",
      "Fundraiser completed",
      `"${fundraiser.title}" has been marked as completed. Thank you for using VANTA Give.`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, fundraiserTitle: fundraiser.title, referenceKey: `fundraiser-completed:${fundraiserId}` }
    );
    return { fundraiser, previousStatus };
  }
/** Toggle the admin-controlled "VANTA Verified" marker (never user-grantable). */
  async adminSetVerified(adminId: string, fundraiserId: string, verified: boolean, note?: string) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser) throw new Error("Fundraiser not found.");
    const updated = await prisma.fundraiser.update({ where: { id: fundraiserId }, data: { verified } });
    await writeAudit(fundraiserId, adminId, verified ? "VERIFIED" : "UNVERIFIED", null, null, { note: note || null });
    await auditLog.log({
      userId: adminId,
      action: `FUNDRAISER_${verified ? "VERIFIED" : "UNVERIFIED"}`,
      metadata: { fundraiserId, slug: fundraiser.slug, title: fundraiser.title, note: note || null },
    });
    await notificationService.createNotification(
      fundraiser.ownerId,
      "fundraiser",
      verified ? "VANTA Verified ✓" : "Verification updated",
      verified
        ? `"${fundraiser.title}" has been verified by VANTA.`
        : `The VANTA Verified badge on "${fundraiser.title}" was removed.`,
      { entityType: "fundraiser", entityId: fundraiserId, fundraiserId, fundraiserSlug: fundraiser.slug, referenceKey: `fundraiser-verified:${fundraiserId}:${String(verified)}` }
    );
    return updated;
  }

  /** Toggle featured placement in discovery. */
  async adminToggleFeatured(adminId: string, fundraiserId: string, featured: boolean) {
    const fundraiser = await prisma.fundraiser.findUnique({ where: { id: fundraiserId } });
    if (!fundraiser) throw new Error("Fundraiser not found.");
    const updated = await prisma.fundraiser.update({ where: { id: fundraiserId }, data: { isFeatured: featured } });
    await writeAudit(fundraiserId, adminId, featured ? "FEATURED" : "UNFEATURED", null, null, {});
    await auditLog.log({
      userId: adminId,
      action: `FUNDRAISER_${featured ? "FEATURED" : "UNFEATURED"}`,
      metadata: { fundraiserId, slug: fundraiser.slug, title: fundraiser.title },
    });
    return updated;
  }
// ------------------------------------------------------------------
  // ADMIN REPORTS
  // ------------------------------------------------------------------

  async adminListReports(options: { status?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(options.limit || 20, 1), 50);
    const where: any = {};
    if (options.status) where.status = String(options.status).toUpperCase();
    return prisma.fundraiserReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        fundraiser: { select: { id: true, slug: true, title: true, status: true } },
        reporter: { select: { id: true, username: true, fullName: true, avatar: true } },
      },
    });
  }

  async adminResolveReport(adminId: string, reportId: string, resolution: { status: string; note?: string }) {
    const status = String(resolution.status || "").toUpperCase();
    if (!["RESOLVED", "DISMISSED", "INVESTIGATING"].includes(status)) throw new Error("Invalid report resolution status.");
    const updated = await prisma.fundraiserReport.update({
      where: { id: reportId },
      data: {
        status,
        resolutionNote: resolution.note ? String(resolution.note).slice(0, 2_000) : null,
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });
    if (updated.fundraiserId) await writeAudit(updated.fundraiserId, adminId, `REPORT_${status}`, null, null, { reportId, note: resolution.note || null });
    return updated;
  }
}

export const fundraiserService = new FundraiserService();