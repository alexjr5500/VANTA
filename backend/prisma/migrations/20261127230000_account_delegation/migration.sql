CREATE TABLE "AccountDelegation" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "delegateId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "scope" TEXT NOT NULL DEFAULT 'CONTENT_ANALYTICS' CHECK ("scope" = 'CONTENT_ANALYTICS'),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','ACTIVE','DECLINED','REVOKED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invitationExpiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "AccountDelegation_distinct_accounts" CHECK ("ownerId" <> "delegateId")
);
CREATE INDEX "AccountDelegation_ownerId_status_createdAt_idx" ON "AccountDelegation"("ownerId","status","createdAt");
CREATE INDEX "AccountDelegation_delegateId_status_createdAt_idx" ON "AccountDelegation"("delegateId","status","createdAt");
CREATE INDEX "AccountDelegation_ownerId_delegateId_status_idx" ON "AccountDelegation"("ownerId","delegateId","status");
