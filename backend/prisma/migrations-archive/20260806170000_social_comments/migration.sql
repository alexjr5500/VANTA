PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_PostComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PostComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PostComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_PostComment" ("id", "userId", "postId", "content", "createdAt", "updatedAt")
SELECT "id", "userId", "postId", "content", "createdAt", "createdAt" FROM "PostComment";

DROP TABLE "PostComment";
ALTER TABLE "new_PostComment" RENAME TO "PostComment";

CREATE INDEX "PostComment_postId_createdAt_idx" ON "PostComment"("postId", "createdAt");
CREATE INDEX "PostComment_userId_createdAt_idx" ON "PostComment"("userId", "createdAt");
CREATE INDEX "PostComment_parentId_createdAt_idx" ON "PostComment"("parentId", "createdAt");

CREATE TABLE "PostCommentLike" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "PostComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PostCommentLike_userId_commentId_key" ON "PostCommentLike"("userId", "commentId");
CREATE INDEX "PostCommentLike_commentId_createdAt_idx" ON "PostCommentLike"("commentId", "createdAt");
CREATE INDEX "PostCommentLike_userId_createdAt_idx" ON "PostCommentLike"("userId", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;