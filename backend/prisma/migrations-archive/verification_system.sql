-- Migration: Add Verification & Creator Subscription System
-- This migration adds tables for badge verification, creator memberships, subscription plans, and crypto payments

-- VerificationBadge: Tracks blue/gold badges per user
CREATE TABLE "VerificationBadge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL UNIQUE,
    "badgeType" TEXT NOT NULL CHECK ("badgeType" IN ('BLUE', 'GOLD')),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'REVOKED', 'SUSPENDED', 'EXPIRED')),
    "grantedBy" TEXT,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "revokedBy" TEXT,
    "revokeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VerificationBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE INDEX "VerificationBadge_userId_status_idx" ON "VerificationBadge"("userId", "status");
CREATE INDEX "VerificationBadge_badgeType_status_idx" ON "VerificationBadge"("badgeType", "status");

-- VerificationRequest: Tracks user verification requests
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL UNIQUE,
    "requestType" TEXT NOT NULL CHECK ("requestType" IN ('CREATOR', 'BUSINESS', 'INDIVIDUAL')),
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
    "documents" TEXT,
    "notes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VerificationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE INDEX "VerificationRequest_status_createdAt_idx" ON "VerificationRequest"("status", "createdAt");
CREATE INDEX "VerificationRequest_userId_status_idx" ON "VerificationRequest"("userId", "status");

-- SubscriptionPlan: Configurable creator membership plans
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL UNIQUE,
    "durationMonths" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT,
    "benefits" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "badgeType" TEXT NOT NULL DEFAULT 'GOLD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "SubscriptionPlan_isActive_sortOrder_idx" ON "SubscriptionPlan"("isActive", "sortOrder");

-- CreatorMembership: Tracks active creator subscriptions
CREATE TABLE "CreatorMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL UNIQUE,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED')),
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" DATETIME NOT NULL,
    "renewalDate" DATETIME,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" DATETIME,
    "paymentMethod" TEXT,
    "paymentTxHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreatorMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "CreatorMembership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE CASCADE
);

CREATE INDEX "CreatorMembership_userId_status_idx" ON "CreatorMembership"("userId", "status");
CREATE INDEX "CreatorMembership_status_endDate_idx" ON "CreatorMembership"("status", "endDate");
CREATE INDEX "CreatorMembership_endDate_idx" ON "CreatorMembership"("endDate");

-- CryptoPayment: Tracks crypto payment transactions
CREATE TABLE "CryptoPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL CHECK ("currency" IN ('USDT', 'USDC')),
    "network" TEXT NOT NULL CHECK ("network" IN ('BNB_SMART_CHAIN', 'BASE')),
    "walletAddress" TEXT NOT NULL,
    "txHash" TEXT UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED')),
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "confirmedAt" DATETIME,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CryptoPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "CryptoPayment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE CASCADE
);

CREATE INDEX "CryptoPayment_userId_status_idx" ON "CryptoPayment"("userId", "status");
CREATE INDEX "CryptoPayment_status_createdAt_idx" ON "CryptoPayment"("status", "createdAt");
CREATE INDEX "CryptoPayment_txHash_idx" ON "CryptoPayment"("txHash");
CREATE INDEX "CryptoPayment_expiresAt_idx" ON "CryptoPayment"("expiresAt");

-- VerificationHistory: Audit log for verification actions
CREATE TABLE "VerificationHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedBy" TEXT,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE INDEX "VerificationHistory_userId_createdAt_idx" ON "VerificationHistory"("userId", "createdAt");
CREATE INDEX "VerificationHistory_action_createdAt_idx" ON "VerificationHistory"("action", "createdAt");

-- Insert default subscription plans
INSERT INTO "SubscriptionPlan" ("id", "name", "durationMonths", "price", "currency", "description", "benefits", "isActive", "sortOrder", "badgeType")
VALUES 
('plan_3months', '3 Months', 3, 9.99, 'USD', 'Get started with Creator Membership for 3 months', '["Gold Badge","Creator Studio Access","Basic Analytics","Monetization Tools","Priority Support"]', true, 1, 'GOLD'),
('plan_6months', '6 Months', 6, 17.99, 'USD', 'Save 10% with the 6-month Creator Membership plan', '["Gold Badge","Creator Studio Access","Advanced Analytics","Monetization Tools","Priority Support"]', true, 2, 'GOLD'),
('plan_12months', '12 Months', 12, 29.99, 'USD', 'Best Value! Save 25% with the annual Creator Membership plan', '["Gold Badge","Creator Studio Access","Advanced Analytics","Monetization Tools","Priority Support","Early Access to New Features","Exclusive Creator Perks"]', true, 3, 'GOLD');