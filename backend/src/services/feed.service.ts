import { prisma } from "../prisma";
import { cacheService, CACHE_KEYS, CACHE_TTL } from "./cache.service";
import { dbPerformanceTracker } from "./monitoring.service";
import { emitSocialEvent } from "./social-events.service";
import { notificationService } from "./notification.service";

const WITH_AUTHOR = {
  author: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
} as const;

const COMMENT_USER = { id: true, username: true, fullName: true, avatar: true, verified: true, role: true } as const;
const COMMENT_MAX_LENGTH = 2000;
const COMMENT_FLOOD_WINDOW_MS = 15_000;

const normalizeComment = (content: string) => content.replace(/\s+/g, " ").trim();
const mentionNames = (content: string) => Array.from(new Set(Array.from(content.matchAll(/(?:^|\s)@([a-zA-Z0-9_]{2,30})\b/g), match => match[1].toLowerCase())));

const formatComment = (comment: any) => ({
  ...comment,
  liked: Array.isArray(comment.likes) ? comment.likes.length > 0 : Boolean(comment.liked),
  likes: undefined,
  edited: new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000,
});

export class FeedService {
  async getFeed(userId: string, cursor?: string, limit: number = 20) {
    const cacheKey = CACHE_KEYS.FEED(userId, cursor);
    
    return cacheService.getOrSet(cacheKey, async () => {
      const queryStart = Date.now();
      
      const following = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });

      const followedUserIds = following.map(f => f.followingId);
      const followingIds = [...followedUserIds, userId];

      const posts = await prisma.post.findMany({
        where: { authorId: { in: followingIds } },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          ...WITH_AUTHOR,
          likes: {
            where: { userId },
            select: { id: true },
          },
          _count: { select: { likes: true, comments: true } },
        },
      });

      dbPerformanceTracker.trackQuery('Post', Date.now() - queryStart, 'findMany');

      const nextCursor = posts.length > limit ? posts.pop()?.id : undefined;

