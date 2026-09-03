import { prisma } from "../prisma";
import { cacheService, CACHE_KEYS, CACHE_TTL } from "./cache.service";

const SEARCH_LIMIT_ALL = 5; // When searching "all" types
const SEARCH_RESULTS_CACHE_TTL = 60_000; // 1 minute

export class SearchService {
  async search(query: string, type?: string, cursor?: string, limit: number = 20) {
    // Cache search results for identical queries
    const cacheKey = `search:${query}:${type || 'all'}:${cursor || 'none'}`;
    
    return cacheService.getOrSet(cacheKey, async () => {
      const results: any = {};

      // SQLite's default text comparison is case-insensitive for ASCII.
      const lowerQuery = query.toLowerCase();

      if (!type || type === "users" || type === "all") {
        results.users = await prisma.user.findMany({
          where: {
            OR: [
              { username: { contains: query } },
              { fullName: { contains: query } },
            ],
            status: "ACTIVE",
          },
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
            bio: true,
            verified: true,
            premium: true,
            _count: { select: { followers: true } },
          },
          take: type === "users" ? limit : SEARCH_LIMIT_ALL,
        });
      }

      if (!type || type === "posts" || type === "all") {
        results.posts = await prisma.post.findMany({
          where: { content: { contains: query } },
          orderBy: { createdAt: "desc" },
          take: type === "posts" ? limit : SEARCH_LIMIT_ALL,
          include: {
            author: { select: { id: true, username: true, avatar: true, verified: true } },
            _count: { select: { likes: true, comments: true } },
          },
        });
      }

      if (!type || type === "communities" || type === "all") {
        results.communities = await prisma.community.findMany({
          where: {
            OR: [
              { name: { contains: query } },
              { description: { contains: query } },
            ],
          },
          take: type === "communities" ? limit : SEARCH_LIMIT_ALL,
          include: {
            owner: { select: { id: true, username: true } },
            _count: { select: { members: true, posts: true } },
          },
        });
      }

      if (!type || type === "channels" || type === "all") {
        results.channels = await prisma.channel.findMany({
          where: {
            OR: [
              { name: { contains: query } },
              { description: { contains: query } },
            ],
          },
          take: type === "channels" ? limit : SEARCH_LIMIT_ALL,
          include: {
            owner: { select: { id: true, username: true } },
            _count: { select: { members: true } },
          },
        });
      }

      if (!type || type === "streams" || type === "all") {
        results.streams = await prisma.liveStream.findMany({
          where: {
            active: true,
            OR: [
              { title: { contains: query } },
              { description: { contains: query } },
            ],
          },
          take: type === "streams" ? limit : SEARCH_LIMIT_ALL,
          include: {
            host: { select: { id: true, username: true, avatar: true } },
            category: { select: { name: true } },
          },
        });
      }

      if (!type || type === "videos" || type === "all") {
        results.videos = await prisma.video.findMany({
          where: {
            OR: [
              { title: { contains: query } },
              { description: { contains: query } },
            ],
          },
          orderBy: { views: "desc" },
          take: type === "videos" ? limit : SEARCH_LIMIT_ALL,
          include: {
            creator: { select: { id: true, username: true, avatar: true } },
            _count: { select: { likes: true, comments: true } },
          },
        });
      }

      return results;
    }, SEARCH_RESULTS_CACHE_TTL);
  }

  async getSuggestions(limit: number = 10) {
    return cacheService.getOrSet(CACHE_KEYS.SEARCH_SUGGESTIONS, async () => {
      const [users, streams, communities] = await Promise.all([
        prisma.user.findMany({
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
            verified: true,
            _count: { select: { followers: true } },
          },
        }),
        prisma.liveStream.findMany({
          where: { active: true },
          orderBy: { viewerCount: "desc" },
          take: limit,
          include: {
            host: { select: { id: true, username: true, avatar: true } },
            category: { select: { name: true } },
          },
        }),
        prisma.community.findMany({
          orderBy: { createdAt: "desc" },
          take: limit,
          include: {
            _count: { select: { members: true } },
          },
        }),
      ]);

      return { users, streams, communities };
    }, CACHE_TTL.MEDIUM);
  }

  async getTrending(limit: number = 10) {
    return cacheService.getOrSet(CACHE_KEYS.TRENDING_SEARCHES, async () => {
      const [trendingPosts, trendingVideos, liveStreams] = await Promise.all([
        prisma.post.findMany({
          orderBy: { createdAt: "desc" },
          take: limit,
          include: {
            author: { select: { id: true, username: true, avatar: true } },
            _count: { select: { likes: true, comments: true } },
          },
        }),
        prisma.video.findMany({
          orderBy: { views: "desc" },
          take: limit,
          include: {
            creator: { select: { id: true, username: true, avatar: true } },
            _count: { select: { likes: true } },
          },
        }),
        prisma.liveStream.findMany({
          where: { active: true },
          orderBy: { viewerCount: "desc" },
          take: limit,
          include: {
            host: { select: { id: true, username: true, avatar: true } },
          },
        }),
      ]);

      return { posts: trendingPosts, videos: trendingVideos, liveStreams };
    }, CACHE_TTL.MEDIUM);
  }
}

export const searchService = new SearchService();