-- ============================================================================
-- VANTA â€” VANTA Homes (property rental marketplace)
-- ============================================================================
-- Adds the VANTA Homes feature tables. Purely additive: new tables and indexes
-- only. No existing tables, columns, or rows are modified, renamed, or dropped.
-- Compatible with PostgreSQL (production) and SQLite (local/dev).
-- ============================================================================

-- PropertyListing: a house or apartment offered for rent.
CREATE TABLE "PropertyListing" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "rentAmount" DOUBLE PRECISION NOT NULL,
    "rentPeriod" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "country" TEXT NOT NULL,
    "state" TEXT,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "streetAddress" TEXT,
    "bedrooms" INTEGER NOT NULL,
    "bathrooms" INTEGER NOT NULL,
    "furnished" BOOLEAN NOT NULL DEFAULT false,
    "amenities" TEXT,
    "availabilityStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "depositAmount" DOUBLE PRECISION,
    "additionalFees" TEXT,
    "moveInInfo" TEXT,
    "contactVantaMessaging" BOOLEAN NOT NULL DEFAULT true,
    "contactWhatsApp" TEXT,
    "contactWhatsAppPublished" BOOLEAN NOT NULL DEFAULT false,
    "contactPhone" TEXT,
    "contactPhonePublished" BOOLEAN NOT NULL DEFAULT false,
    "ownerVerificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "ownerVerificationType" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyListing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PropertyListing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- PropertyMedia: one photograph or video attached to a listing.
-- Reuses the existing UploadedFile record (uploadedFileId) for storage.
CREATE TABLE "PropertyMedia" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "uploadedFileId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PHOTO',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "thumbnailUrl" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyMedia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PropertyMedia_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "PropertyListing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PropertyMedia_uploadedFileId_fkey" FOREIGN KEY ("uploadedFileId") REFERENCES "UploadedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PropertyMedia_uploadedFileId_key" ON "PropertyMedia"("uploadedFileId");
CREATE INDEX "PropertyMedia_listingId_order_idx" ON "PropertyMedia"("listingId", "order");
CREATE INDEX "PropertyMedia_listingId_isCover_idx" ON "PropertyMedia"("listingId", "isCover");

-- SavedProperty: a tenant's saved / favourited listing.
CREATE TABLE "SavedProperty" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedProperty_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SavedProperty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SavedProperty_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "PropertyListing"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SavedProperty_userId_listingId_key" ON "SavedProperty"("userId", "listingId");
CREATE INDEX "SavedProperty_userId_idx" ON "SavedProperty"("userId");
CREATE INDEX "SavedProperty_listingId_idx" ON "SavedProperty"("listingId");

-- PropertyEnquiry: associates a tenant's contact with a listing and the
-- existing Conversation/Message records.
CREATE TABLE "PropertyEnquiry" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "enquirerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyEnquiry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PropertyEnquiry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "PropertyListing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PropertyEnquiry_enquirerId_fkey" FOREIGN KEY ("enquirerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PropertyEnquiry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PropertyEnquiry_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PropertyEnquiry_conversationId_key" ON "PropertyEnquiry"("conversationId");
CREATE INDEX "PropertyEnquiry_listingId_idx" ON "PropertyEnquiry"("listingId");
CREATE INDEX "PropertyEnquiry_enquirerId_idx" ON "PropertyEnquiry"("enquirerId");
CREATE INDEX "PropertyEnquiry_ownerId_idx" ON "PropertyEnquiry"("ownerId");
CREATE INDEX "PropertyEnquiry_conversationId_idx" ON "PropertyEnquiry"("conversationId");

-- PropertyVerification: landlord / real-estate-agent verification application.
-- Proof documents are stored privately via the existing UploadedFile table
-- (category `verification`) and are never exposed by public APIs.
CREATE TABLE "PropertyVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "agencyName" TEXT,
    "agencyLicense" TEXT,
    "proofDocumentIds" TEXT,
    "reviewNotes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyVerification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PropertyVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PropertyVerification_userId_idx" ON "PropertyVerification"("userId");
CREATE INDEX "PropertyVerification_type_status_idx" ON "PropertyVerification"("type", "status");

-- PropertyReport: a report filed against a suspicious listing.
CREATE TABLE "PropertyReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyReport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PropertyReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PropertyReport_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "PropertyListing"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PropertyReport_listingId_idx" ON "PropertyReport"("listingId");
CREATE INDEX "PropertyReport_reporterId_idx" ON "PropertyReport"("reporterId");
CREATE INDEX "PropertyReport_status_createdAt_idx" ON "PropertyReport"("status", "createdAt");
CREATE UNIQUE INDEX "PropertyReport_reporterId_listingId_key" ON "PropertyReport"("reporterId", "listingId");

-- PropertyAuditLog: moderation audit trail for listing and verification actions.
CREATE TABLE "PropertyAuditLog" (
    "id" TEXT NOT NULL,
    "listingId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyAuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PropertyAuditLog_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "PropertyListing"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PropertyAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "PropertyAuditLog_listingId_createdAt_idx" ON "PropertyAuditLog"("listingId", "createdAt");
CREATE INDEX "PropertyAuditLog_actorId_createdAt_idx" ON "PropertyAuditLog"("actorId", "createdAt");
CREATE INDEX "PropertyAuditLog_action_createdAt_idx" ON "PropertyAuditLog"("action", "createdAt");
CREATE INDEX "PropertyListing_ownerId_idx" ON "PropertyListing"("ownerId");
CREATE INDEX "PropertyListing_availabilityStatus_idx" ON "PropertyListing"("availabilityStatus");
CREATE INDEX "PropertyListing_availabilityStatus_createdAt_idx" ON "PropertyListing"("availabilityStatus", "createdAt");
CREATE INDEX "PropertyListing_propertyType_idx" ON "PropertyListing"("propertyType");
CREATE INDEX "PropertyListing_city_idx" ON "PropertyListing"("city");
CREATE INDEX "PropertyListing_rentAmount_idx" ON "PropertyListing"("rentAmount");
CREATE INDEX "PropertyListing_currency_idx" ON "PropertyListing"("currency");
CREATE INDEX "PropertyListing_createdAt_idx" ON "PropertyListing"("createdAt");