      return {
        items: posts.map(post => ({
          ...post,
          isLiked: post.likes.length > 0,
          likes: undefined,
          likesCount: (post as any)._count.likes,
          commentsCount: (post as any)._count.comments,
        })),
        nextCursor,
      };
    }, CACHE_TTL.SHORT);
  }

  /**
   * Get the home feed - a TikTok-style mixed feed combining:
   * 1. Live streams from followed creators
   * 2. Trending videos/reels
   * 3. Recommended videos
   * 4. Posts from followed creators
   * 5. Trending posts
   * 6. Suggested creators
   * 7. Community content
   * 8. Ads (occasionally, clearly labeled)
   */
  async getHomeFeed(userId: string, cursor?: string, limit: number = 15) {
    const cacheKey = CACHE_KEYS.HOME_FEED(userId, cursor);
    
    return cacheService.getOrSet(cacheKey, async () => {
      const queryStart = Date.now();

      // Get followed users
      const following = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      const followedUserIds = following.map(f => f.followingId);
      const followingIds = [...followedUserIds, userId];

      // 1. Live streams from followed creators (priority)
      const followedStreams = followingIds.length > 1
        ? await prisma.liveStream.findMany({
            where: {
              hostId: { in: followingIds.filter(id => id !== userId) },
              active: true,
              status: 'LIVE',
            },
            orderBy: { viewerCount: 'desc' },
            take: 3,
            include: {
              host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
              category: { select: { name: true } },
              _count: { select: { viewers: true, giftEvents: true } },
            },
          })
        : [];

      // 2. Trending videos/reels (global popularity)
      const trendingVideos = await prisma.video.findMany({
        orderBy: [{ views: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        include: {
          creator: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
          _count: { select: { likes: true, comments: true } },
        },
      });

      // 3. Posts from followed creators (most recent)
      const followedPosts = await prisma.post.findMany({
        where: { authorId: { in: followingIds } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          ...WITH_AUTHOR,
          likes: { where: { userId }, select: { id: true } },
          saves: { where: { userId }, select: { id: true } },
          _count: { select: { likes: true, comments: true } },
        },
      });

      // 4. Trending posts (global)
      const trendingPosts = await prisma.post.findMany({
        where: { authorId: { notIn: followingIds } },
        orderBy: [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }],
        take: 5,
        include: {
          ...WITH_AUTHOR,
          likes: { where: { userId }, select: { id: true } },
          saves: { where: { userId }, select: { id: true } },
          _count: { select: { likes: true, comments: true } },
        },
      });

      // 5. Community posts
      const communityPosts = await prisma.communityPost.findMany({
        orderBy: { createdAt: 'desc' },
        take: 4,
        include: {
          author: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
          community: { select: { id: true, name: true, avatar: true } },
        },
      });

      // 6. Other live streams (worldwide)
      const otherStreams = await prisma.liveStream.findMany({
        where: {
          active: true,
          status: 'LIVE',
          hostId: { notIn: followingIds.filter(id => id !== userId) },
        },
        orderBy: { viewerCount: 'desc' },
        take: 4,
        include: {
          host: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
          category: { select: { name: true } },
          _count: { select: { viewers: true, giftEvents: true } },
        },
      });

      // 7. Suggested creators
      const suggestedCreators = await prisma.user.findMany({
        where: {
          id: { notIn: followingIds },
          status: 'ACTIVE',
          verified: true,
        },
        orderBy: [{ followers: { _count: 'desc' } }, { createdAt: 'desc' }],
        take: 3,
        select: {
          id: true,
          username: true,
          fullName: true,
          avatar: true,
          verified: true,
          bio: true,
          _count: { select: { followers: true, posts: true } },
        },
      });

      dbPerformanceTracker.trackQuery('HomeFeed', Date.now() - queryStart, 'findMany');

      // Build the mixed feed with priority ordering
      const items: any[] = [];
      
      // Step 1: Followed live streams (highest priority)
      followedStreams.forEach((stream: any) => {
        items.push({ ...this.formatLiveStream(stream, 'following'), following: true });
      });

      // Step 2: Interleave trending videos, followed posts, trending posts
      const mixOrder = ['video', 'post', 'video', 'post', 'video', 'video', 'post', 'video'];
      
      const videoQueue = [...trendingVideos];
      const followedPostQueue = followedPosts.map(p => ({ ...this.formatPost(p, userId), following: p.authorId !== userId }));
      const trendingPostQueue = trendingPosts.filter((p: any) => !followedPostQueue.some((fp: any) => fp.id === p.id)).map(p => ({ ...this.formatPost(p, userId), following: false }));

      // Interleave followed posts and videos first
      for (const type of mixOrder) {
        if (type === 'video' && videoQueue.length > 0) {
          const video = videoQueue.shift();
          items.push({ ...this.formatVideo(video, 'recommended'), following: followedUserIds.includes(video.creatorId) });
        } else if (type === 'post') {
          if (followedPostQueue.length > 0) {
            items.push(followedPostQueue.shift());
          } else if (trendingPostQueue.length > 0) {
            items.push(trendingPostQueue.shift());
          }
        }
      }

      // Step 3: Add remaining videos
      while (videoQueue.length > 0) {
        const video = videoQueue.shift();
        items.push({ ...this.formatVideo(video, 'recommended'), following: followedUserIds.includes(video.creatorId) });
      }

      // Step 4: Add remaining followed/trending posts
      while (followedPostQueue.length > 0) {
        items.push(followedPostQueue.shift());
      }
      while (trendingPostQueue.length > 0) {
        items.push(trendingPostQueue.shift());
      }

      // Step 5: Community content
      communityPosts.forEach((post: any) => {
        items.push({
          id: `community-${post.id}`,
          type: 'community',
          content: post.content,
          media: post.mediaUrl,
          author: {
            id: post.authorId,
            username: post.author.username,
            fullName: post.author.fullName || post.author.username,
            avatar: post.author.avatar,
            verified: post.author.verified,
          },
          community: post.community,
          likes: 0,
          comments: 0,
          shares: 0,
          createdAt: post.createdAt,
          liked: false,
          saved: false,
        });
      });

      // Step 6: Other live streams
      otherStreams.forEach((stream: any) => {
        items.push({ ...this.formatLiveStream(stream, 'live'), following: followedUserIds.includes(stream.hostId) });
      });

      // Step 7: Suggested creators as cards
      suggestedCreators.forEach((creator: any) => {
        items.push({
          id: `creator-${creator.id}`,
          type: 'suggested_creator',
          author: {
            id: creator.id,
            username: creator.username,
            fullName: creator.fullName || creator.username,
            avatar: creator.avatar,
            verified: creator.verified,
            bio: creator.bio,
          },
          followers: creator._count?.followers || 0,
          posts: creator._count?.posts || 0,
          likes: 0,
          comments: 0,
          shares: 0,
          createdAt: new Date().toISOString(),
          liked: false,
          saved: false,
          following: false,
        });
      });

      // Apply cursor pagination (skip already seen items)
      const seenIds = new Set<string>();
      let filtered = items;
      
      // If we have a cursor, find the starting point
      if (cursor) {
        const cursorIndex = items.findIndex((item: any) => item.id === cursor);
        if (cursorIndex >= 0) {
          filtered = items.slice(cursorIndex + 1);
        } else {
          // Cursor not found in this batch - use a simple page approach
          filtered = items.slice(0, limit);
        }
      }

      // Deduplicate by id
      const uniqueItems = filtered.filter((item: any) => {
        if (seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
      });

      // Apply limit
      const pageItems = uniqueItems.slice(0, limit);
      const nextCursor = uniqueItems.length > limit ? pageItems[pageItems.length - 1]?.id : undefined;

      return {
        items: pageItems,
        nextCursor,
      };
    }, CACHE_TTL.SHORT);
  }

  private formatPost(post: any, userId: string) {
    return {
      id: post.id,
      type: post.mediaUrl ? (post.mediaUrl.includes('.mp4') || post.mediaUrl.includes('.webm') ? 'video' : 'post') : 'post',
      content: post.content,
      media: post.mediaUrl,
      author: {
        id: post.author?.id || post.authorId,
        username: post.author?.username,
        fullName: post.author?.fullName || post.author?.username,
        avatar: post.author?.avatar,
        verified: post.author?.verified,
      },
      likes: post._count?.likes || 0,
      comments: post._count?.comments || 0,
      shares: post.shareCount || 0,
      createdAt: post.createdAt,
      liked: post.likes?.length > 0 || post.isLiked || false,
      saved: post.saves?.length > 0 || post.isSaved || false,
      following: post.authorId === userId ? false : Boolean(post.following),
    };
  }

  private formatVideo(video: any, source: string) {
    return {
      id: `video-${video.id}`,
      type: 'reel',
      content: video.description || video.title || '',
      media: video.videoUrl,
      thumbnail: video.thumbnailUrl,
      duration: video.duration,
      author: {
        id: video.creator?.id || video.creatorId,
        username: video.creator?.username,
        fullName: video.creator?.fullName || video.creator?.username,
        avatar: video.creator?.avatar,
        verified: video.creator?.verified,
      },
      likes: video._count?.likes || 0,
      comments: video._count?.comments || 0,
      shares: 0,
      views: video.views || 0,
      createdAt: video.createdAt,
      liked: false,
      saved: false,
      source,
    };
  }

  private formatLiveStream(stream: any, source: string) {
    return {
      id: `live-${stream.id}`,
      type: 'live',
      content: stream.title || '',
      description: stream.description,
      thumbnail: stream.thumbnailUrl,
      playbackUrl: stream.playbackUrl,
      liveKitRoom: stream.liveKitRoom,
      viewerCount: stream.viewerCount || 0,
      author: {
        id: stream.host?.id || stream.hostId,
        username: stream.host?.username,
        fullName: stream.host?.fullName || stream.host?.username,
        avatar: stream.host?.avatar,
        verified: stream.host?.verified,
      },
      category: stream.category?.name,
      likes: stream.likes || 0,
      comments: 0,
      shares: 0,
      gifts: stream._count?.giftEvents || 0,
      createdAt: stream.createdAt,
      liked: false,
      saved: false,
      source,
    };
  }

  async getTrendingFeed(cursor?: string, limit: number = 20) {
    return cacheService.getOrSet(CACHE_KEYS.TRENDING, async () => {
      const queryStart = Date.now();
      
      const posts = await prisma.post.findMany({
        orderBy: [
          { likes: { _count: "desc" } },
          { createdAt: "desc" },
        ],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          ...WITH_AUTHOR,
          _count: { select: { likes: true, comments: true } },
        },
      });

      dbPerformanceTracker.trackQuery('Post', Date.now() - queryStart, 'findManyTrending');

      const nextCursor = posts.length > limit ? posts.pop()?.id : undefined;
      return { items: posts, nextCursor };
    }, CACHE_TTL.MEDIUM);
  }

  async getExploreFeed(cursor?: string, limit: number = 30) {
    return cacheService.getOrSet(CACHE_KEYS.EXPLORE, async () => {
      const queryStart = Date.now();
      
      const [posts, streams, videos] = await Promise.all([
        prisma.post.findMany({
          orderBy: { createdAt: "desc" },
          take: limit,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            ...WITH_AUTHOR,
            _count: { select: { likes: true, comments: true } },
          },
        }),
        prisma.liveStream.findMany({
          where: { active: true },
          orderBy: { viewerCount: "desc" },
          take: 10,
          include: {
            host: { select: { id: true, username: true, avatar: true } },
            category: { select: { name: true } },
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
      ]);

      dbPerformanceTracker.trackQuery('Explore', Date.now() - queryStart, 'findMany');

      return { posts, streams, videos };
    }, CACHE_TTL.MEDIUM);
  }

  async createPost(authorId: string, content: string, mediaUrl?: string) {
    const post = await prisma.post.create({
      data: { authorId, content, mediaUrl },
      include: WITH_AUTHOR,
    });
    
    // Invalidate feed caches after new post
    await cacheService.delPattern(`feed:${authorId}:*`);
    await cacheService.delPattern(`homefeed:*`);
    await cacheService.del(CACHE_KEYS.TRENDING);
    await cacheService.del(CACHE_KEYS.EXPLORE);
    
    return post;
  }

  async deletePost(postId: string, userId: string) {
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new Error("Post not found");
    if (post.authorId !== userId) throw new Error("Unauthorized");

    await prisma.post.delete({ where: { id: postId } });
    
    // Invalidate caches
    await cacheService.delPattern(`feed:${userId}:*`);
    await cacheService.delPattern(`homefeed:*`);
    await cacheService.del(CACHE_KEYS.TRENDING);
    await cacheService.del(CACHE_KEYS.EXPLORE);
    
    return { success: true };
  }

  async likePost(postId: string, userId: string) {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } });
    if (!post) throw new Error("Post not found");

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.postLike.findUnique({ where: { userId_postId: { userId, postId } } });
      if (existing) await tx.postLike.delete({ where: { id: existing.id } });
      else await tx.postLike.create({ data: { userId, postId } });
      const likeCount = await tx.postLike.count({ where: { postId } });
      const authorLikes = await tx.postLike.count({ where: { post: { authorId: post.authorId } } });
      await tx.interactionEvent.create({ data: { userId, eventType: existing ? "POST_UNLIKE" : "POST_LIKE", targetType: "POST", targetId: postId } });
      return { liked: !existing, likeCount, authorLikes, authorId: post.authorId };
    });

    // Invalidate feed caches as likes changed
    await cacheService.delPattern(`feed:*`);
    await cacheService.delPattern(`homefeed:*`);
    await cacheService.del(CACHE_KEYS.TRENDING);
    
    emitSocialEvent("social:post-updated", { postId, likes: result.likeCount, likedBy: userId, liked: result.liked, authorId: result.authorId, authorLikes: result.authorLikes });
    if (result.liked && post.authorId !== userId) {
      const actor = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      if (actor) void notificationService.notifyLike(post.authorId, actor.username, postId, userId);
    }
    return result;
  }

  async commentOnPost(postId: string, userId: string, content: string, parentId?: string) {
    const cleanContent = normalizeComment(content);
    if (!cleanContent || cleanContent.length > COMMENT_MAX_LENGTH) throw new Error(`Comments must be between 1 and ${COMMENT_MAX_LENGTH} characters`);

    const [post, actor, recent, parent] = await Promise.all([
      prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { username: true, status: true } }),
      prisma.postComment.findFirst({ where: { userId, postId }, orderBy: { createdAt: "desc" }, select: { content: true, createdAt: true } }),
      parentId ? prisma.postComment.findFirst({ where: { id: parentId, postId }, select: { id: true, userId: true } }) : Promise.resolve(null),
    ]);
    if (!post) throw new Error("Post not found");
    if (!actor || actor.status !== "ACTIVE") throw new Error("Commenting is unavailable for this account");
    if (parentId && !parent) throw new Error("Parent comment not found");
    if (recent && Date.now() - recent.createdAt.getTime() < COMMENT_FLOOD_WINDOW_MS && normalizeComment(recent.content).toLowerCase() === cleanContent.toLowerCase()) {
      throw new Error("Duplicate comment detected. Please wait before posting it again");
    }

    const mentionedUsers = mentionNames(cleanContent).length ? await prisma.user.findMany({
      where: { username: { in: mentionNames(cleanContent) }, status: "ACTIVE" },
      select: { id: true, username: true },
    }) : [];

    const comment = await prisma.$transaction(async tx => {
      const created = await tx.postComment.create({
        data: { postId, userId, content: cleanContent, parentId },
        include: { user: { select: COMMENT_USER }, _count: { select: { likes: true, replies: true } } },
      });
      await tx.interactionEvent.create({ data: {
        userId, eventType: parentId ? "comment.reply" : "comment.created", targetType: "POST", targetId: postId,
        metadata: JSON.stringify({ commentId: created.id, parentId: parentId || null, mentions: mentionedUsers.map(user => user.id) }),
      }});
      await tx.securityLog.create({ data: { userId, action: parentId ? "COMMENT_REPLY_CREATED" : "COMMENT_CREATED", metadata: JSON.stringify({ postId, commentId: created.id }) } });
      return created;
    });
    
    await cacheService.delPattern(`feed:*`);
    await cacheService.delPattern(`homefeed:*`);
    const commentCount = await prisma.postComment.count({ where: { postId } });
    const enriched = formatComment({ ...comment, liked: false });
    emitSocialEvent("social:comment-created", { postId, comment: enriched, commentCount });

    const notifications: Promise<unknown>[] = [];
    if (parent && parent.userId !== userId) notifications.push(notificationService.createNotification(parent.userId, "comment", "New reply", `@${actor.username} replied to your comment`, { actorId: userId, postId, commentId: comment.id, parentId, entityType: "comment", entityId: comment.id, referenceKey: `reply:${comment.id}` }));
    else if (post.authorId !== userId) notifications.push(notificationService.notifyComment(post.authorId, actor.username, postId, cleanContent, userId, comment.id));
    for (const mentioned of mentionedUsers) if (mentioned.id !== userId && mentioned.id !== parent?.userId && mentioned.id !== post.authorId) {
      notifications.push(notificationService.createNotification(mentioned.id, "mention", "You were mentioned", `@${actor.username} mentioned you in a comment`, { actorId: userId, postId, commentId: comment.id, entityType: "comment", entityId: comment.id, referenceKey: `mention:${comment.id}:${mentioned.id}` }));
    }
    void Promise.allSettled(notifications);
    return { comment: enriched, commentCount };
  }

  async getPostComments(postId: string, userId: string, cursor?: string, limit: number = 20, sort: "newest" | "top" = "newest", search?: string) {
    const blocked = await prisma.blockedUser.findMany({ where: { OR: [{ userId }, { targetId: userId }] }, select: { userId: true, targetId: true } });
    const excludedUsers = blocked.map(entry => entry.userId === userId ? entry.targetId : entry.userId);
    const comments = await prisma.postComment.findMany({
      where: { postId, parentId: null, userId: { notIn: excludedUsers }, ...(search ? { content: { contains: search } } : {}) },
      orderBy: sort === "top" ? [{ likes: { _count: "desc" } }, { createdAt: "desc" }] : { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: { select: COMMENT_USER },
        likes: { where: { userId }, select: { id: true } },
        replies: {
          orderBy: { createdAt: "asc" },
          take: 3,
          include: {
            user: { select: COMMENT_USER },
            likes: { where: { userId }, select: { id: true } },
            _count: { select: { likes: true, replies: true } },
          },
        },
        _count: { select: { likes: true, replies: true } },
      },
    });

    const hasMore = comments.length > limit;
    if (hasMore) comments.pop();
    const nextCursor = hasMore ? comments[comments.length - 1]?.id : undefined;
    return { items: comments.map((comment: any) => ({ ...formatComment(comment), replies: comment.replies.map(formatComment) })), nextCursor };
  }

  async getCommentReplies(postId: string, commentId: string, userId: string, cursor?: string, limit = 20) {
    const parent = await prisma.postComment.findFirst({ where: { id: commentId, postId }, select: { id: true } });
    if (!parent) throw new Error("Comment not found");
    const blocked = await prisma.blockedUser.findMany({ where: { OR: [{ userId }, { targetId: userId }] }, select: { userId: true, targetId: true } });
    const excludedUsers = blocked.map(entry => entry.userId === userId ? entry.targetId : entry.userId);
    const replies = await prisma.postComment.findMany({
      where: { postId, parentId: commentId, userId: { notIn: excludedUsers } }, orderBy: { createdAt: "asc" }, take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { user: { select: COMMENT_USER }, likes: { where: { userId }, select: { id: true } }, _count: { select: { likes: true, replies: true } } },
    });
    const hasMore = replies.length > limit;
    if (hasMore) replies.pop();
    const nextCursor = hasMore ? replies[replies.length - 1]?.id : undefined;
    return { items: replies.map(formatComment), nextCursor };
  }

  async updateComment(commentId: string, userId: string, content: string) {
    const existing = await prisma.postComment.findUnique({ where: { id: commentId } });
    if (!existing) throw new Error("Comment not found");
    if (existing.userId !== userId) throw new Error("Unauthorized");
    const cleanContent = normalizeComment(content);
    if (!cleanContent || cleanContent.length > COMMENT_MAX_LENGTH) throw new Error(`Comments must be between 1 and ${COMMENT_MAX_LENGTH} characters`);
    const comment = await prisma.postComment.update({ where: { id: commentId }, data: { content: cleanContent }, include: { user: { select: COMMENT_USER }, _count: { select: { likes: true, replies: true } } } });
    await prisma.securityLog.create({ data: { userId, action: "COMMENT_UPDATED", metadata: JSON.stringify({ commentId, postId: existing.postId }) } });
    emitSocialEvent("social:comment-updated", { postId: existing.postId, comment });
    return formatComment(comment);
  }

  async deleteComment(commentId: string, userId: string, role = "USER") {
    const existing = await prisma.postComment.findUnique({ where: { id: commentId } });
    if (!existing) throw new Error("Comment not found");
    if (existing.userId !== userId && !["ADMIN", "MODERATOR"].includes(role)) throw new Error("Unauthorized");
    await prisma.$transaction([
      prisma.postComment.delete({ where: { id: commentId } }),
      prisma.securityLog.create({ data: { userId, action: "COMMENT_DELETED", metadata: JSON.stringify({ commentId, postId: existing.postId }) } }),
    ]);
    const commentCount = await prisma.postComment.count({ where: { postId: existing.postId } });
    emitSocialEvent("social:comment-deleted", { postId: existing.postId, commentId, commentCount });
    return { deleted: true, commentCount };
  }

  async likeComment(commentId: string, userId: string) {
    const comment = await prisma.postComment.findUnique({ where: { id: commentId }, select: { postId: true, userId: true } });
    if (!comment) throw new Error("Comment not found");
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.postCommentLike.findUnique({ where: { userId_commentId: { userId, commentId } } });
      if (existing) await tx.postCommentLike.delete({ where: { id: existing.id } });
      else await tx.postCommentLike.create({ data: { userId, commentId } });
      return { liked: !existing, likeCount: await tx.postCommentLike.count({ where: { commentId } }) };
    });
    emitSocialEvent("social:comment-liked", { postId: comment.postId, commentId, ...result });
    if (result.liked && comment.userId !== userId) {
      const actor = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      if (actor) void notificationService.createNotification(comment.userId, "like", "Comment liked", `@${actor.username} liked your comment`, { postId: comment.postId, commentId });
    }
    return result;
  }

  async reportComment(commentId: string, userId: string, reason: string, description?: string) {
    const comment = await prisma.postComment.findUnique({ where: { id: commentId }, select: { userId: true, postId: true } });
    if (!comment) throw new Error("Comment not found");
    if (comment.userId === userId) throw new Error("You cannot report your own comment");
    const report = await prisma.$transaction(async tx => {
      const created = await tx.report.create({ data: { reporterId: userId, targetId: comment.userId, type: "COMMENT", reason, description: JSON.stringify({ commentId, postId: comment.postId, details: description || null }) } });
      await tx.moderationQueue.create({ data: { targetType: "COMMENT", targetId: commentId, reportedBy: userId, reason, priority: reason === "THREATS" ? 10 : 3 } });
      await tx.securityLog.create({ data: { userId, action: "COMMENT_REPORTED", metadata: JSON.stringify({ commentId, reportId: created.id }) } });
      return created;
    });
    return { reportId: report.id, status: report.status };
  }

  async getFollowers(userId: string, cursor?: string, limit: number = 20) {
    const followers = await prisma.follow.findMany({
      where: { followingId: userId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        follower: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, bio: true } },
      },
    });

    const nextCursor = followers.length > limit ? followers.pop()?.id : undefined;
    return {
      items: followers.map(f => f.follower),
      nextCursor,
    };
  }

  async getFollowing(userId: string, cursor?: string, limit: number = 20) {
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        following: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, bio: true } },
      },
    });

    const nextCursor = following.length > limit ? following.pop()?.id : undefined;
    return {
      items: following.map(f => f.following),
      nextCursor,
    };
  }
}

export const feedService = new FeedService();