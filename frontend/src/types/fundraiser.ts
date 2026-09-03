// VANTA Give — shared TypeScript types for the fundraising feature.

export const FUNDRAISER_STATUS = {
  DRAFT: 'DRAFT',
  UNDER_REVIEW: 'UNDER_REVIEW',
  MORE_INFORMATION_REQUIRED: 'MORE_INFORMATION_REQUIRED',
  APPROVED: 'APPROVED',
  PUBLISHED: 'PUBLISHED',
  SUSPENDED: 'SUSPENDED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type FundraiserStatus = (typeof FUNDRAISER_STATUS)[keyof typeof FUNDRAISER_STATUS];

export const RAISING_FOR_OPTIONS = ['SELF', 'FAMILY_MEMBER', 'FRIEND', 'COMMUNITY', 'OTHER'] as const;
export const PAYOUT_METHODS = ['WALLET_BALANCE', 'BANK_TRANSFER', 'USDT'] as const;

export interface FundraiserCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  emoji: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface FundraiserOwner {
  id: string;
  username: string;
  fullName: string | null;
  avatar: string | null;
  verified: boolean;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  country?: string | null;
  city?: string | null;
  createdAt?: string | null;
  status?: string | null;
}

export interface FundraiserMedia {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  isCover: boolean;
  sortOrder: number;
}

export interface FundraiserEvidenceMeta {
  id: string;
  originalName: string;
  fileType: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  mimeType: string;
  size: number;
  label: string | null;
  createdAt: string;
  uploadedById?: string;
}

export interface FundraiserUpdateAuthor {
  id: string;
  username: string;
  fullName: string | null;
  avatar: string | null;
}

export interface FundraiserUpdateMedia {
  type: 'IMAGE' | 'VIDEO';
  url: string;
  thumbnailUrl?: string | null;
}

export interface FundraiserUpdate {
  id: string;
  fundraiserId: string;
  authorId: string;
  title: string | null;
  body: string;
  media: FundraiserUpdateMedia[] | null;
  createdAt: string;
  updatedAt: string;
  author?: FundraiserUpdateAuthor;
}

export interface FundraiserAuditLogRow {
  id: string;
  fundraiserId: string;
  actorId: string | null;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor?: FundraiserUpdateAuthor | null;
}

export interface FundraiserDonor {
  id: string;
  username: string;
  fullName: string | null;
  avatar: string | null;
}

export interface FundraiserSupporter {
  id: string;
  amount: number;
  currency: string;
  message: string | null;
  anonymous: boolean;
  donor: FundraiserDonor | null;
  createdAt: string;
}
export interface Fundraiser {
  id: string;
  slug: string;
  ownerId: string;
  status: FundraiserStatus;
  title: string;
  summary: string | null;
  categoryId: string | null;
  category: FundraiserCategory | null;
  raisingFor: string | null;
  country: string | null;
  location: string | null;
  currency: string;
  targetAmount: number;
  deadline: string | null;
  story: string | null;
  fundsNeededFor: string | null;
  fundsUsage: string | null;
  whoBenefits: string | null;
  coverMediaType: 'IMAGE' | 'VIDEO' | null;
  coverMediaUrl: string | null;
  coverMediaThumbnailUrl: string | null;
  beneficiaryName: string | null;
  beneficiaryRelationship: string | null;
  beneficiarySummary: string | null;
  payoutMethod: string | null;
  organizerNotes: string | null;
  raisedAmount: number;
  supporterCount: number;
  viewCount: number;
  isFeatured: boolean;
  verified: boolean;
  infoRequestMessage: string | null;
  rejectionReason: string | null;
  suspensionReason: string | null;
  adminNote: string | null;
  reviewedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner?: FundraiserOwner;
  media?: FundraiserMedia[];
  updates?: FundraiserUpdate[];
}

export interface FundraiserListItem {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  status: FundraiserStatus;
  verified: boolean;
  isFeatured: boolean;
  country: string | null;
  location: string | null;
  currency: string;
  targetAmount: number;
  raisedAmount: number;
  supporterCount: number;
  deadline: string | null;
  coverMediaType: 'IMAGE' | 'VIDEO' | null;
  coverMediaUrl: string | null;
  coverMediaThumbnailUrl: string | null;
  beneficiaryName: string | null;
  publishedAt: string | null;
  createdAt: string;
  category: FundraiserCategory | null;
  owner: FundraiserOwner;
}

export interface FundraiserDonationResult {
  donation: {
    id: string;
    amount: number;
    coins: number;
    currency: string;
    fee: number;
    netCoins: number;
    message: string | null;
    anonymous: boolean;
    transactionId: string | null;
    status: string;
    createdAt: string;
  };
  fundraiser: {
    id: string;
    raisedAmount: number;
    supporterCount: number;
  };
  coins: number;
  netCoins: number;
  feeCoins: number;
}

export interface FundraiserReport {
  id: string;
  fundraiserId: string;
  reporterId: string;
  reason: string;
  details: string | null;
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED';
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  fundraiser?: { id: string; slug: string; title: string; status: string };
  reporter?: FundraiserUpdateAuthor;
}

export interface AdminFundraiserDetail {
  fundraiser: Fundraiser & {
    evidence: FundraiserEvidenceMeta[];
    donations: Array<{
      id: string;
      amount: number;
      currency: string;
      coins: number;
      message: string | null;
      anonymous: boolean;
      status: string;
      createdAt: string;
      donor: FundraiserDonor | null;
    }>;
    reports: FundraiserReport[];
  };
  auditLogs: FundraiserAuditLogRow[];
  previousFundraisers: Array<{
    id: string;
    slug: string;
    title: string;
    status: string;
    targetAmount: number;
    raisedAmount: number;
    createdAt: string;
  }>;
}

export interface FundraiserDraftSubmission {
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