// =============================================================================
// VANTA Recommendation Service
// Orchestrates personalized feed, discovery, trending, and similarity
// =============================================================================

import { aiClient, AIResponse } from '../ai.client';
import { AI_CONFIG } from '../ai.config';
import { cacheService } from '../../services/cache.service';
import { prisma } from '../../prisma';
import { metricsCollector } from '../../services/monitoring.service';

export interface FeedOptions {
  limit?: number;
  offset?: number;
  types?: string[];
  diversity?: boolean;
  freshness?: boolean;
}

export interface DiscoveryOptions {
  limit?: number;
  categories?: string[];
  excludeIds?: string[];
}

export interface FeedItem {
  id: string;
  type: 'VIDEO' | 'POST' | 'STREAM' | 'STORY' | 'SHORT';
  score: number;
  reason?: string;
  data: any;
  createdAt: string;
}

export interface RecommendationItem {
  id: string;
  contentType: string;
  contentId: string;
  score: number;
  reason?: string;
  data?: any;
}

// Content type weights for diversity mixing
const TYPE_WEIGHTS: Record<string, number> = {
  VIDEO: 1.0,
  POST: 0.9,
  STREAM: 1.1,
  STORY: 0.7,
  SHORT: 1.0,
};

const MAX_CONSECUTIVE_SAME_TYPE = 3;
const FRESHNESS_DECAY_HOURS = 48;
const DIVERSITY_PENALTY_THRESHOLD = 0.3;

