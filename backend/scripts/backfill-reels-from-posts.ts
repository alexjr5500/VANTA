/**
 * One-time, manual maintenance task for VIDEO uploads published through the
 * old Create Post flow before it was unified with Reel publishing.
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/backfill-reels-from-posts.ts           # dry run
 *   npx ts-node --transpile-only scripts/backfill-reels-from-posts.ts --apply   # explicit mutation
 *
 * Does not delete or re-link posts/uploads; old posts and their interactions
 * stay intact. Existing Video records matched by creator+URL are skipped.
 * Verify media storage is healthy before executing in production.
 */
import { prisma } from '../src/prisma';

const apply = process.argv.includes('--apply');
const VIDEO_EXT = /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i;

async function run() {
  let cursor: string | undefined;
  let scanned = 0;
  let eligible = 0;
  let created = 0;
  let alreadyExists = 0;
  while (true) {
    const posts = await prisma.post.findMany({
      where: { moderationRemovedAt: null },
      select: { id: true, authorId: true, content: true, mediaUrl: true },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (posts.length === 0) break;
    cursor = posts[posts.length - 1].id;
    scanned += posts.length;
    const files = await prisma.uploadedFile.findMany({
      where: {
        recordType: 'Post',
        recordId: { in: posts.map(post => post.id) },
        fileType: 'VIDEO',
        deletedAt: null,
      },
      select: { recordId: true, url: true },
    });
    const byPost = new Map<string, Set<string>>();
    for (const file of files) {
      if (!file.recordId || !file.url) continue;
      const urls = byPost.get(file.recordId) ?? new Set<string>();
      urls.add(file.url);
      byPost.set(file.recordId, urls);
    }
    for (const post of posts) {
      const urls = byPost.get(post.id) ?? new Set<string>();
      // Legacy post versions sometimes saved the video URL without an
      // UploadedFile relationship; accept only obvious video extensions.
      if (post.mediaUrl && VIDEO_EXT.test(post.mediaUrl)) urls.add(post.mediaUrl);
      for (const videoUrl of urls) {
        eligible++;
        const exists = await prisma.video.findFirst({
          where: { creatorId: post.authorId, videoUrl },
          select: { id: true },
        });
        if (exists) {
          alreadyExists++;
          continue;
        }
        if (!apply) continue;
        const caption = post.content.trim();
        await prisma.video.create({
          data: {
            creatorId: post.authorId,
            title: (caption.split('\n')[0] || 'Reel').slice(0, 120),
            description: caption || undefined,
            videoUrl,
            views: 0,
            publishStatus: 'PUBLISHED',
          },
        });
        created++;
      }
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'APPLIED' : 'DRY_RUN', scanned, eligible, alreadyExists, created }, null, 2));
}

run()
  .catch(error => {
    console.error('Legacy video backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
