/**
 * Cleanup: LIKE-as-chat-message spam
 * ----------------------------------
 * Older builds of the live chat treated every tap of the like/reaction button
 * as a chat/activity line (`@username liked the live`) and, in some deploys,
 * those pseudo-messages could end up persisted into `LiveChatMessage`.
 *
 * This script removes ONLY those incorrectly-generated LIKE-as-message records:
 *   - matches messages that read like "<name> liked the live"
 *   - never touches real comments, gifts, joins, or any other live data
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/cleanup-liked-live-messages.ts          # delete
 *   npx ts-node --transpile-only scripts/cleanup-liked-live-messages.ts --dry-run # inspect only
 */
import { prisma } from '../src/prisma';

// The exact phrase the old likes-as-chat bug rendered. Matching on it is safe:
// a genuine comment cannot contain this fixed response phrase.
const SPAM_MARKER = 'liked the live';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const matches = await prisma.liveChatMessage.findMany({
    where: { message: { contains: SPAM_MARKER } },
    select: { id: true, streamId: true, userId: true, message: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  console.log(
    `Found ${await prisma.liveChatMessage.count({ where: { message: { contains: SPAM_MARKER } } })} ` +
      `persisted LIKE-as-message record(s) in LiveChatMessage.`,
  );

  if (matches.length === 0) {
    console.log('Nothing to clean up — no like-spam rows persisted.');
    return;
  }

  for (const m of matches.slice(0, 20)) {
    console.log(`  - [${m.createdAt?.toISOString()}] stream=${m.streamId} user=${m.userId} "${m.message}"`);
  }
  if (matches.length > 20) console.log(`  ... and ${matches.length - 20} more.`);

  if (dryRun) {
    console.log('DRY RUN: no records were deleted. Re-run without --dry-run to remove them.');
    return;
  }

  const deleted = await prisma.liveChatMessage.deleteMany({
    where: { message: { contains: SPAM_MARKER } },
  });
  console.log(`Deleted ${deleted.count} LIKE-as-message record(s). Legitimate comments/gifts are untouched.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });