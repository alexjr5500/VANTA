-- Migration: Add VANTA Give fundraising system
-- Adds configurable categories, fundraisers, media, private evidence, updates,
-- donations, reports and an audit trail for status changes.

CREATE TABLE "FundraiserCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "FundraiserCategory_isActive_sortOrder_idx" ON "FundraiserCategory"("isActive", "sortOrder");

CREATE TABLE "Fundraiser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL UNIQUE,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "categoryId" TEXT,
    "raisingFor" TEXT,
    "country" TEXT,
    "location" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "targetAmount" REAL NOT NULL DEFAULT 0,
    "deadline" DATETIME,
    "story" TEXT,
    "fundsNeededFor" TEXT,
    "fundsUsage" TEXT,
    "whoBenefits" TEXT,
    "coverMediaType" TEXT,
    "coverMediaUrl" TEXT,
    "coverMediaThumbnailUrl" TEXT,
    "beneficiaryName" TEXT,
    "beneficiaryRelationship" TEXT,
    "beneficiarySummary" TEXT,
    "payoutMethod" TEXT,
    "organizerNotes" TEXT,
    "raisedAmount" REAL NOT NULL DEFAULT 0,
    "supporterCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "infoRequestMessage" TEXT,
    "rejectionReason" TEXT,
    "suspensionReason" TEXT,
    "adminNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "submittedAt" DATETIME,
    "approvedAt" DATETIME,
    "publishedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Fundraiser_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Fundraiser_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FundraiserCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Fundraiser_status_createdAt_idx" ON "Fundraiser"("status", "createdAt");
CREATE INDEX "Fundraiser_status_deadline_idx" ON "Fundraiser"("status", "deadline");
CREATE INDEX "Fundraiser_categoryId_status_idx" ON "Fundraiser"("categoryId", "status");
CREATE INDEX "Fundraiser_ownerId_status_idx" ON "Fundraiser"("ownerId", "status");
CREATE INDEX "Fundraiser_verified_status_idx" ON "Fundraiser"("verified", "status");
CREATE INDEX "Fundraiser_isFeatured_status_idx" ON "Fundraiser"("isFeatured", "status");
CREATE INDEX "Fundraiser_slug_idx" ON "Fundraiser"("slug");

CREATE TABLE "FundraiserMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundraiserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "caption" TEXT,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FundraiserMedia_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "Fundraiser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FundraiserMedia_fundraiserId_sortOrder_idx" ON "FundraiserMedia"("fundraiserId", "sortOrder");
CREATE INDEX "FundraiserMedia_fundraiserId_isCover_idx" ON "FundraiserMedia"("fundraiserId", "isCover");
CREATE TABLE "FundraiserEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundraiserId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "fileType" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FundraiserEvidence_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "Fundraiser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FundraiserEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FundraiserEvidence_fundraiserId_idx" ON "FundraiserEvidence"("fundraiserId");
CREATE INDEX "FundraiserEvidence_uploadedById_idx" ON "FundraiserEvidence"("uploadedById");

CREATE TABLE "FundraiserUpdate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundraiserId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "media" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FundraiserUpdate_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "Fundraiser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FundraiserUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FundraiserUpdate_fundraiserId_createdAt_idx" ON "FundraiserUpdate"("fundraiserId", "createdAt");

CREATE TABLE "FundraiserDonation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundraiserId" TEXT NOT NULL,
    "donorId" TEXT,
    "amount" REAL NOT NULL,
    "coins" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fee" REAL NOT NULL DEFAULT 0,
    "netCoins" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "transactionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FundraiserDonation_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "Fundraiser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FundraiserDonation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "FundraiserDonation_fundraiserId_createdAt_idx" ON "FundraiserDonation"("fundraiserId", "createdAt");
CREATE INDEX "FundraiserDonation_donorId_createdAt_idx" ON "FundraiserDonation"("donorId", "createdAt");
CREATE INDEX "FundraiserDonation_status_fundraiserId_idx" ON "FundraiserDonation"("status", "fundraiserId");
CREATE TABLE "FundraiserReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundraiserId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FundraiserReport_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "Fundraiser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FundraiserReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FundraiserReport_fundraiserId_status_idx" ON "FundraiserReport"("fundraiserId", "status");
CREATE INDEX "FundraiserReport_status_createdAt_idx" ON "FundraiserReport"("status", "createdAt");

CREATE TABLE "FundraiserAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundraiserId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FundraiserAuditLog_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "Fundraiser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FundraiserAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "FundraiserAuditLog_fundraiserId_createdAt_idx" ON "FundraiserAuditLog"("fundraiserId", "createdAt");
CREATE INDEX "FundraiserAuditLog_actorId_createdAt_idx" ON "FundraiserAuditLog"("actorId", "createdAt");

-- Seed the configurable default fundraiser categories.
INSERT INTO "FundraiserCategory" ("id", "slug", "name", "description", "emoji", "sortOrder", "isActive", "createdAt", "updatedAt") VALUES
  ('cat_medical', 'medical', 'Medical', 'Medical bills, treatment, surgeries and care', '🩺', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_emergency', 'emergency', 'Emergency', 'Urgent unexpected emergencies', '🚨', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_education', 'education', 'Education', 'Tuition, school fees and learning costs', '🎓', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_family', 'family-support', 'Family Support', 'Supporting family essentials and household needs', '🏠', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_disaster', 'disaster-relief', 'Disaster Relief', 'Recovery from disasters and natural events', '🛟', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_community', 'community', 'Community', 'Community projects and shared local needs', '🤝', 6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_other', 'other', 'Other', 'Other legitimate causes and personal needs', '💛', 7, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);