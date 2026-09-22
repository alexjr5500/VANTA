import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

// ============================================================================
// Reel Feed (short-form / randomized)
// ----------------------------------------------------------------------------
// Deterministic-but-randomized Reel feed. The order is seeded per browsing
// session so it stays stable while the user scrolls, but varies between sessions
// and does not collapse to first-created/first-served.
//
// Algorithm:
//   1. Active/public candidates (creator status ACTIVE).
//   2. Engagement + recency bias (recent + popular content surfaces earlier).
//   3. Per-user view-history penalty (prefer unseen / less recently viewed).
//   4. Seeded random jitter so the mix changes each session.
//   5. Creator-diversity interleave to avoid consecutive videos from one creator.
//
// No AI/ML — a solid deterministic recommendation approach as required.
// ============================================================================

const MAX_CANDIDATES = 500;

/** Small, fast, seedable PRNG (mulberry32). Deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Interleave so consecutive entries from the same creator are spread out when
 * enough different creators exist. Buckets by creator, then draws round-robin
 * with a seeded hop so the resulting order stays varied and deterministic.
 */
function interleaveCreators<T extends { creatorId: string }>(items: T[], rand: () => number): T[] {
  const bins = new Map<string, T[]>();
  for (const item of items) {
    const list = bins.get(item.creatorId) ?? [];
    list.push(item);
    bins.set(item.creatorId, list);
  }
  const queue = Array.from(bins.values());
  const result: T[] = [];
  let index = 0;
  let safety = 0;
  const guard = items.length * 4 + 1;
  while (queue.some((bin) => bin.length > 0) && safety < guard) {
    safety++;
    let progressed = false;
    for (let offset = 0; offset < queue.length; offset++) {
      const pos = (index + offset) % queue.length;
      const bin = queue[pos];
      if (bin.length > 0) {
        result.push(bin.shift() as T);
        index = (index + (Math.floor(rand() * 3) + 1)) % queue.length;
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }
  return result;
}

/**
 * Build the personalized Reel feed. Pagination uses a stable offset over the
 * ordered candidate list so scrolling never introduces duplicates or jumps.
 */
export async function buildReelFeed(input: {
  userId?: string;
  feed: "for-you" | "trending" | "following";
  seed?: string;
  start: number;
  limit: number;
}) {
  const { userId, feed, seed, start, limit } = input;

  const followingFilter =
    feed === "following" && userId
      ? { followers: { some: { followerId: userId } } }
      : undefined;

  // Only active, non-banned creators contribute Reels.
  const where: Prisma.VideoWhereInput = {
    publishStatus: "PUBLISHED",
    creator: {
      status: "ACTIVE",
      ...(followingFilter ? { followers: followingFilter.followers } : {}),
    },
  };

  const reels = await prisma.video.findMany({
    where,
    orderBy: [{ likes: { _count: "desc" as const } }, { createdAt: "desc" as const }],
    take: MAX_CANDIDATES,
    select: {
      id: true,
      creatorId: true,
      views: true,
      createdAt: true,
      _count: { select: { likes: true, comments: true, saves: true } },
    },
  });

  const reelIds = reels.map((r) => r.id);
  const [myFollows, myViews] = await Promise.all([
    userId
      ? prisma.follow
          .findMany({ where: { followerId: userId }, select: { followingId: true } })
          .then((rows) => new Set(rows.map((x) => x.followingId)))
      : Promise.resolve(new Set<string>()),
    userId && reelIds.length
      ? prisma.contentView.findMany({
          where: { contentType: "REEL", userId, contentId: { in: reelIds } },
          select: { contentId: true, viewedAt: true },
        })
      : Promise.resolve([]),
  ]);

  const viewedMeta = new Map<string, number>();
  for (const view of myViews) {
    const existing = viewedMeta.get(view.contentId);
    viewedMeta.set(
      view.contentId,
      existing === undefined ? view.viewedAt.getTime() : Math.max(existing, view.viewedAt.getTime())
    );
  }

  const effectiveSeed =
    seed && seed.trim() ? seed : `vanta:${userId ?? "anon"}:${Math.random().toString(36).slice(2, 10)}`;
  const rand = mulberry32(hashSeed(effectiveSeed));
  const now = Date.now();

  const candidates = reels.map((reel) => ({
    id: reel.id,
    creatorId: reel.creatorId,
    views: reel.views,
    likes: reel._count.likes,
    comments: reel._count.comments,
    saves: reel._count.saves,
    createdAt: reel.createdAt,
  }));

  // Score each candidate. Lower score = surface first.
  const scored = candidates.map((c) => {
    const ageDays = Math.max(0, (now - c.createdAt.getTime()) / (24 * 60 * 60 * 1000));
    const engagement = c.likes * 3 + c.comments * 4 + c.saves * 2 + Math.min(c.views / 50, 5);
    const engagementScore = Math.min(engagement, 20);
    const recencyBoost = Math.max(0, 4 - ageDays);

    const lastViewed = viewedMeta.get(c.id);
    const viewRecencyPenalty =
      lastViewed === undefined ? 0 : Math.max(0, 12 - (now - lastViewed) / (6 * 60 * 60 * 1000));

    const jitter = rand() * 6;
    const score = viewRecencyPenalty * 8 - engagementScore - recencyBoost + jitter;
    return { c, score };
  });

  scored.sort((a, b) => a.score - b.score);
  const ordered = interleaveCreators(scored.map((s) => s.c), rand);

  const page = ordered.slice(start, start + limit);
  const nextStart = start + page.length < ordered.length ? start + page.length : null;

  return {
    seed: effectiveSeed,
    nextStart,
    items: page,
    followedCreators: myFollows,
  };
}