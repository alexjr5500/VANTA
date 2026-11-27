import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { emitSocialEvent } from './social-events.service';
import { notificationService } from './notification.service';
import { emailService } from './email.service';
import { AppError } from '../utils/api-error';
import { CryptoUtils } from '../security/crypto';
import { isBadgeRowActive, BADGE_USER_SELECT, enrichPublicUser } from './public-verification';

/**
 * Reject public-profile reads for restricted accounts. The account OWNER
 * always passes (their own suspended/banned view is handled by the dedicated
 * screens); every other viewer receives a typed 403 carrying a
 * machine-readable code so the UI renders the suspended/banned state instead
 * of the generic "private profile" message.
 */
export function assertProfileAccessible(user: { id: string; status?: string | null }, viewerId?: string): void {
  if (!user || viewerId === user.id) return;
  if (user.status === 'SUSPENDED') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended by VANTA moderation.');
  }
  if (user.status === 'BANNED') {
    throw new AppError(403, 'ACCOUNT_BANNED', 'This account has been banned from VANTA.');
  }
}

const ensureValidUrl = (value?: string) => {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return trimmed;
  } catch {
    throw new Error('Invalid URL format');
  }
};

const ensureUsernameSafe = (username?: string) => {
  if (!username) return;
  const trimmed = username.trim().toLowerCase();
  if (trimmed.length < 3) {
    throw new Error('Username must be at least 3 characters long');
  }
  if (trimmed.length > 30) {
    throw new Error('Username must be 30 characters or less');
  }
  if (!/^[a-z0-9_\.]+$/.test(trimmed)) {
    throw new Error('Username may only contain letters, numbers, underscores, and periods');
  }
  return trimmed;
};

const ensureValidEmail = (email?: string) => {
  if (!email) return;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error('Invalid email address');
  }
  return trimmed;
};

