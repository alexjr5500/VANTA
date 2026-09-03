-- Create the reusable unique-view ledger without changing or deleting existing data.
CREATE TABLE "ContentView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "viewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContentView_contentId_userId_contentType_key" ON "ContentView"("contentId", "userId", "contentType");
CREATE INDEX "ContentView_contentType_contentId_viewedAt_idx" ON "ContentView"("contentType", "contentId", "viewedAt");
CREATE INDEX "ContentView_userId_viewedAt_idx" ON "ContentView"("userId", "viewedAt");

-- Preserve all existing Story viewer history in the new reusable ledger.
INSERT OR IGNORE INTO "ContentView" ("id", "contentId", "userId", "contentType", "viewedAt")
SELECT 'story_' || "id", "storyId", "userId", 'STORY', "viewedAt" FROM "StoryView";

ALTER TABLE "Post" ADD COLUMN "views" INTEGER NOT NULL DEFAULT 0;