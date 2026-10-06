-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Gift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "icon" TEXT,
    "image" TEXT,
    "emoji" TEXT,
    "category" TEXT NOT NULL DEFAULT 'popular',
    "subcategory" TEXT,
    "description" TEXT,
    "animationUrl" TEXT,
    "animationType" TEXT NOT NULL DEFAULT 'float',
    "thumbnailUrl" TEXT,
    "glowColor" TEXT,
    "particleColor" TEXT,
    "soundEffect" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isTrending" BOOLEAN NOT NULL DEFAULT false,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isLimited" BOOLEAN NOT NULL DEFAULT false,
    "isLegendary" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "comboEnabled" BOOLEAN NOT NULL DEFAULT true,
    "comboMultiplier" REAL NOT NULL DEFAULT 1.0,
    "animationDuration" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Gift" ("animationDuration", "animationType", "animationUrl", "category", "comboEnabled", "comboMultiplier", "createdAt", "description", "emoji", "expiresAt", "glowColor", "icon", "id", "image", "isActive", "isFeatured", "isLegendary", "isLimited", "isPopular", "isTrending", "name", "particleColor", "price", "slug", "sortOrder", "soundEffect", "subcategory", "thumbnailUrl", "updatedAt") SELECT "animationDuration", "animationType", "animationUrl", "category", "comboEnabled", "comboMultiplier", "createdAt", "description", "emoji", "expiresAt", "glowColor", "icon", "id", "image", "isActive", "isFeatured", "isLegendary", "isLimited", "isPopular", "isTrending", "name", "particleColor", "price", "slug", "sortOrder", "soundEffect", "subcategory", "thumbnailUrl", "updatedAt" FROM "Gift";
DROP TABLE "Gift";
ALTER TABLE "new_Gift" RENAME TO "Gift";
CREATE UNIQUE INDEX "Gift_slug_key" ON "Gift"("slug");
CREATE INDEX "Gift_category_isActive_idx" ON "Gift"("category", "isActive");
CREATE INDEX "Gift_isActive_sortOrder_idx" ON "Gift"("isActive", "sortOrder");
CREATE INDEX "Gift_isFeatured_isActive_sortOrder_idx" ON "Gift"("isFeatured", "isActive", "sortOrder");
CREATE INDEX "Gift_isTrending_isActive_sortOrder_idx" ON "Gift"("isTrending", "isActive", "sortOrder");
CREATE INDEX "Gift_isPopular_isActive_sortOrder_idx" ON "Gift"("isPopular", "isActive", "sortOrder");
CREATE INDEX "Gift_isLimited_expiresAt_idx" ON "Gift"("isLimited", "expiresAt");
CREATE INDEX "Gift_category_subcategory_isActive_idx" ON "Gift"("category", "subcategory", "isActive");
CREATE INDEX "Gift_isLegendary_isActive_idx" ON "Gift"("isLegendary", "isActive");
CREATE INDEX "Gift_price_isActive_idx" ON "Gift"("price", "isActive");
CREATE TABLE "new_GiftTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "streamId" TEXT,
    "amount" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "isCombo" BOOLEAN NOT NULL DEFAULT false,
    "comboCount" INTEGER NOT NULL DEFAULT 1,
    "isAnon" BOOLEAN NOT NULL DEFAULT false,
    "isSuper" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftTransaction_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GiftTransaction_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GiftTransaction_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GiftTransaction" ("amount", "comboCount", "createdAt", "giftId", "id", "isAnon", "isCombo", "isSuper", "receiverId", "senderId", "streamId") SELECT "amount", "comboCount", "createdAt", "giftId", "id", "isAnon", "isCombo", "isSuper", "receiverId", "senderId", "streamId" FROM "GiftTransaction";
DROP TABLE "GiftTransaction";
ALTER TABLE "new_GiftTransaction" RENAME TO "GiftTransaction";
CREATE INDEX "GiftTransaction_senderId_idx" ON "GiftTransaction"("senderId");
CREATE INDEX "GiftTransaction_receiverId_idx" ON "GiftTransaction"("receiverId");
CREATE INDEX "GiftTransaction_streamId_idx" ON "GiftTransaction"("streamId");
CREATE INDEX "GiftTransaction_createdAt_idx" ON "GiftTransaction"("createdAt");
CREATE INDEX "GiftTransaction_receiverId_createdAt_idx" ON "GiftTransaction"("receiverId", "createdAt");
CREATE INDEX "GiftTransaction_senderId_receiverId_createdAt_idx" ON "GiftTransaction"("senderId", "receiverId", "createdAt");
CREATE INDEX "GiftTransaction_streamId_receiverId_createdAt_idx" ON "GiftTransaction"("streamId", "receiverId", "createdAt");
CREATE INDEX "GiftTransaction_giftId_createdAt_idx" ON "GiftTransaction"("giftId", "createdAt");
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("content", "conversationId", "createdAt", "id", "senderId", "type") SELECT "content", "conversationId", "createdAt", "id", "senderId", "type" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Message_conversationId_deletedAt_createdAt_idx" ON "Message"("conversationId", "deletedAt", "createdAt");
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");
CREATE INDEX "Message_conversationId_senderId_createdAt_idx" ON "Message"("conversationId", "senderId", "createdAt");
CREATE INDEX "Message_type_conversationId_createdAt_idx" ON "Message"("type", "conversationId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