export class UserService {
  async getUserProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: {
          include: {
            socialLinks: true,
            media: { orderBy: { createdAt: 'desc' }, take: 12 },
          },
        },
        posts: {
          where: { moderationRemovedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: {
            likes: { select: { id: true } },
            comments: { select: { id: true } },
          },
        },
        _count: {
          select: {
            followers: true,
            following: true,
            posts: true,
          },
        },
        wallet: {
          select: {
            coinBalance: true,
            earningsBalance: true,
            lifetimeEarnings: true,
            totalGiftsReceived: true,
            totalGiftsSent: true,
          },
        },
        userPresence: {
          select: { isOnline: true, lastActive: true },
        },
        verificationBadge: {
          select: { badgeType: true, status: true, expiresAt: true },
        },
        creatorMembership: {
          select: { status: true, planId: true },
        },
        loyaltyLevel: {
          select: { level: true, xp: true, tier: true },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const badgeActive =
      user.verificationBadge?.status === 'ACTIVE' &&
      (!user.verificationBadge?.expiresAt || new Date(user.verificationBadge.expiresAt).getTime() > Date.now());

    // Get current live stream if any
    const currentStream = await prisma.liveStream.findFirst({
      where: { hostId: userId, active: true, status: 'LIVE', moderationRemovedAt: null },
      select: { id: true, title: true, viewerCount: true, thumbnailUrl: true, categoryName: true },
    });

    // Get total likes and comments
    const [totalLikes, totalComments, totalGifts, totalViews, totalStreams, visiblePostCount] = await Promise.all([
      prisma.postLike.count({ where: { post: { authorId: userId, moderationRemovedAt: null } } }),
      prisma.postComment.count({ where: { post: { authorId: userId, moderationRemovedAt: null } } }),
      prisma.giftTransaction.aggregate({ where: { receiverId: userId }, _sum: { amount: true } }),
      prisma.liveStream.aggregate({ where: { hostId: userId, moderationRemovedAt: null }, _sum: { totalViewers: true } }),
      prisma.liveStream.count({ where: { hostId: userId, moderationRemovedAt: null } }),
      prisma.post.count({ where: { authorId: userId, moderationRemovedAt: null } }),
    ]);

    const profile = user.profile;
    const languages = profile?.languages ? JSON.parse(profile.languages) : [];
    const featuredContent = profile?.featuredContent ? JSON.parse(profile.featuredContent) : [];

    return {
      id: user.id,
      email: user.email || null,
      username: user.username,
      fullName: user.fullName,
      dateOfBirth: user.dateOfBirth,
      avatarUrl: profile?.avatarUrl || user.avatar || null,
      bannerUrl: profile?.bannerUrl || null,
      bio: profile?.bio || user.bio || null,
      website: profile?.website || null,
      country: profile?.country || null,
      city: profile?.city || null,
      interests: profile?.interests || null,
      verified: badgeActive || (Boolean(user.verified) && !user.verificationBadge),
      verificationType: badgeActive
        ? user.verificationBadge!.badgeType
        : Boolean(user.verified) && !user.verificationBadge ? 'GOLD' : null,
      premium: user.premium,
      // Creator Hub fields
      creatorCategory: profile?.creatorCategory || null,
      occupation: profile?.occupation || null,
      languages: languages,
      pronouns: profile?.pronouns || null,
      businessEmail: profile?.businessEmail || null,
      theme: profile?.theme || null,
      featuredContent: featuredContent,
      socialLinks: profile?.socialLinks || [],
      media: profile?.media || [],
      profile: profile,
      // Online status
      isOnline: user.userPresence?.isOnline || false,
      lastActive: user.userPresence?.lastActive || null,
      // Verification (paid badge is ACTIVE + unexpired; explicit BLUE/GOLD type)
      verificationType: badgeActive
        ? user.verificationBadge.badgeType === 'BLUE'
          ? 'BLUE'
          : 'GOLD'
        : (user.verified ? 'GOLD' : null),
      verificationStatus: user.verificationBadge?.status || null,
      verificationExpiryDate: badgeActive
        ? user.verificationBadge?.expiresAt?.toISOString?.() || null
        : null,
      // Creator membership
      creatorMembership: user.creatorMembership?.status || null,
      // Loyalty / Creator Score
      loyaltyLevel: user.loyaltyLevel?.level || 1,
      loyaltyTier: user.loyaltyLevel?.tier || 'BRONZE',
      loyaltyXp: user.loyaltyLevel?.xp || 0,
      // Current live stream
      currentStream: currentStream,
      // Counts
      counts: {
        followers: user._count.followers,
        following: user._count.following,
        posts: visiblePostCount,
        media: profile?.media.length || 0,
      },
      // Aggregated stats
      stats: {
        totalLikes: totalLikes,
        totalComments: totalComments,
        totalGifts: totalGifts._sum.amount || 0,
        totalViews: totalViews._sum.totalViewers || 0,
        totalStreams: totalStreams,
        totalPosts: visiblePostCount,
        totalFollowers: user._count.followers,
        totalFollowing: user._count.following,
      },
      // Wallet info
      wallet: {
        coinBalance: user.wallet?.coinBalance || 0,
        earningsBalance: user.wallet?.earningsBalance || 0,
        lifetimeEarnings: user.wallet?.lifetimeEarnings || 0,
        totalGiftsReceived: user.wallet?.totalGiftsReceived || 0,
      },
      latestPosts: user.posts.map((post: any) => ({
        id: post.id,
        content: post.content,
        mediaUrl: post.mediaUrl,
        pinned: post.pinned,
        createdAt: post.createdAt,
        likes: post.likes.length,
        comments: post.comments.length,
      })),
      joinedAt: user.createdAt,
    };
  }

  /**
   * Enforce the account-privacy rule for a target profile. Viewing a private
   * account is allowed only to the owner and to accounts the owner follows.
   * All other viewers are rejected at the service layer so alternate/malicious
   * clients cannot read a private profile.
   */
  async canViewProfile(targetUserId: string, viewerId?: string): Promise<boolean> {
    if (viewerId && viewerId === targetUserId) return true;
    const targetSettings = await prisma.userSettings.findUnique({
      where: { userId: targetUserId },
      select: { privacyProfile: true },
    });
    if (targetSettings?.privacyProfile !== 'private') return true;
    if (!viewerId) return false;
    // The owner's followers can view the private profile.
    const following = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: viewerId,
          followingId: targetUserId,
        },
      },
    });
    return Boolean(following);
  }

  async getPublicProfileByUsername(username: string, currentUserId?: string) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        verificationBadge: { select: { badgeType: true, status: true, expiresAt: true } },
        profile: { include: { socialLinks: true, media: { orderBy: { createdAt: 'desc' }, take: 12 } } },
        _count: { select: { followers: true, following: true, posts: true } },
        posts: {
          where: { moderationRemovedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: { likes: { select: { id: true } }, comments: { select: { id: true } } },
        },
      },
    });

    if (!user) {
      throw new Error('Profile not found');
    }

    // A suspended or banned account no longer exposes a public profile. The
    // dedicated suspended/banned screens carry the proper message — the
    // generic "private profile" state must never be shown for these accounts.
    assertProfileAccessible(user, currentUserId);

    // Private accounts are only readable by the owner and the accounts the
    // owner follows. Enforced here (service layer) so an alternate client can
    // never read a private profile directly.
    if (!(await this.canViewProfile(user.id, currentUserId))) {
      throw new Error('This profile is private');
    }

    const [privacySettings, followRecord] = await Promise.all([
      currentUserId !== user.id
        ? prisma.userSettings.findUnique({
            where: { userId: user.id },
            select: { liveStreamVisibility: true, privacyLiveStream: true },
          })
        : Promise.resolve(null),
      currentUserId
        ? prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: currentUserId, followingId: user.id } },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const isFollowing = Boolean(followRecord);
    const visibilityValues = [privacySettings?.liveStreamVisibility, privacySettings?.privacyLiveStream]
      .filter(Boolean).map(value => String(value).toLowerCase());
    const canViewCurrentStream = currentUserId === user.id || (
      !visibilityValues.some(value => value === 'nobody' || value === 'noone') &&
      (!visibilityValues.some(value => value === 'followers' || value === 'following') || isFollowing)
    );
    const currentStream = canViewCurrentStream ? await prisma.liveStream.findFirst({
      where: { hostId: user.id, active: true, status: 'LIVE', moderationRemovedAt: null },
      select: { id: true, title: true, viewerCount: true, thumbnailUrl: true, categoryName: true },
    }) : null;

    const [totalLikes, totalComments, totalGifts, totalViews, totalStreams, visiblePostCount] = await Promise.all([
      prisma.postLike.count({ where: { post: { authorId: user.id, moderationRemovedAt: null } } }),
      prisma.postComment.count({ where: { post: { authorId: user.id, moderationRemovedAt: null } } }),
      prisma.giftTransaction.aggregate({ where: { receiverId: user.id }, _sum: { amount: true } }),
      prisma.liveStream.aggregate({ where: { hostId: user.id, moderationRemovedAt: null }, _sum: { totalViewers: true } }),
      prisma.liveStream.count({ where: { hostId: user.id, moderationRemovedAt: null } }),
      prisma.post.count({ where: { authorId: user.id, moderationRemovedAt: null } }),
    ]);

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      avatarUrl: user.profile?.avatarUrl || user.avatar || null,
      bannerUrl: user.profile?.bannerUrl || null,
      bio: user.profile?.bio || user.bio || null,
      website: user.profile?.website || null,
      country: user.profile?.country || null,
      city: user.profile?.city || null,
      interests: user.profile?.interests || null,
      verified: isBadgeRowActive(user.verificationBadge) || (Boolean(user.verified) && !user.verificationBadge),
      verificationType: isBadgeRowActive(user.verificationBadge)
        ? user.verificationBadge.badgeType
        : Boolean(user.verified) && !user.verificationBadge ? 'GOLD' : null,
      premium: user.premium,
      creatorCategory: user.profile?.creatorCategory || null,
      occupation: user.profile?.occupation || null,
      languages: user.profile?.languages ? JSON.parse(user.profile.languages) : [],
      pronouns: user.profile?.pronouns || null,
      theme: user.profile?.theme || null,
      featuredContent: user.profile?.featuredContent ? JSON.parse(user.profile.featuredContent) : [],
      socialLinks: user.profile?.socialLinks || [],
      media: user.profile?.media || [],
      currentStream,
      counts: {
        followers: user._count.followers,
        following: user._count.following,
        posts: visiblePostCount,
        media: user.profile?.media.length || 0,
      },
      stats: {
        totalLikes,
        totalComments,
        totalGifts: totalGifts._sum.amount || 0,
        totalViews: totalViews._sum.totalViewers || 0,
        totalStreams,
        totalPosts: visiblePostCount,
        totalFollowers: user._count.followers,
        totalFollowing: user._count.following,
      },
      latestPosts: user.posts.map((post: any) => ({
        id: post.id,
        content: post.content,
        mediaUrl: post.mediaUrl,
        pinned: post.pinned,
        createdAt: post.createdAt,
        likes: post.likes.length,
        comments: post.comments.length,
      })),
      isFollowing,
      joinedAt: user.createdAt,
    };
  }

  /**
   * Fetch a user's posts normalized to the exact same shape the Home feed
   * returns (`formatPost` in feed.service.ts). Rendering Profile, Likes and
   * Home through one shared post component (FeedPostCard) requires every source
   * to honour the same data contract:
   *
   *   { id, type, content, media, author:{id,username,fullName,avatar,verified},
   *     likes, comments, shares, createdAt, liked, saved, following }
   *
   * `viewerId` is the account whose like/save/follow state is reflected, so the
   * correct active states and counts are shown to whoever is looking.
   */
  async getUserPosts(userId: string, viewerId?: string, cursor?: string, limit: number = 10) {
    const posts = await prisma.post.findMany({
      where: { authorId: userId, moderationRemovedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
            verified: true,
            profile: { select: { avatarUrl: true } },
          },
        },
        likes: { where: { userId: viewerId }, select: { id: true } },
        saves: { where: { userId: viewerId }, select: { id: true } },
        _count: { select: { likes: true, comments: true } },
      },
    });

    const hasMore = posts.length > limit;
    const nextCursor = hasMore ? posts[limit - 1]?.id : undefined;
    if (hasMore) posts.pop();

    // Whether the viewer already follows the post author. This is the same
    // "following" flag Home's feed uses on the post header Follow button.
    let followsAuthor = false;
    if (viewerId && viewerId !== userId) {
      followsAuthor = Boolean(await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: viewerId, followingId: userId } },
        select: { id: true },
      }));
    }

    return {
      items: posts.map(({ author, ...post }: any) => this.serializePost(post, author, {
        viewerId,
        followsAuthor,
        liked: post.likes?.length > 0,
        saved: post.saves?.length > 0,
      })),
      nextCursor,
    };
  }

  /**
   * Serialize a raw Prisma post row into the Home feed `FeedItem` shape that the
   * shared FeedPostCard renders. Mirrors formatPost/formatVideo in feed.service.ts.
   */
  private serializePost(post: any, author: any, ctx: {
    viewerId?: string;
    followsAuthor?: boolean;
    liked?: boolean;
    saved?: boolean;
  } = {}) {
    return {
      id: post.id,
      type: post.mediaUrl
        ? (String(post.mediaUrl).includes('.mp4') || String(post.mediaUrl).includes('.webm') ? 'video' : 'post')
        : 'post',
      content: post.content,
      media: post.mediaUrl,
      author: {
        id: author?.id || post.authorId,
        username: author?.username,
        fullName: author?.fullName || author?.username,
        avatar: author?.profile?.avatarUrl || author?.avatar || null,
        verified: author?.verified,
      },
      likes: post._count?.likes || 0,
      comments: post._count?.comments || 0,
      shares: post.shareCount || 0,
      views: post.views ?? 0,
      createdAt: post.createdAt,
      liked: Boolean(ctx.liked),
      saved: Boolean(ctx.saved),
      following: ctx.viewerId && ctx.viewerId !== post.authorId ? Boolean(ctx.followsAuthor) : false,
    };
  }

  async getProfileMedia(userId: string, cursor?: string, limit: number = 12) {
    const profile = await prisma.profile.findUnique({ where: { userId } });
    const [cursorDateText, cursorId] = cursor?.includes('|') ? cursor.split('|', 2) : [];
    const cursorDate = cursorDateText ? new Date(cursorDateText) : undefined;
    const afterCursor = cursorDate && !Number.isNaN(cursorDate.getTime()) && cursorId
      ? { OR: [{ createdAt: { lt: cursorDate } }, { createdAt: cursorDate, id: { lt: cursorId } }] }
      : {};

    // "Media" includes both manually uploaded profile photos and media attached
    // to published posts. The old implementation only queried ProfileMedia,
    // which made images posted to the feed silently disappear from this tab.
    const [profileMedia, postMedia] = await Promise.all([
      profile
        ? prisma.profileMedia.findMany({
            where: { profileId: profile.id, ...afterCursor },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
          })
        : Promise.resolve([]),
      prisma.post.findMany({
        where: { authorId: userId, mediaUrl: { not: null }, moderationRemovedAt: null, ...afterCursor }, 
        select: { id: true, content: true, mediaUrl: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    ]);

    const items = [
      ...profileMedia.map((item: any) => ({
        ...item,
        source: 'profile-media',
        mediaUrl: item.url,
        type: String(item.type || 'IMAGE').toLowerCase() === 'video' ? 'video' : 'image',
      })),
      ...postMedia.map((item: any) => ({
        ...item,
        source: 'post-media',
        url: item.mediaUrl,
        type: /\\.(mp4|webm|mov|m4v|ogv|m3u8)(?:\\?.*)?$/i.test(String(item.mediaUrl || '')) ? 'video' : 'image',
      })),
    ].sort((a: any, b: any) => {
      const timeDifference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return timeDifference || String(b.id).localeCompare(String(a.id));
    });

    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? `${new Date(last.createdAt).toISOString()}|${last.id}`
      : undefined;
    return { items: page, nextCursor };
  }

  async getUserReplies(userId: string, cursor?: string, limit: number = 10) {
    const replies = await prisma.postComment.findMany({
      where: { userId, moderationRemovedAt: null, post: { moderationRemovedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        post: {
          select: {
            id: true,
            content: true,
            author: { select: { id: true, username: true, avatar: true } },
          },
        },
      },
    });
    const nextCursor = replies.length > limit ? replies.pop()?.id : undefined;
    return { items: replies, nextCursor };
  }

  async getUserLikes(userId: string, cursor?: string, limit: number = 10) {
    const likes = await prisma.postLike.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        post: {
          include: {
            author: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatar: true,
                verified: true,
                profile: { select: { avatarUrl: true } },
              },
            },
            likes: { where: { userId }, select: { id: true } },
            saves: { where: { userId }, select: { id: true } },
            _count: { select: { likes: true, comments: true } },
          },
        },
      },
    });
    const hasMore = likes.length > limit;
    const nextCursor = hasMore ? likes[limit - 1]?.id : undefined;
    if (hasMore) likes.pop();
    // Liked posts are the viewer's own likes, so every row is liked; follow state
    // of the post author is irrelevant here but serialized identically.
    return {
      items: likes.map((like: any) => this.serializePost(like.post, like.post?.author, {
        viewerId: userId,
        liked: true,
        saved: like.post?.saves?.length > 0,
      })),
      nextCursor,
    };
  }

  async getPublicUserPostsByUsername(username: string, viewerId?: string, cursor?: string, limit: number = 10) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new Error('Profile not found');
    }
    assertProfileAccessible(user, viewerId);
    if (!(await this.canViewProfile(user.id, viewerId))) {
      throw new Error('This profile is private');
    }
    return this.getUserPosts(user.id, viewerId, cursor, limit);
  }

  async getPublicUserMediaByUsername(username: string, cursor?: string, limit: number = 12, viewerId?: string) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new Error('Profile not found');
    }
    assertProfileAccessible(user, viewerId);
    if (!(await this.canViewProfile(user.id, viewerId))) {
      throw new Error('This profile is private');
    }
    return this.getProfileMedia(user.id, cursor, limit);
  }

  async updateProfile(userId: string, data: any) {
    const updates: any = {};
    const profileUpdates: any = {};

    if (data.fullName !== undefined) {
      const fullName = data.fullName?.trim();
      if (!fullName || fullName.length > 50) throw new Error('Display name must be between 1 and 50 characters');
      updates.fullName = fullName;
    }
    if (data.bio !== undefined) {
      const bio = data.bio.trim();
      if (bio.length > 260) throw new Error('Bio must be 260 characters or less');
      profileUpdates.bio = bio;
    }
    if (data.website !== undefined) {
      profileUpdates.website = ensureValidUrl(data.website);
    }
    if (data.city !== undefined) {
      const city = data.city?.trim() || null;
      if (city && city.length > 100) throw new Error('Location must be 100 characters or less');
      profileUpdates.city = city;
    }
    if (data.country !== undefined) profileUpdates.country = data.country?.trim() || null;
    if (data.interests !== undefined) profileUpdates.interests = data.interests?.trim() || null;
    // Profile media is only mutated by authenticated upload endpoints, where
    // file validation, storage, and ownership checks have already succeeded.
    if (data.occupation !== undefined) profileUpdates.occupation = data.occupation?.trim() || null;
    if (data.pronouns !== undefined) profileUpdates.pronouns = data.pronouns?.trim() || null;
    if (data.creatorCategory !== undefined) profileUpdates.creatorCategory = data.creatorCategory?.trim() || null;
    if (data.theme !== undefined) profileUpdates.theme = data.theme?.trim() || null;
    if (data.languages !== undefined) {
      if (!Array.isArray(data.languages) || !data.languages.every((language: unknown) => typeof language === 'string')) {
        throw new Error('Languages must be an array of language codes');
      }
      profileUpdates.languages = JSON.stringify(data.languages.map((language: string) => language.trim()).filter(Boolean));
    }

    if (data.username !== undefined) {
      const normalized = ensureUsernameSafe(data.username);
      if (normalized) {
        const existing = await prisma.user.findFirst({
          where: {
            username: normalized,
            NOT: { id: userId },
          },
        });
        if (existing) {
          throw new Error('Username already in use');
        }
        updates.username = normalized;
        profileUpdates.username = normalized;
      }
    }

    if (data.dateOfBirth !== undefined) {
      const value = data.dateOfBirth;
      if (value === null || value === '') updates.dateOfBirth = null;
      else {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date of birth must be a valid calendar date');
        const parsed = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value > new Date().toISOString().slice(0, 10)) throw new Error('Date of birth must be a valid date that is not in the future');
        updates.dateOfBirth = parsed;
      }
    }

    const existingUser = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!existingUser) throw new Error('User not found');

    const profileUsername = updates.username || existingUser.username;
    const profileFullName = updates.fullName ?? existingUser.fullName ?? undefined;

    const socialLinks = Array.isArray(data.socialLinks) ? data.socialLinks : undefined;
    if (socialLinks) {
      const validLinks = socialLinks
        .filter((link: any) => link?.platform && link?.url)
        .map((link: any) => ({ platform: link.platform.trim(), url: ensureValidUrl(link.url) }));
      profileUpdates.socialLinks = {
        create: validLinks,
      };
    }

    await prisma.$transaction(async tx => {
      if (socialLinks && existingUser.profile?.id) {
        await tx.socialLink.deleteMany({ where: { profileId: existingUser.profile.id } });
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          ...updates,
          bio: profileUpdates.bio ?? existingUser.bio,
        },
      });
      await tx.profile.upsert({
        where: { userId },
        create: {
          userId,
          username: profileUsername,
          fullName: profileFullName,
          ...profileUpdates,
        },
        update: {
          ...profileUpdates,
          fullName: profileFullName,
        },
      });
    });

    return this.getUserProfile(userId);
  }

  async updateProfileImage(userId: string, imageType: 'avatar' | 'banner', imageUrl: string) {
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('A stored image URL is required');
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    await prisma.$transaction(async tx => {
      if (imageType === 'avatar') {
        // User.avatar is consumed by posts, chat, comments, and notifications.
        // Keep it synchronized with the richer Profile record in one commit.
        await tx.user.update({ where: { id: userId }, data: { avatar: imageUrl } });
      }
      await tx.profile.upsert({
        where: { userId },
        create: {
          userId,
          username: user.username,
          fullName: user.fullName || undefined,
          ...(imageType === 'avatar' ? { avatarUrl: imageUrl } : { bannerUrl: imageUrl }),
        },
        update: imageType === 'avatar' ? { avatarUrl: imageUrl } : { bannerUrl: imageUrl },
      });
    });

    return this.getUserProfile(userId);
  }

  async getUserSettings(userId: string) {
    return prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
      },
      update: {},
    });
  }

  async updateUserSettings(userId: string, data: any) {
    const settings: any = {};

    if (data.theme !== undefined) {
      const theme = data.theme.trim().toLowerCase();
      if (!['dark', 'light'].includes(theme)) {
        throw new Error('Theme must be dark or light');
      }
      settings.theme = theme;
    }

    if (data.themeMode !== undefined) {
      const mode = data.themeMode.trim().toLowerCase();
      if (!['dark', 'light', 'system'].includes(mode)) {
        throw new Error('Theme mode must be dark, light, or system');
      }
      settings.themeMode = mode;
    }

    if (data.accent !== undefined) {
      const accent = data.accent.trim().toLowerCase();
      if (!['gold', 'monochrome'].includes(accent)) {
        throw new Error('Accent must be gold or monochrome');
      }
      settings.accent = accent;
    }

    if (data.density !== undefined) {
      const density = data.density.trim().toLowerCase();
      if (!['comfortable', 'compact'].includes(density)) {
        throw new Error('Density must be comfortable or compact');
      }
      settings.density = density;
    }

    if (data.language !== undefined) {
      const language = data.language.trim().toLowerCase();
      if (!language || language.length > 32) {
        throw new Error('Language must be a valid locale code');
      }
      settings.language = language;
    }

    for (const key of ['readReceipts', 'activityStatus', 'typingIndicators', 'messagePreviews', 'chatNotifications'] as const) {
      if (data[key] !== undefined) {
        settings[key] = Boolean(data[key]);
      }
    }

    if (data.privacyProfile !== undefined) {
      const value = data.privacyProfile.trim().toLowerCase();
      if (!['public', 'private'].includes(value)) {
        throw new Error('Profile privacy must be public or private');
      }
      settings.privacyProfile = value;
    }

    if (data.privacyMessages !== undefined) {
      const value = data.privacyMessages.trim().toLowerCase();
      if (!['everyone', 'following', 'followers', 'noone'].includes(value)) {
        throw new Error('Message privacy must be everyone, followers, following, or noone');
      }
      settings.privacyMessages = value;
    }

    if (data.privacyFollows !== undefined) {
      const value = data.privacyFollows.trim().toLowerCase();
      if (!['everyone', 'followers', 'noone'].includes(value)) {
        throw new Error('Follow privacy must be everyone, followers, or noone');
      }
      settings.privacyFollows = value;
    }

    return prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        ...settings,
      },
      update: {
        ...settings,
      },
    });
  }

  async getNotificationPreferences(userId: string) {
    return prisma.notificationPreferences.upsert({
      where: { userId },
      create: {
        userId,
      },
      update: {},
    });
  }

  async updateNotificationPreferences(userId: string, data: any) {
    const updates: any = {};
    if (data.emailAlerts !== undefined) updates.emailAlerts = Boolean(data.emailAlerts);
    if (data.pushAlerts !== undefined) updates.pushAlerts = Boolean(data.pushAlerts);
    if (data.chatAlerts !== undefined) updates.chatAlerts = Boolean(data.chatAlerts);
    if (data.liveAlerts !== undefined) updates.liveAlerts = Boolean(data.liveAlerts);
    if (data.followingOnlySocialAlerts !== undefined) {
      if (typeof data.followingOnlySocialAlerts !== 'boolean') throw new Error('Notification filter must be a boolean');
      updates.followingOnlySocialAlerts = data.followingOnlySocialAlerts;
    }
    for (const key of ['likesAlerts', 'commentsAlerts', 'mentionsAlerts', 'followersAlerts', 'groupAlerts', 'channelAlerts', 'liveInteractionsAlerts'] as const) {
      if (data[key] !== undefined) updates[key] = Boolean(data[key]);
    }

    return prisma.notificationPreferences.upsert({
      where: { userId },
      create: {
        userId,
        ...updates,
      },
      update: {
        ...updates,
      },
    });
  }

  private emailChangeCodeHash(userId: string, email: string, code: string): string {
    const pepper = process.env.EMAIL_CHANGE_CODE_SECRET || process.env.JWT_SECRET || '';
    if (pepper.length < 32) {
      throw new Error('Email verification is temporarily unavailable. Please contact support.');
    }
    return crypto.createHmac('sha256', pepper).update(`${userId}:${email}:${code}`).digest('hex');
  }

  async requestEmailChange(userId: string, email: string, currentPassword: string) {
    const normalized = ensureValidEmail(email);
    if (!normalized) throw new Error('A valid new email address is required');
    if (!currentPassword) throw new Error('Enter your current password to continue');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!user) throw new Error('Account not found');
    if (!user.passwordHash || !(await CryptoUtils.verifyPassword(user.passwordHash, currentPassword))) {
      throw new Error('Current password is incorrect');
    }
    if (normalized === (user.email || '').toLowerCase()) {
      throw new Error('That is already your current email address');
    }

    const existing = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (existing && existing.id !== userId) throw new Error('That email address is already in use');

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const codeHash = this.emailChangeCodeHash(userId, normalized, code);

    // Serialize per-account issuance before counting and inserting. The
    // transaction-scoped advisory lock closes the count-then-create race:
    // concurrent requests for this user cannot all pass the hourly limit.
    const request = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`;
      const recentRequests = await tx.emailChangeRequest.count({
        where: { userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      if (recentRequests >= 5) throw new Error('Too many email change attempts. Try again in an hour.');

      await tx.emailChangeRequest.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      return tx.emailChangeRequest.create({
        data: { userId, oldEmail: user.email, newEmail: normalized, codeHash, expiresAt },
      });
    });

    let delivery;
    try {
      delivery = await emailService.sendEmailChangeVerification({
        to: normalized,
        code,
        expiresInMinutes: 10,
      });
    } catch (error) {
      // A transport exception must not leave a live challenge whose code was
      // never delivered to the account owner.
      await prisma.emailChangeRequest.updateMany({
        where: { id: request.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      throw new Error('We could not send the verification email. Your current email address has not changed.');
    }
    if (!delivery.delivered) {
      await prisma.emailChangeRequest.updateMany({
        where: { id: request.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      throw new Error('We could not send the verification email. Your current email address has not changed.');
    }

    return { success: true, email: normalized, expiresInMinutes: 10 };
  }

  async verifyEmailChange(userId: string, code: string) {
    const normalizedCode = String(code || '').trim();
    if (!/^\d{6}$/.test(normalizedCode)) throw new Error('Enter the 6-digit verification code');

    const request = await prisma.emailChangeRequest.findFirst({
      where: { userId, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!request) throw new Error('No pending email change was found. Request a new code.');
    if (request.expiresAt.getTime() <= Date.now()) {
      await prisma.emailChangeRequest.update({ where: { id: request.id }, data: { usedAt: new Date() } });
      throw new Error('That verification code has expired. Request a new one.');
    }
    if (request.attempts >= 5) throw new Error('Too many incorrect codes. Request a new one.');

    const suppliedHash = this.emailChangeCodeHash(userId, request.newEmail, normalizedCode);
    const expected = Buffer.from(request.codeHash, 'hex');
    const supplied = Buffer.from(suppliedHash, 'hex');
    const valid = expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);

    if (!valid) {
      // Atomic increment prevents concurrent guesses from bypassing the limit.
      const incremented = await prisma.emailChangeRequest.updateMany({
        where: { id: request.id, userId, usedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
        data: { attempts: { increment: 1 } },
      });
      if (incremented.count !== 1) {
        throw new Error('This verification code has already been used, expired, or exhausted.');
      }
      const latest = await prisma.emailChangeRequest.findUnique({
        where: { id: request.id },
        select: { attempts: true },
      });
      const exhausted = (latest?.attempts || 0) >= 5;
      if (exhausted) {
        await prisma.emailChangeRequest.updateMany({
          where: { id: request.id, usedAt: null },
          data: { usedAt: new Date() },
        });
      }
      throw new Error(exhausted ? 'Too many incorrect codes. Request a new one.' : 'That verification code is incorrect.');
    }

    const now = new Date();
    const changed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.emailChangeRequest.updateMany({
        where: { id: request.id, userId, usedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new Error('This verification code has already been used or expired.');

      const collision = await tx.user.findFirst({
        where: { email: request.newEmail, NOT: { id: userId } },
        select: { id: true },
      });
      if (collision) throw new Error('That email address is already in use. Your current email remains unchanged.');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { email: request.newEmail, emailVerified: true },
        select: { id: true, email: true },
      });
      return updated;
    });

    if (request.oldEmail) {
      // The email update is committed before notification. A mail failure must
      // never make a successful change look unsuccessful or invite code replay.
      try {
        const notice = await emailService.sendEmailChangedNotice({
          to: request.oldEmail,
          newEmail: changed.email || request.newEmail,
        });
        if (!notice.delivered) {
          console.warn('[EMAIL_CHANGE] Security notice was not delivered to the previous address.');
        }
      } catch {
        console.warn('[EMAIL_CHANGE] Security notice delivery failed after the email change was committed.');
      }
    }
    return { success: true, email: changed.email };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }
    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new Error('Current password is incorrect');
    }
    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long');
    }
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { success: true };
  }

  async blockUser(userId: string, targetUsername: string) {
    const target = await prisma.user.findUnique({ where: { username: targetUsername } });
    if (!target) {
      throw new Error('Target user not found');
    }
    if (target.id === userId) {
      throw new Error('Cannot block yourself');
    }
    return prisma.blockedUser.upsert({
      where: {
        userId_targetId: {
          userId,
          targetId: target.id,
        },
      },
      create: {
        userId,
        targetId: target.id,
      },
      update: {},
    });
  }

  async unblockUser(userId: string, targetId: string) {
    await prisma.blockedUser.deleteMany({ where: { userId, targetId } });
    return { success: true };
  }

  async getBlockedUsers(userId: string) {
    return prisma.blockedUser.findMany({
      where: { userId },
      include: { target: { select: { id: true, username: true } } },
    });
  }

  async muteUser(userId: string, targetUsername: string) {
    const target = await prisma.user.findUnique({ where: { username: targetUsername } });
    if (!target) {
      throw new Error('Target user not found');
    }
    if (target.id === userId) {
      throw new Error('Cannot mute yourself');
    }
    return prisma.mutedUser.upsert({
      where: {
        userId_targetId: {
          userId,
          targetId: target.id,
        },
      },
      create: {
        userId,
        targetId: target.id,
      },
      update: {},
    });
  }

  async unmuteUser(userId: string, targetId: string) {
    await prisma.mutedUser.deleteMany({ where: { userId, targetId } });
    return { success: true };
  }

  async getMutedUsers(userId: string) {
    return prisma.mutedUser.findMany({
      where: { userId },
      include: { target: { select: { id: true, username: true } } },
    });
  }

  async getSecurityLogs(userId: string) {
    return prisma.securityLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async addProfileMedia(userId: string, url: string, type: string, title?: string) {
    let profile = await prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new Error('User not found');
      }
      profile = await prisma.profile.create({
        data: {
          userId,
          username: user.username,
          fullName: user.fullName || undefined,
        },
      });
    }
    return prisma.profileMedia.create({
      data: {
        profileId: profile.id,
        url,
        type,
        title: title?.trim() || null,
      },
    });
  }

  private async getFollowRelationshipCounts(currentUserId: string, targetUserId: string) {
    const [
      targetFollowers,
      targetFollowing,
      currentUserFollowers,
      currentUserFollowing,
    ] = await Promise.all([
      prisma.follow.count({ where: { followingId: targetUserId } }),
      prisma.follow.count({ where: { followerId: targetUserId } }),
      prisma.follow.count({ where: { followingId: currentUserId } }),
      prisma.follow.count({ where: { followerId: currentUserId } }),
    ]);

    return {
      target: {
        followers: targetFollowers,
        following: targetFollowing,
      },
      currentUser: {
        followers: currentUserFollowers,
        following: currentUserFollowing,
      },
    };
  }

  async followUser(currentUserId: string, username: string) {
    const target = await prisma.user.findUnique({ where: { username } });
    if (!target) {
      throw new Error('Target user not found');
    }
    if (target.id === currentUserId) {
      throw new Error('Cannot follow yourself');
    }

    // Enforce the target's follow privacy setting server-side. A private
    // request from an unauthorized account must be rejected here — hiding the
    // follow button in the UI is never sufficient.
    const targetSettings = await prisma.userSettings.findUnique({
      where: { userId: target.id },
      select: { privacyFollows: true, privacyProfile: true },
    });
    const privacyFollows = targetSettings?.privacyFollows || 'everyone';
    if (privacyFollows !== 'everyone' && currentUserId !== target.id) {
      if (privacyFollows === 'noone') {
        throw new Error('This account does not accept new followers');
      }
      // 'followers' — only accounts the target already follows may follow back.
      const targetFollowsUser = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: target.id,
            followingId: currentUserId,
          },
        },
      });
      if (!targetFollowsUser) {
        throw new Error('This account only accepts followers from accounts it follows');
      }
    }

    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: currentUserId,
          followingId: target.id,
        },
      },
    });
    if (existing) {
      const counts = await this.getFollowRelationshipCounts(currentUserId, target.id);
      return {
        follow: existing,
        isFollowing: true,
        targetUserId: target.id,
        currentUserId,
        counts,
      };
    }

    const follow = await prisma.follow.create({
      data: {
        followerId: currentUserId,
        followingId: target.id,
      },
    });

    const counts = await this.getFollowRelationshipCounts(currentUserId, target.id);
    emitSocialEvent('social:follow-updated', {
      action: 'followed',
      actorId: currentUserId,
      targetUserId: target.id,
      counts,
    });
    const actor = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { username: true },
    });
    if (actor) {
      // The follow is already durable. Notification/realtime delivery is
      // best-effort and must never roll the successful follow back.
      void notificationService.notifyFollow(target.id, actor.username, currentUserId)
        .catch(error => console.error('Failed to create follow notification', error));
    }

    // Gold Verified Follower Rewards: when the followed creator has an ACTIVE
    // campaign and this NEW follow qualifies, quietly notify once per
    // user+campaign (idempotent referenceKey). Primary discovery stays the
    // profile gift box, so this never spams.
    void this.notifyRewardAvailability(currentUserId, target.id)
      .catch(error => console.error('Failed to send follow reward availability notification', error));
    return {
      follow,
      isFollowing: true,
      targetUserId: target.id,
      currentUserId,
      counts,
    };
  }

  async unfollowUser(currentUserId: string, username: string) {
    const target = await prisma.user.findUnique({ where: { username } });
    if (!target) {
      throw new Error('Target user not found');
    }
    if (target.id === currentUserId) {
      throw new Error('Cannot unfollow yourself');
    }

    await prisma.follow.deleteMany({
      where: {
        followerId: currentUserId,
        followingId: target.id,
      },
    });
    const counts = await this.getFollowRelationshipCounts(currentUserId, target.id);
    emitSocialEvent('social:follow-updated', {
      action: 'unfollowed',
      actorId: currentUserId,
      targetUserId: target.id,
      counts,
    });
    return {
      success: true,
      isFollowing: false,
      targetUserId: target.id,
      currentUserId,
      counts,
    };
  }

  async uploadPhoto(userId: string, photoUrl: string) {
    const photo = await prisma.photo.create({
      data: {
        userId,
        url: photoUrl,
      },
    });
    return photo;
  }

  async deletePhoto(photoId: string, userId: string) {
    const photo = await prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo || photo.userId !== userId) {
      throw new Error('Photo not found or unauthorized');
    }
    await prisma.photo.delete({ where: { id: photoId } });
    return { message: 'Photo deleted' };
  }

  async getPhotos(userId: string) {
    const photos = await prisma.photo.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return photos;
  }

  async searchUsers(query: string, limit: number = 20) {
    const users = await prisma.user.findMany({
      where: {
        OR: [{ username: { contains: query } }, { fullName: { contains: query } }],
        status: 'ACTIVE',
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        avatar: true,
        bio: true,
        age: true,
        city: true,
        photos: true,
      },
      take: limit,
    });
    return users;
  }

  async getUserById(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        avatar: true,
        bio: true,
        age: true,
        gender: true,
        country: true,
        city: true,
        verified: true,
        premium: true,
        photos: true,
      },
    });
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  async getOnlineUsers(limit: number = 50) {
    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        username: true,
        avatar: true,
        status: true,
      },
      take: limit,
    });
    return users;
  }

  async updateOnlineStatus(userId: string, isOnline: boolean) {
    const profile = await prisma.profile.update({
      where: { userId },
      data: { isOnline },
    });
    return profile;
  }

  async deleteAccount(userId: string) {
    const user = await prisma.user.update({ where: { id: userId }, data: { status: 'DELETED' } });
    await prisma.user.update({
      where: { id: userId },
      data: { email: null, phone: null, passwordHash: '' },
    });
    return { message: 'Account deleted successfully' };
  }

  async getUserStats(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }
    const [conversations, followers, photos, earnings] = await Promise.all([
      prisma.conversation.count({ where: { participants: { some: { userId } }, isGroup: false } }),
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.photo.count({ where: { userId } }),
      prisma.giftTransaction.aggregate({ where: { receiverId: userId }, _sum: { amount: true } }),
    ]);
    return {
      matches: conversations,
      pendingLikes: followers,
      photoCount: photos,
      totalEarnings: earnings._sum.amount || 0,
      premium: user.premium,
      verified: user.verified,
      joinedAt: user.createdAt,
    };
  }

  // ===== CREATOR HUB METHODS =====

  async getProfileAnalytics(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { _count: { select: { followers: true, following: true, posts: true } } },
    });
    if (!user) throw new Error('User not found');

    const [totalLikes, totalComments, totalGifts] = await Promise.all([
      prisma.postLike.count({ where: { post: { authorId: userId } } }),
      prisma.postComment.count({ where: { post: { authorId: userId } } }),
      prisma.giftTransaction.aggregate({ where: { receiverId: userId }, _sum: { amount: true } }),
    ]);

    const followers = user._count.followers;
    const posts = user._count.posts;
    const likes = totalLikes;
    const comments = totalComments;
    const gifts = totalGifts._sum.amount || 0;
    const engagement = posts > 0 ? Math.round(((likes + comments) / posts) * 100) / 100 : 0;

    return {
      totalViews: 0,
      totalLikes: likes,
      totalComments: comments,
      totalShares: 0,
      totalGifts: gifts,
      totalFollowers: followers,
      totalPosts: posts,
      totalStreams: 0,
      engagementRate: engagement,
      followerGrowth: Math.floor(followers * 0.05),
      viewsGrowth: 0,
      likesGrowth: Math.floor(likes * 0.06),
    };
  }

  async getUserAchievements(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { _count: { select: { followers: true, posts: true } } },
    });
    if (!user) throw new Error('User not found');

    const achievements: any[] = [];
    const followers = user._count.followers;
    const posts = user._count.posts;

    if (user.verified) {
      achievements.push({ id: 'verified', title: 'Verified Creator', description: 'Official verification badge', icon: 'shield', unlocked: true, rarity: 'legendary' });
    }
    if (followers >= 100) {
      achievements.push({ id: '100-followers', title: 'Rising Star', description: 'Reached 100 followers', icon: 'star', unlocked: true, rarity: 'common' });
    }
    if (followers >= 1000) {
      achievements.push({ id: '1k-followers', title: 'Popular Creator', description: 'Reached 1,000 followers', icon: 'trophy', unlocked: true, rarity: 'rare' });
    }
    if (followers >= 10000) {
      achievements.push({ id: '10k-followers', title: 'Top Creator', description: 'Reached 10,000 followers', icon: 'crown', unlocked: true, rarity: 'epic' });
    }
    if (posts >= 10) {
      achievements.push({ id: '10-posts', title: 'Content Creator', description: 'Published 10 posts', icon: 'zap', unlocked: true, rarity: 'common' });
    }
    if (posts >= 100) {
      achievements.push({ id: '100-posts', title: 'Dedicated Creator', description: 'Published 100 posts', icon: 'flame', unlocked: true, rarity: 'rare' });
    }
    if (user.premium) {
      achievements.push({ id: 'premium', title: 'Premium Member', description: 'Active premium subscription', icon: 'sparkles', unlocked: true, rarity: 'epic' });
    }

    return achievements;
  }

  async calculateCreatorScore(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { _count: { select: { followers: true, following: true, posts: true } } },
    });
    if (!user) throw new Error('User not found');

    const [totalLikes, totalComments, totalGifts] = await Promise.all([
      prisma.postLike.count({ where: { post: { authorId: userId } } }),
      prisma.postComment.count({ where: { post: { authorId: userId } } }),
      prisma.giftTransaction.aggregate({ where: { receiverId: userId }, _sum: { amount: true } }),
    ]);

    const followers = user._count.followers;
    const posts = user._count.posts;
    const likes = totalLikes;
    const comments = totalComments;
    const gifts = totalGifts._sum.amount || 0;

    const followerScore = Math.min(followers * 10, 5000);
    const engagementScore = posts > 0 ? Math.min(((likes + comments) / posts) * 50, 3000) : 0;
    const giftScore = Math.min(gifts * 5, 2000);
    const consistencyScore = Math.min(posts * 20, 1000);
    const profileScore = (user.verified ? 500 : 0) + (user.premium ? 500 : 0);

    const totalScore = Math.round(followerScore + engagementScore + giftScore + consistencyScore + profileScore);
    const level = Math.floor(totalScore / 1000) + 1;
    const xpInLevel = totalScore % 1000;
    const xpToNextLevel = 1000;

    return {
      totalScore, level,
      xp: xpInLevel, xpToNext: xpToNextLevel,
      components: { followers: Math.round(followerScore), engagement: Math.round(engagementScore), gifts: Math.round(giftScore), consistency: Math.round(consistencyScore), profile: profileScore },
      rank: Math.max(1, Math.floor((10000 - totalScore) / 100) + 1),
    };
  }

  async getFollowers(userId: string, cursor?: string, limit: number = 20, viewerId: string = userId) {
    const followers = await prisma.follow.findMany({
      where: { followingId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { follower: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT, profile: { select: { avatarUrl: true } } } } },
    });
    const nextCursor = followers.length > limit ? followers.pop()?.id : undefined;
    const userIds = followers.map(follow => follow.follower.id).filter(id => id !== viewerId);
    const viewerRelationships = userIds.length
      ? await prisma.follow.findMany({
          where: { followerId: viewerId, followingId: { in: userIds } },
          select: { followingId: true },
        })
      : [];
    const followedUserIds = new Set(viewerRelationships.map(relationship => relationship.followingId));
    return {
      items: followers.map(f => ({
        ...enrichPublicUser(f.follower),
        avatarUrl: f.follower.profile?.avatarUrl || f.follower.avatar || null,
        profile: undefined,
        isFollowing: f.follower.id !== viewerId && followedUserIds.has(f.follower.id),
        followedAt: f.createdAt,
      })),
      nextCursor,
    };
  }

  async getFollowersByUsername(username: string, cursor?: string, limit: number = 20, viewerId?: string) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new Error('Profile not found');
    }
    return this.getFollowers(user.id, cursor, limit, viewerId || user.id);
  }

  async getFollowing(userId: string, cursor?: string, limit: number = 20, viewerId: string = userId) {
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { following: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT, profile: { select: { avatarUrl: true } } } } },
    });
    const nextCursor = following.length > limit ? following.pop()?.id : undefined;
    const userIds = following.map(follow => follow.following.id).filter(id => id !== viewerId);
    const viewerRelationships = viewerId === userId
      ? userIds.map(followingId => ({ followingId }))
      : userIds.length
        ? await prisma.follow.findMany({
            where: { followerId: viewerId, followingId: { in: userIds } },
            select: { followingId: true },
          })
        : [];
    const followedUserIds = new Set(viewerRelationships.map(relationship => relationship.followingId));
    return {
      items: following.map(f => ({
        ...enrichPublicUser(f.following),
        avatarUrl: f.following.profile?.avatarUrl || f.following.avatar || null,
        profile: undefined,
        isFollowing: f.following.id !== viewerId && followedUserIds.has(f.following.id),
        followedAt: f.createdAt,
      })),
      nextCursor,
    };
  }

  async getFollowingByUsername(username: string, cursor?: string, limit: number = 20, viewerId?: string) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new Error('Profile not found');
    }
    return this.getFollowing(user.id, cursor, limit, viewerId || user.id);
  }

  async getPinnedContent(userId: string) {
    const posts = await prisma.post.findMany({
      where: { authorId: userId, pinned: true, moderationRemovedAt: null }, 
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, username: true, fullName: true, avatar: true } },
        likes: { select: { id: true } },
        comments: { select: { id: true } },
      },
    });
    return posts;
  }

  async pinContent(userId: string, contentId: string, contentType: string) {
    if (contentType === 'post') {
      return prisma.post.update({
        where: { id: contentId, authorId: userId },
        data: { pinned: true },
      });
    }
    throw new Error('Unsupported content type');
  }

  async unpinContent(userId: string, contentId: string) {
    return prisma.post.update({
      where: { id: contentId, authorId: userId },
      data: { pinned: false },
    });
  }

  async getWalletPreview(userId: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    const [totalEarnings, totalGifts] = await Promise.all([
      prisma.giftTransaction.aggregate({ where: { receiverId: userId }, _sum: { amount: true } }),
      prisma.giftTransaction.count({ where: { receiverId: userId } }),
    ]);

    return {
      balance: wallet?.coinBalance || 0,
      totalEarnings: totalEarnings._sum.amount || 0,
      totalGifts,
    };
  }

  // ===== REELS (VIDEOS) =====
  async getUserReels(userId: string, cursor?: string, limit: number = 12) {
    const reels = await prisma.video.findMany({
      where: { creatorId: userId, publishStatus: 'PUBLISHED', videoUrl: { not: null }, moderationRemovedAt: null }, 
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        _count: { select: { likes: true, comments: true } },
      },
    });
    const hasMore = reels.length > limit;
    const nextCursor = hasMore ? reels[limit - 1]?.id : undefined;
    if (hasMore) reels.pop();
    return {
      items: reels.map(r => ({
        id: r.id,
        title: r.title,
        videoUrl: r.videoUrl,
        thumbnailUrl: r.thumbnailUrl,
        duration: r.duration,
        views: r.views,
        likes: r._count.likes,
        comments: r._count.comments,
        createdAt: r.createdAt,
      })),
      nextCursor,
    };
  }

  async getPublicUserReelsByUsername(username: string, cursor?: string, limit: number = 12, viewerId?: string) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error('Profile not found');
    assertProfileAccessible(user, viewerId);
    if (!(await this.canViewProfile(user.id, viewerId))) {
      throw new Error('This profile is private');
    }
    return this.getUserReels(user.id, cursor, limit);
  }

  // Everything this user reposted (reels and normal posts), most recent repost first.
  // Each item carries repostedAt, the original author and the reposter, so the
  // profile can show real reposts with the original content and files intact.
  // Cursor is "<repostedAt ISO>|<repostId>" over the merged list.
  async getUserReposts(userId: string, cursor?: string, limit: number = 12, viewerId?: string) {
    const [cursorDateText, cursorId] = cursor?.includes('|') ? cursor.split('|', 2) : [];
    const cursorDate = cursorDateText ? new Date(cursorDateText) : undefined;
    const after = cursorDate && !Number.isNaN(cursorDate.getTime()) && cursorId
      ? { OR: [{ createdAt: { lt: cursorDate } }, { createdAt: cursorDate, id: { lt: cursorId } }] }
      : {};
    const authorSelect = { id: true, username: true, fullName: true, avatar: true, verified: true, ...BADGE_USER_SELECT };
    const [reelRows, postRows, reposter] = await Promise.all([
      prisma.reelRepost.findMany({
        where: { userId, video: { publishStatus: 'PUBLISHED', videoUrl: { not: null }, moderationRemovedAt: null }, ...after },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          video: {
            include: {
              creator: { select: authorSelect },
              likes: viewerId ? { where: { userId: viewerId }, select: { id: true } } : false,
              saves: viewerId ? { where: { userId: viewerId }, select: { id: true } } : false,
              reposts: viewerId ? { where: { userId: viewerId }, select: { id: true } } : false,
              _count: { select: { likes: true, comments: true, reposts: true } },
            },
          },
        },
      }),
      prisma.postRepost.findMany({
        where: { userId, post: { moderationRemovedAt: null }, ...after },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          post: {
            include: {
              author: { select: { ...authorSelect, profile: { select: { avatarUrl: true } } } },
              likes: viewerId ? { where: { userId: viewerId }, select: { id: true } } : false,
              saves: viewerId ? { where: { userId: viewerId }, select: { id: true } } : false,
              reposts: viewerId ? { where: { userId: viewerId }, select: { id: true } } : false,
              _count: { select: { likes: true, comments: true, reposts: true } },
            },
          },
        },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, fullName: true, avatar: true } }),
    ]);

    const merged: Array<{ at: Date; id: string; kind: 'reel' | 'post'; row: any }> = [
      ...reelRows.map((row: any) => ({ at: row.createdAt as Date, id: row.id as string, kind: 'reel' as const, row })),
      ...postRows.map((row: any) => ({ at: row.createdAt as Date, id: row.id as string, kind: 'post' as const, row })),
    ].sort((x, y) => (y.at.getTime() - x.at.getTime()) || (x.id < y.id ? 1 : -1));
    const hasMore = merged.length > limit;
    const page = merged.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? `${last.at.toISOString()}|${last.id}` : undefined;

    // Files attached to reposted posts (images, documents, video) so they render in the tab.
    const postIds = page.filter(entry => entry.kind === 'post').map(entry => entry.row.post.id as string);
    const files = postIds.length
      ? await prisma.uploadedFile.findMany({
          where: { recordType: 'Post', recordId: { in: postIds }, deletedAt: null },
          select: { id: true, recordId: true, url: true, mimeType: true, fileType: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const filesByPost = new Map<string, any[]>();
    for (const file of files) {
      const list = filesByPost.get(file.recordId) ?? [];
      list.push({ id: file.id, url: file.url, type: file.fileType, mimeType: file.mimeType });
      filesByPost.set(file.recordId, list);
    }
    const reposterInfo = reposter ? enrichPublicUser(reposter as any) : null;

    return {
      items: page.map(({ kind, row }) => {
        if (kind === 'post') {
          const post = row.post;
          const { author, ...rest } = post;
          const attachments = filesByPost.get(post.id) ?? (post.mediaUrl ? [{ url: post.mediaUrl }] : []);
          return {
            ...this.serializePost(rest, author, {
              viewerId,
              liked: post.likes?.length > 0,
              saved: post.saves?.length > 0,
            }),
            ...(attachments.length ? { media: attachments[0].url, mediaUrl: attachments[0].url } : {}),
            attachments,
            views: post.views ?? 0,
            reposts: post._count?.reposts ?? 0,
            isReposted: viewerId ? post.reposts?.length > 0 : false,
            repostId: row.id,
            repostedAt: row.createdAt,
            repostKind: 'post',
            reposter: reposterInfo,
          };
        }
        return {
          id: row.video.id,
          repostId: row.id,
          repostKind: 'reel',
          title: row.video.title,
          videoUrl: row.video.videoUrl,
          mediaUrl: row.video.videoUrl,
          thumbnailUrl: row.video.thumbnailUrl,
          duration: row.video.duration,
          views: row.video.views,
          likes: row.video._count.likes,
          comments: row.video._count.comments,
          reposts: row.video._count.reposts,
          description: row.video.description,
          isLiked: viewerId ? (row.video as any).likes?.length > 0 : false,
          saved: viewerId ? (row.video as any).saves?.length > 0 : false,
          isReposted: viewerId ? (row.video as any).reposts?.length > 0 : false,
          createdAt: row.video.createdAt,
          repostedAt: row.createdAt,
          creator: enrichPublicUser(row.video.creator as any),
          reposter: reposterInfo,
        };
      }),
      nextCursor,
    };
  }

  async getPublicUserRepostsByUsername(username: string, cursor?: string, limit: number = 12, viewerId?: string) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error('Profile not found');
    assertProfileAccessible(user, viewerId);
    if (!(await this.canViewProfile(user.id, viewerId))) {
      throw new Error('This profile is private');
    }
    return this.getUserReposts(user.id, cursor, limit, viewerId);
  }

  // ===== LIVESTREAMS =====
  async getUserLivestreams(userId: string, cursor?: string, limit: number = 10) {
    const streams = await prisma.liveStream.findMany({
      where: { hostId: userId, moderationRemovedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        viewerCount: true,
        peakViewers: true,
        totalViewers: true,
        status: true,
        categoryName: true,
        duration: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        gifts: true,
        likes: true,
      },
    });
    const nextCursor = streams.length > limit ? streams.pop()?.id : undefined;
    return { items: streams, nextCursor };
  }

  async getPublicUserLivestreamsByUsername(username: string, cursor?: string, limit: number = 10, viewerId?: string) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error('Profile not found');
    assertProfileAccessible(user, viewerId);
    if (viewerId !== user.id) {
      const settings = await prisma.userSettings.findUnique({
        where: { userId: user.id },
        select: { liveStreamVisibility: true, privacyLiveStream: true },
      });
      const visibilityValues = [settings?.liveStreamVisibility, settings?.privacyLiveStream].filter(Boolean);
      if (visibilityValues.some((value) => value === 'nobody' || value === 'noone')) {
        throw new Error('This user does not share live streams publicly');
      }
      if (visibilityValues.some((value) => value === 'followers' || value === 'following')) {
        if (!viewerId) throw new Error('This user shares live streams with followers only');
        const followsHost = await prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: viewerId, followingId: user.id } },
          select: { id: true },
        });
        if (!followsHost) throw new Error('This user shares live streams with followers only');
      }
    }
    return this.getUserLivestreams(user.id, cursor, limit);
  }

  /**
   * Best-effort "a reward is waiting" notification for a follower who just
   * followed a Gold creator with an ACTIVE campaign. Idempotent per
   * user+campaign (Notification.referenceKey is unique per user).
   */
  private async notifyRewardAvailability(followerId: string, creatorId: string): Promise<void> {
    const { followerRewardService } = await import('./follower-reward.service');
    const availability = await followerRewardService.getRewardAvailability(creatorId, followerId);
    if (!availability.available || !availability.campaign) return;

    const { notificationService } = await import('./notification.service');
    const creator = await prisma.user.findUnique({ where: { id: creatorId }, select: { username: true } });
    await notificationService.createNotification(
      followerId,
      'FOLLOWER_REWARD_AVAILABLE',
      'A reward is waiting',
      creator
        ? `🎁 @${creator.username} has a reward for you!`
        : '🎁 A reward is waiting on a profile you follow!',
      {
        actorId: creatorId,
        campaignId: availability.campaign.id,
        entityType: 'follower_reward',
        entityId: availability.campaign.id,
        referenceKey: `follower-reward-available:${followerId}:${availability.campaign.id}`,
      }
    );
  }
}

export const userService = new UserService();
