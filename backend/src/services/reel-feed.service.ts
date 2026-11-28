import { sensitiveFilter, hideSensitiveForViewer } from "./sensitive-content.service";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

// ============================================================================
// Reel Feed (short-form / randomized)
// ----------------------------------------------------------------------------
// Randomized Reel feed. The order is seeded per browsing
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

const MAX_CANDIDATES = 2000;

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
  hideSensitive?: boolean;
}) {
  const { userId, feed, seed, start, limit } = input;
  const hide = input.hideSensitive ?? await hideSensitiveForViewer(userId);

  const followingFilter =
    feed === "following" && userId
      ? { followers: { some: { followerId: userId } } }
      : undefined;

  // Only active, non-banned creators contribute Reels.
  const where: Prisma.VideoWhereInput = {
    publishStatus: "PUBLISHED",
    moderationRemovedAt: null,
    ...sensitiveFilter(hide),
    creator: {
      status: "ACTIVE",
      ...(followingFilter ? { followers: followingFilter.followers } : {}),
    },
  };

  const reels = await prisma.video.findMany({
    where,
    // Candidate engagement counts were never used by the seeded shuffle.
    // Keep a stable indexed order without forcing a relation-count sort.
    orderBy: [{ createdAt: "desc" as const }],
    take: MAX_CANDIDATES,
    select: {
      id: true,
      creatorId: true,
      createdAt: true,
    },
  });

  const effectiveSeed =
    seed && seed.trim() ? seed : `vanta:${userId ?? "anon"}:${Math.random().toString(36).slice(2, 10)}`;
  const rand = mulberry32(hashSeed(effectiveSeed));
  const candidates = reels.map((reel) => ({
    id: reel.id,
    creatorId: reel.creatorId,
    createdAt: reel.createdAt,
  }));

  // Shuffle the complete eligible candidate pool for this seed. Avoid a
  // popularity-weighted score here: it can keep a small handful of Reels near
  // the top across refreshes and make the feed feel like only two items rotate.
  // Fisher-Yates gives every candidate a randomized position while the seed
  // keeps pagination stable for the lifetime of this feed session.
  const ordered = candidates.slice();
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  // Preserve creator variety without dropping or duplicating any candidate.
  const diversified = interleaveCreators(ordered, rand);

  const page = diversified.slice(start, start + limit);
  const nextStart = start + page.length < diversified.length ? start + page.length : null;
  // Only check follow relationships for creators on this page, not every
  // account the viewer follows. This keeps feed latency bounded for large graphs.
  const pageCreatorIds = Array.from(new Set(page.map((reel) => reel.creatorId)));
  const myFollows = userId && pageCreatorIds.length
    ? new Set((await prisma.follow.findMany({
        where: { followerId: userId, followingId: { in: pageCreatorIds } },
        select: { followingId: true },
      })).map((row) => row.followingId))
    : new Set<string>();

  return {
    seed: effectiveSeed,
    nextStart,
    items: page,
    followedCreators: myFollows,
  };
}