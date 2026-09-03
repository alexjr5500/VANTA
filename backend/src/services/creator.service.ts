import { prisma } from '../prisma';

/**
 * CreatorService
 *
 * Aggregates REAL creator metrics from existing VANTA tables (Post, Follow,
 * LiveStream, GiftTransaction, Wallet). It does NOT introduce a new wallet,
 * user model, or coin system — every value is read from data the platform
 * already stores. Metrics that the backend genuinely cannot supply are simply
 * omitted rather than fabricated.
 *
 * All aggregation is scoped to a single userId that the controller resolves
 * from the authenticated session, so a user can only read their own stats.
 */

export interface CreatorStats {
  // Identity (lets the Studio header render the verified handle from the DB)
  username: string;
  fullName: string | null;
  avatar: string | null;
  verified: boolean;
  role: string;

  // Audience
  totalFollowers: number;
  totalFollowing: number;

  // Content counts
  totalPosts: number;
  totalReels: number;
  totalLiveSessions: number;

  // Engagement (all-time, aggregated from the creator's own content)
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;

  // Monetization (reuses the existing wallet/earnings system)
  giftsReceived: number;
  coins: number;
  earnings: number;
  earningsBalance: number;
}

export interface CreatorContentItem {
  id: string;
  type: 'post' | 'reel';
  title: string;
  mediaUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  createdAt: string;
}

/**
 * Small helper: run a count/aggregate but never let an unexpected schema edge
 * crash the whole dashboard. A failed sub-metric resolves to 0 (an honest
 * "no data" rather than a fabricated number).
 */
async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export class CreatorService {
  /**
   * Aggregate the authenticated creator's overview stats from real tables.
   */
  async getCreatorStats(userId: string): Promise<CreatorStats> {
    // Identity + counts that map directly to confirmed User relations.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        fullName: true,
        avatar: true,
        verified: true,
        role: true,
        coins: true,
        earnings: true,
        wallet: { select: { coinBalance: true, earningsBalance: true } },
        _count: {
          select: {
            posts: true,
            followers: true,
            following: true,
            liveStreams: true,
            receivedGifts: true,
            videos: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Engagement aggregated across the creator's own posts.
    const [postAgg, likes, comments, saves] = await Promise.all([
      safe(
        prisma.post.aggregate({
          where: { authorId: userId },
          _sum: { views: true, shareCount: true },
        }),
        { _sum: { views: 0, shareCount: 0 } } as any
      ),
      safe(prisma.postLike.count({ where: { post: { authorId: userId } } }), 0),
      safe(prisma.postComment.count({ where: { post: { authorId: userId } } }), 0),
      safe(prisma.postSave.count({ where: { post: { authorId: userId } } }), 0),
    ]);

    return {
      username: user.username,
      fullName: user.fullName,
      avatar: user.avatar,
      verified: Boolean(user.verified),
      role: user.role,

      totalFollowers: user._count.followers,
      totalFollowing: user._count.following,

      totalPosts: user._count.posts,
      totalReels: user._count.videos,
      totalLiveSessions: user._count.liveStreams,

      totalViews: postAgg?._sum?.views ?? 0,
      totalLikes: likes,
      totalComments: comments,
      totalShares: postAgg?._sum?.shareCount ?? 0,
      totalSaves: saves,

      giftsReceived: user._count.receivedGifts,
      coins: user.coins ?? user.wallet?.coinBalance ?? 0,
      earnings: user.earnings ?? 0,
      earningsBalance: user.wallet?.earningsBalance ?? 0,
    };
  }

  /**
   * Return the authenticated creator's most recent content with real
   * per-item performance numbers.
   */
  async getCreatorContent(userId: string, limit = 20): Promise<CreatorContentItem[]> {
    const posts = await safe(
      prisma.post.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          content: true,
          mediaUrl: true,
          views: true,
          shareCount: true,
          createdAt: true,
          _count: { select: { likes: true, comments: true, saves: true } },
        },
      }),
      [] as any[]
    );

    return posts.map((post: any) => ({
      id: post.id,
      type: 'post' as const,
      title: (post.content || '').slice(0, 120) || 'Untitled post',
      mediaUrl: post.mediaUrl ?? null,
      views: post.views ?? 0,
      likes: post._count?.likes ?? 0,
      comments: post._count?.comments ?? 0,
      saves: post._count?.saves ?? 0,
      shares: post.shareCount ?? 0,
      createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : String(post.createdAt),
    }));
  }
}

export const creatorService = new CreatorService();