class RecommendationService {
  /**
   * Get personalized feed for a user
   */
  async getPersonalizedFeed(userId: string, options: FeedOptions = {}): Promise<FeedItem[]> {
    const {
      limit = 30,
      offset = 0,
      types = ['VIDEO', 'POST', 'STREAM', 'STORY'],
      diversity = true,
      freshness = true,
    } = options;

    const startTime = Date.now();
    const cacheKey = `feed:${userId}:${JSON.stringify(options)}`;

    try {
      // Check cache
      const cached = await cacheService.get<FeedItem[]>(cacheKey);
      if (cached) return cached.slice(offset, offset + limit);

      // Get user context for personalization
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          country: true,
          interests: true,
          followers: { take: 100, select: { followingId: true } },
          following: { take: 100, select: { followerId: true } },
          watchHistory: {
            take: 50,
            orderBy: { updatedAt: 'desc' },
            select: { videoId: true, completed: true },
          },
          postLikes: { take: 50, select: { postId: true } },
          videoLikes: { take: 50, select: { videoId: true } },
        },
      });

      if (!user) {
        return this.getFallbackFeed(limit, offset);
      }

      // Try AI-powered recommendations
      const aiResponse = await aiClient.getPersonalizedFeed({
        userId,
        followingIds: user.following.map(f => f.followerId),
        country: user.country,
        interests: user.interests,
        types,
        limit: limit * 3, // Request more for diversity mixing
      });

      let feedItems: FeedItem[] = [];

      if (aiResponse.success && aiResponse.data?.items?.length > 0) {
        // Enrich with database data
        feedItems = await this.enrichFeedItems(aiResponse.data.items, userId);
      } else {
        // Fallback to database-driven feed
        feedItems = await this.getFallbackFeed(limit * 3, 0);
      }

      // Apply freshness decay
      if (freshness) {
        feedItems = this.applyFreshnessDecay(feedItems);
      }

      // Apply diversity mixing
      if (diversity) {
        feedItems = this.applyDiversityMixing(feedItems);
      }

      // Sort by final score
      feedItems.sort((a, b) => b.score - a.score);

      // Cache result
      await cacheService.set(cacheKey, feedItems, AI_CONFIG.cache.recommendation);

      // Track metrics
      metricsCollector.record('feed_generation_time', Date.now() - startTime, { userId });

      return feedItems.slice(offset, offset + limit);
    } catch (error) {
      console.error('[RecommendationService] getPersonalizedFeed error:', error);
      return this.getFallbackFeed(limit, offset);
    }
  }

  /**
   * Get discovery items (new creators, streams, communities, etc.)
   */
  async getDiscoveryItems(userId: string, options: DiscoveryOptions = {}): Promise<Record<string, any[]>> {
    const { limit = 20, categories, excludeIds } = options;

    try {
      // Try AI-powered discovery
      const aiResponse = await aiClient.getDiscoveryItems({
        userId,
        categories,
        excludeIds,
        limit,
      });

      if (aiResponse.success && aiResponse.data) {
        return aiResponse.data;
      }

      // Fallback: get from database
      return this.getFallbackDiscovery(userId, limit);
    } catch (error) {
      console.error('[RecommendationService] getDiscoveryItems error:', error);
      return this.getFallbackDiscovery(userId, limit);
    }
  }

  /**
   * Get similar content
   */
  async getSimilarContent(contentId: string, contentType: string, limit: number = 10): Promise<RecommendationItem[]> {
    const cacheKey = `similar:${contentType}:${contentId}:${limit}`;

    try {
      const cached = await cacheService.get<RecommendationItem[]>(cacheKey);
      if (cached) return cached;

      const aiResponse = await aiClient.getSimilarContent({
        contentId,
        contentType,
        limit,
      });

      if (aiResponse.success && aiResponse.data?.items?.length > 0) {
        await cacheService.set(cacheKey, aiResponse.data.items, AI_CONFIG.cache.recommendation);
        return aiResponse.data.items;
      }

      // Fallback: find content by same creator or similar type
      return this.getFallbackSimilarContent(contentId, contentType, limit);
    } catch (error) {
      console.error('[RecommendationService] getSimilarContent error:', error);
      return this.getFallbackSimilarContent(contentId, contentType, limit);
    }
  }

  /**
   * Get trending content
   */
  async getTrending(category?: string, period: string = 'day', limit: number = 20): Promise<RecommendationItem[]> {
    const cacheKey = `trending:${category || 'all'}:${period}:${limit}`;

    try {
      const cached = await cacheService.get<RecommendationItem[]>(cacheKey);
      if (cached) return cached;

      const aiResponse = await aiClient.getTrending({
        category,
        period,
        limit,
      });

      if (aiResponse.success && aiResponse.data?.items?.length > 0) {
        await cacheService.set(cacheKey, aiResponse.data.items, AI_CONFIG.cache.trending);
        return aiResponse.data.items;
      }

      // Fallback: database trending
      return this.getFallbackTrending(category, period, limit);
    } catch (error) {
      console.error('[RecommendationService] getTrending error:', error);
      return [];
    }
  }

  /**
   * Record user interaction for ML training
   */
  async recordUserInteraction(
    userId: string,
    eventType: string,
    targetType: string,
    targetId: string,
    metadata?: any
  ): Promise<void> {
    try {
      // Store interaction event
      await prisma.interactionEvent.create({
        data: {
          userId,
          eventType,
          targetType,
          targetId,
          metadata: metadata ? JSON.stringify(metadata) : undefined,
        },
      });

      // Update user interest weights if applicable
      if (['LIKE', 'COMMENT', 'SHARE', 'SAVE', 'WATCH'].includes(eventType)) {
        await this.updateUserInterests(userId, targetType, targetId, eventType);
      }

      // Invalidate feed cache
      await cacheService.invalidate(`feed:${userId}:*`);

      // Fire-and-forget AI model update
      this.notifyAIModel(userId, eventType, targetType, targetId, metadata).catch(() => {});
    } catch (error) {
      console.error('[RecommendationService] recordUserInteraction error:', error);
    }
  }

  /**
   * Get trending hashtags
   */
  async getTrendingHashtags(limit: number = 20): Promise<string[]> {
    const cacheKey = `trending:hashtags:${limit}`;

    try {
      const cached = await cacheService.get<string[]>(cacheKey);
      if (cached) return cached;

      // Extract hashtags from recent posts
      const recentPosts = await prisma.post.findMany({
        take: 500,
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });

      const hashtags: Map<string, number> = new Map();
      const hashtagRegex = /#[\w]+/g;

      for (const post of recentPosts) {
        const matches = post.content.match(hashtagRegex);
        if (matches) {
          for (const tag of matches) {
            const lower = tag.toLowerCase();
            hashtags.set(lower, (hashtags.get(lower) || 0) + 1);
          }
        }
      }

      const sorted = Array.from(hashtags.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([tag]) => tag);

      await cacheService.set(cacheKey, sorted, AI_CONFIG.cache.trending);
      return sorted;
    } catch (error) {
      console.error('[RecommendationService] getTrendingHashtags error:', error);
      return [];
    }
  }

  /**
   * Get trending topics
   */
  async getTrendingTopics(limit: number = 10): Promise<Array<{ topic: string; count: number }>> {
    const cacheKey = `trending:topics:${limit}`;

    try {
      const cached = await cacheService.get<Array<{ topic: string; count: number }>>(cacheKey);
      if (cached) return cached;

      // Query interaction events for trending targets
      const recentInteractions = await prisma.interactionEvent.groupBy({
        by: ['targetType', 'targetId'],
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          eventType: { in: ['LIKE', 'COMMENT', 'SHARE'] },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: limit,
      });

      const topics = recentInteractions.map(item => ({
        topic: `${item.targetType}:${item.targetId}`,
        count: item._count.id,
      }));

      await cacheService.set(cacheKey, topics, AI_CONFIG.cache.trending);
      return topics;
    } catch (error) {
      console.error('[RecommendationService] getTrendingTopics error:', error);
      return [];
    }
  }

  /**
   * Generate/update user interests from interactions
   */
  private async updateUserInterests(userId: string, targetType: string, targetId: string, source: string): Promise<void> {
    try {
      let interestType: string;
      let interestValue: string;

      // Determine interest type based on target
      switch (targetType) {
        case 'VIDEO': {
          const video = await prisma.video.findUnique({
            where: { id: targetId },
            select: { title: true, description: true },
          });
          if (!video) return;
          // Extract meaningful interests from title/description
          interestType = 'CONTENT';
          interestValue = video.title.substring(0, 100);
          break;
        }
        case 'USER':
          interestType = 'CREATOR';
          interestValue = targetId;
          break;
        case 'COMMUNITY': {
          const community = await prisma.community.findUnique({
            where: { id: targetId },
            select: { category: true },
          });
          interestType = 'CATEGORY';
          interestValue = community?.category || 'unknown';
          break;
        }
        default:
          interestType = 'TOPIC';
          interestValue = targetId;
      }

      // Upsert user interest
      await prisma.userInterest.upsert({
        where: {
          userId_interestType_interestValue_source: {
            userId,
            interestType,
            interestValue,
            source,
          },
        },
        update: {
          weight: { increment: 1 },
        },
        create: {
          userId,
          interestType,
          interestValue,
          source,
          weight: 1,
        },
      });
    } catch (error) {
      console.error('[RecommendationService] updateUserInterests error:', error);
    }
  }

  /**
   * Notify AI model of interaction for online learning
   */
  private async notifyAIModel(
    userId: string,
    eventType: string,
    targetType: string,
    targetId: string,
    metadata?: any
  ): Promise<void> {
    try {
      await aiClient.getPersonalizedFeed({
        userId,
        event: { eventType, targetType, targetId, metadata },
        train: true,
      });
    } catch {
      // Non-critical, ignore
    }
  }

  /**
   * Enrich feed items with database data
   */
  private async enrichFeedItems(items: any[], userId: string): Promise<FeedItem[]> {
    const enriched: FeedItem[] = [];

    for (const item of items) {
      try {
        let data: any = null;

        switch (item.contentType || item.type) {
          case 'VIDEO':
            data = await prisma.video.findUnique({
              where: { id: item.contentId || item.id },
              include: {
                creator: { select: { id: true, username: true, avatar: true, verified: true } },
                _count: { select: { likes: true, comments: true, saves: true } },
              },
            });
            break;
          case 'POST':
            data = await prisma.post.findUnique({
              where: { id: item.contentId || item.id },
              include: {
                author: { select: { id: true, username: true, avatar: true, verified: true } },
                _count: { select: { likes: true, comments: true } },
              },
            });
            break;
          case 'STREAM':
            data = await prisma.liveStream.findUnique({
              where: { id: item.contentId || item.id },
              include: {
                host: { select: { id: true, username: true, avatar: true, verified: true } },
                _count: { select: { viewers: true } },
              },
            });
            break;
          case 'STORY':
            data = await prisma.story.findUnique({
              where: { id: item.contentId || item.id },
              include: {
                user: { select: { id: true, username: true, avatar: true, verified: true } },
              },
            });
            break;
        }

        if (data) {
          enriched.push({
            id: data.id,
            type: (item.contentType || item.type) as FeedItem['type'],
            score: item.score || 0.5,
            reason: item.reason,
            data,
            createdAt: data.createdAt?.toISOString() || new Date().toISOString(),
          });
        }
      } catch (err) {
        console.warn(`[RecommendationService] Failed to enrich item ${item.id}:`, err);
      }
    }

    return enriched;
  }

  /**
   * Apply freshness decay to feed items
   */
  private applyFreshnessDecay(items: FeedItem[]): FeedItem[] {
    const now = Date.now();
    const decayMs = FRESHNESS_DECAY_HOURS * 60 * 60 * 1000;

    return items.map(item => {
      const age = now - new Date(item.createdAt).getTime();
      const decay = Math.max(0, 1 - age / decayMs);
      return {
        ...item,
        score: item.score * (0.3 + 0.7 * decay),
      };
    });
  }

  /**
   * Apply diversity mixing to feed
   */
  private applyDiversityMixing(items: FeedItem[]): FeedItem[] {
    if (items.length === 0) return items;

    const typeCounts: Record<string, number> = {};
    const totalItems = items.length;

    // Count type occurrences
    for (const item of items) {
      typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
    }

    // Apply diversity penalties
    return items.map((item, index) => {
      let diversityScore = item.score;

      // Penalize consecutive same-type items
      if (index >= MAX_CONSECUTIVE_SAME_TYPE) {
        const lastTypes = items
          .slice(Math.max(0, index - MAX_CONSECUTIVE_SAME_TYPE), index)
          .map(i => i.type);
        
        const consecutiveSame = lastTypes.filter(t => t === item.type).length;
        if (consecutiveSame >= MAX_CONSECUTIVE_SAME_TYPE) {
          diversityScore *= 0.7;
        }
      }

      // Penalize over-represented types
      const typeRatio = (typeCounts[item.type] || 0) / totalItems;
      if (typeRatio > DIVERSITY_PENALTY_THRESHOLD) {
        diversityScore *= (1 - (typeRatio - DIVERSITY_PENALTY_THRESHOLD));
      }

      // Boost underrepresented types with high relevance
      const weight = TYPE_WEIGHTS[item.type] || 1.0;
      diversityScore *= weight;

      return { ...item, score: Math.max(0, diversityScore) };
    });
  }

  /**
   * Fallback feed when AI is unavailable
   */
  private async getFallbackFeed(limit: number, offset: number): Promise<FeedItem[]> {
    const items: FeedItem[] = [];

    try {
      // Get recent videos
      const videos = await prisma.video.findMany({
        take: Math.ceil(limit / 3),
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: { select: { id: true, username: true, avatar: true, verified: true } },
          _count: { select: { likes: true, comments: true } },
        },
      });

      for (const v of videos) {
        items.push({
          id: v.id,
          type: 'VIDEO',
          score: 0.5 + (v.views / 1000) * 0.1,
          reason: 'Popular content',
          data: v,
          createdAt: v.createdAt.toISOString(),
        });
      }

      // Get recent posts
      const posts = await prisma.post.findMany({
        take: Math.ceil(limit / 3),
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { id: true, username: true, avatar: true, verified: true } },
          _count: { select: { likes: true, comments: true } },
        },
      });

      for (const p of posts) {
        items.push({
          id: p.id,
          type: 'POST',
          score: 0.4 + Math.random() * 0.2,
          reason: 'Recent post',
          data: p,
          createdAt: p.createdAt.toISOString(),
        });
      }

      // Get active live streams
      const streams = await prisma.liveStream.findMany({
        where: { active: true },
        take: Math.ceil(limit / 3),
        orderBy: { viewerCount: 'desc' },
        include: {
          host: { select: { id: true, username: true, avatar: true, verified: true } },
          _count: { select: { viewers: true } },
        },
      });

      for (const s of streams) {
        items.push({
          id: s.id,
          type: 'STREAM',
          score: 0.6 + (s.viewerCount / 100) * 0.1,
          reason: 'Live now',
          data: s,
          createdAt: s.createdAt.toISOString(),
        });
      }
    } catch (error) {
      console.error('[RecommendationService] getFallbackFeed error:', error);
    }

    return items.slice(offset, offset + limit);
  }

  /**
   * Fallback discovery items
   */
  private async getFallbackDiscovery(userId: string, limit: number): Promise<Record<string, any[]>> {
    const results: Record<string, any[]> = {};

    try {
      // New live streams
      results.liveStreams = await prisma.liveStream.findMany({
        where: { active: true },
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          host: { select: { id: true, username: true, avatar: true, verified: true } },
        },
      });

      // New communities
      results.communities = await prisma.community.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { id: true, username: true, avatar: true } },
          _count: { select: { members: true } },
        },
      });

      // New creators (users with videos)
      results.newCreators = await prisma.user.findMany({
        where: { videos: { some: {} } },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          avatar: true,
          verified: true,
          bio: true,
          _count: { select: { followers: true, videos: true } },
        },
      });

      // Trending posts
      results.posts = await prisma.post.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { id: true, username: true, avatar: true, verified: true } },
          _count: { select: { likes: true, comments: true } },
        },
      });
    } catch (error) {
      console.error('[RecommendationService] getFallbackDiscovery error:', error);
    }

    return results;
  }

  /**
   * Fallback similar content
   */
  private async getFallbackSimilarContent(
    contentId: string,
    contentType: string,
    limit: number
  ): Promise<RecommendationItem[]> {
    try {
      switch (contentType) {
        case 'VIDEO': {
          const video = await prisma.video.findUnique({ where: { id: contentId }, select: { creatorId: true } });
          if (!video) return [];
          const similar = await prisma.video.findMany({
            where: { creatorId: video.creatorId, id: { not: contentId } },
            take: limit,
            orderBy: { views: 'desc' },
          });
          return similar.map(v => ({
            id: v.id,
            contentType: 'VIDEO',
            contentId: v.id,
            score: v.views / 10000,
            reason: 'From same creator',
          }));
        }
        case 'POST': {
          const post = await prisma.post.findUnique({ where: { id: contentId }, select: { authorId: true } });
          if (!post) return [];
          const similar = await prisma.post.findMany({
            where: { authorId: post.authorId, id: { not: contentId } },
            take: limit,
            orderBy: { createdAt: 'desc' },
          });
          return similar.map(p => ({
            id: p.id,
            contentType: 'POST',
            contentId: p.id,
            score: 0.5,
            reason: 'From same author',
          }));
        }
        default:
          return [];
      }
    } catch (error) {
      console.error('[RecommendationService] getFallbackSimilarContent error:', error);
      return [];
    }
  }

  /**
   * Fallback trending content
   */
  private async getFallbackTrending(
    category?: string,
    period?: string,
    limit: number = 20
  ): Promise<RecommendationItem[]> {
    try {
      const since = this.getPeriodSince(period || 'day');

      // Get trending videos by views
      const videos = await prisma.video.findMany({
        where: {
          createdAt: { gte: since },
          ...(category ? { title: { contains: category } } : {}),
        },
        take: limit,
        orderBy: { views: 'desc' },
      });

      return videos.map(v => ({
        id: v.id,
        contentType: 'VIDEO',
        contentId: v.id,
        score: (v.views * 0.6 + v.createdAt.getTime() * 0.4) / 100000,
        reason: `Trending in ${category || 'all'}`,
      }));
    } catch (error) {
      console.error('[RecommendationService] getFallbackTrending error:', error);
      return [];
    }
  }

  private getPeriodSince(period: string): Date {
    const now = new Date();
    switch (period) {
      case 'hour': return new Date(now.getTime() - 60 * 60 * 1000);
      case 'day': return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case 'week': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default: return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }
}

export const recommendationService = new RecommendationService();