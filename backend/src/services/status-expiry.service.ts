import { prisma } from "../prisma";
import { uploadService } from "./upload.service";

const BATCH = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
let running = false;

/** Expired content is hidden immediately by read filters. The bounded sweeper
 * removes ordinary rows and their underlying Story-only assets; failures are
 * retried on later sweeps. Retain moderation/copyright evidence, and never
 * destroy an asset still referenced by another live or retained record. */
export async function sweepExpiredStatuses(now = new Date()) {
  if (running) return { stories: 0, files: 0, failed: 0 };
  running = true;
  let stories = 0, files = 0, failed = 0;
  try {
    // Keep held/removed content available to existing compliance workflows.
    const expired = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s.id FROM "Story" s
      WHERE s."expiresAt" <= ${now}
        AND s."moderationRemovedAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "ModerationQueue" m WHERE upper(m."targetType") IN ('STORY','STATUS') AND m."targetId" = s.id)
        AND NOT EXISTS (SELECT 1 FROM "CopyrightClaim" c WHERE upper(c."infringingContentType") IN ('STORY','STATUS') AND c."infringingContentId" = s.id)
      ORDER BY s."expiresAt", s.id LIMIT ${BATCH}
    `;
    if (expired.length) {
      const ids = expired.map(row => row.id);
      stories = await prisma.$transaction(async tx => {
        const deleted = await tx.story.deleteMany({ where: { id: { in: ids }, expiresAt: { lte: now }, moderationRemovedAt: null } });
        // The polymorphic view ledger has no foreign key to Story. Ordinary
        // StoryLike, StoryComment, StoryView rows cascade via the database.
        await tx.contentView.deleteMany({ where: { contentType: "STORY", contentId: { in: ids } } });
        return deleted.count;
      });
    }

    // Story rows are removed even when storage is temporarily unavailable;
    // orphan metadata is the durable retry marker. Existing legacy reshares
    // may still reference an original asset, so retain it until those expire.
    const cutoff = new Date(now.getTime() - DAY_MS);
    const candidates = await prisma.$queryRaw<Array<{ id: string; filename: string }>>`
      SELECT f.id, f.filename FROM "UploadedFile" f
      WHERE f.category = 'story' AND (f."recordType" = 'Story' OR f."recordType" IS NULL)
        AND f."deletedAt" IS NULL AND f."createdAt" <= ${cutoff}
        AND f."moderationOriginalPath" IS NULL AND f."moderationOriginalUrl" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Story" s WHERE s.id = f."recordId" OR s."mediaUrl" = f.url)
        AND NOT EXISTS (SELECT 1 FROM "Post" p WHERE p."mediaUrl" = f.url)
        AND NOT EXISTS (SELECT 1 FROM "Video" v WHERE v."videoUrl" = f.url OR v."thumbnailUrl" = f.url)
        AND NOT EXISTS (SELECT 1 FROM "UploadedFile" other WHERE other.id <> f.id AND other."deletedAt" IS NULL AND other.category <> 'story' AND (other.url = f.url OR other.path = f.path))
        AND NOT EXISTS (SELECT 1 FROM "ModerationQueue" m WHERE upper(m."targetType") IN ('STORY','STATUS') AND m."targetId" = f."recordId")
        AND NOT EXISTS (SELECT 1 FROM "CopyrightClaim" c WHERE upper(c."infringingContentType") IN ('STORY','STATUS') AND (c."infringingContentId" = f."recordId" OR c."infringingUrl" = f.url))
      ORDER BY f."updatedAt", f.id LIMIT ${BATCH}
    `;
    for (const file of candidates) {
      try {
        await uploadService.deleteFile(file.filename, file.id);
        // deleteFile soft-deletes its metadata; verify the retry marker is
        // actually updated rather than silently reporting storage success.
        const record = await prisma.uploadedFile.findUnique({ where: { id: file.id }, select: { deletedAt: true } });
        if (record && !record.deletedAt) throw new Error("Status deletion metadata was not persisted");
        files++;
      } catch (error) {
        failed++;
        console.warn("[StatusExpiry] Asset deletion failed; will retry", { fileId: file.id, error: error instanceof Error ? error.message : "unknown" });
        // Rotate failed rows so a single provider failure cannot starve the batch.
        await prisma.uploadedFile.updateMany({ where: { id: file.id, deletedAt: null }, data: { updatedAt: now } }).catch(() => undefined);
      }
    }
    return { stories, files, failed };
  } finally {
    running = false;
  }
}
