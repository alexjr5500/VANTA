import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { emitSocialEvent } from './social-events.service';
import { notificationService } from './notification.service';

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
          select: { badgeType: true, status: true },
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

    // Get current live stream if any
    const currentStream = await prisma.liveStream.findFirst({
      where: { hostId: userId, active: true, status: 'LIVE' },
      select: { id: true, title: true, viewerCount: true, thumbnailUrl: true, categoryName: true },
    });

    // Get total likes and comments
    const [totalLikes, totalComments, totalGifts, totalViews, totalStreams] = await Promise.all([
      prisma.postLike.count({ where: { post: { authorId: userId } } }),
      prisma.postComment.count({ where: { post: { authorId: userId } } }),
      prisma.giftTransaction.aggregate({ where: { receiverId: userId }, _sum: { amount: true } }),
      prisma.liveStream.aggregate({ where: { hostId: userId }, _sum: { totalViewers: true } }),
      prisma.liveStream.count({ where: { hostId: userId } }),
    ]);

    const profile = user.profile;
    const languages = profile?.languages ? JSON.parse(profile.languages) : [];
    const featuredContent = profile?.featuredContent ? JSON.parse(profile.featuredContent) : [];

    return {
      id: user.id,
      email: user.email || null,
      username: user.username,
      fullName: user.fullName,
      avatarUrl: profile?.avatarUrl || user.avatar || null,
      bannerUrl: profile?.bannerUrl || null,
      bio: profile?.bio || user.bio || null,
      website: profile?.website || null,
      country: profile?.country || null,
      city: profile?.city || null,
      interests: profile?.interests || null,
      verified: user.verified,
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
      // Verification
      verificationType: user.verificationBadge?.badgeType || (user.verified ? 'blue' : null),
      verificationStatus: user.verificationBadge?.status || null,
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
        posts: user._count.posts,
        media: profile?.media.length || 0,
      },
      // Aggregated stats
      stats: {
        totalLikes: totalLikes,
        totalComments: totalComments,
        totalGifts: totalGifts._sum.amount || 0,
        totalViews: totalViews._sum.totalViewers || 0,
        totalStreams: totalStreams,
        totalPosts: user._count.posts,
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

  async getPublicProfileByUsername(username: string, currentUserId?: string) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        profile: { include: { socialLinks: true, media: { orderBy: { createdAt: 'desc' }, take: 12 } } },
        _count: { select: { followers: true, following: true, posts: true } },
        posts: {
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: {
            likes: { select: { id: true } },
            comments: { select: { id: true } },
          },
        },
      },
    });

    if (!user) {
      throw new Error('Profile not found');
    }

    const currentStream = await prisma.liveStream.findFirst({
      where: { hostId: user.id, active: true, status: 'LIVE' },
      select: { id: true, title: true, viewerCount: true, thumbnailUrl: true, categoryName: true },
    });

    const [totalLikes, totalComments, totalGifts, totalViews, totalStreams] = await Promise.all([
      prisma.postLike.count({ where: { post: { authorId: user.id } } }),
      prisma.postComment.count({ where: { post: { authorId: user.id } } }),
      prisma.giftTransaction.aggregate({ where: { receiverId: user.id }, _sum: { amount: true } }),
      prisma.liveStream.aggregate({ where: { hostId: user.id }, _sum: { totalViewers: true } }),
      prisma.liveStream.count({ where: { hostId: user.id } }),
    ]);

    const isFollowing = currentUserId
      ? Boolean(
          await prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: currentUserId,
                followingId: user.id,
              },
            },
          }),
        )
      : false;

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
      verified: user.verified,
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
        posts: user._count.posts,
        media: user.profile?.media.length || 0,
      },
      stats: {
        totalLikes,
        totalComments,
        totalGifts: totalGifts._sum.amount || 0,
        totalViews: totalViews._sum.totalViewers || 0,
        totalStreams,
        totalPosts: user._count.posts,
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

  async getUserPosts(userId: string, cursor?: string, limit: number = 10) {
    const query: any = { authorId: userId };
    const posts = await prisma.post.findMany({
      where: query,
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
        likes: { select: { id: true } },
        comments: { select: { id: true } },
      },
    });

    const nextCursor = posts.length > limit ? posts.pop()?.id : undefined;
    return {
      items: posts.map(({ author, ...post }: any) => ({
        ...post,
        author: {
          ...author,
          avatar: author.profile?.avatarUrl || author.avatar || null,
          avatarUrl: author.profile?.avatarUrl || author.avatar || null,
          profile: undefined,
        },
      })),
      nextCursor,
    };
  }

  async getProfileMedia(userId: string, cursor?: string, limit: number = 12) {
    const profile = await prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
      // A user can have a valid account before an optional profile row exists.
      // Treat that as an empty media collection, not a broken profile.
      return { items: [], nextCursor: undefined };
    }
    const media = await prisma.profileMedia.findMany({
      where: { profileId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const nextCursor = media.length > limit ? media.pop()?.id : undefined;
    return { items: media, nextCursor };
  }

  async getUserReplies(userId: string, cursor?: string, limit: number = 10) {
    const replies = await prisma.postComment.findMany({
      where: { userId },
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
            author: { select: { id: true, username: true, avatar: true } },
            likes: { select: { id: true } },
            comments: { select: { id: true } },
          },
        },
      },
    });
    const nextCursor = likes.length > limit ? likes.pop()?.id : undefined;
    return { items: likes, nextCursor };
  }

  async getPublicUserPostsByUsername(username: string, cursor?: string, limit: number = 10) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new Error('Profile not found');
    }
    return this.getUserPosts(user.id, cursor, limit);
  }

  async getPublicUserMediaByUsername(username: string, cursor?: string, limit: number = 12) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new Error('Profile not found');
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

    if (data.privacyProfile !== undefined) {
      const value = data.privacyProfile.trim().toLowerCase();
      if (!['public', 'private'].includes(value)) {
        throw new Error('Profile privacy must be public or private');
      }
      settings.privacyProfile = value;
    }

    if (data.privacyMessages !== undefined) {
      const value = data.privacyMessages.trim().toLowerCase();
      if (!['everyone', 'following', 'noone'].includes(value)) {
        throw new Error('Message privacy must be everyone, following, or noone');
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

  async updateEmail(userId: string, email: string) {
    const normalized = ensureValidEmail(email);
    const existing = await prisma.user.findFirst({
      where: {
        email: normalized,
        NOT: { id: userId },
      },
    });
    if (existing) {
      throw new Error('Email already in use');
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { email: normalized },
    });

    return { id: user.id, email: user.email };
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
      include: { follower: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, profile: { select: { avatarUrl: true } } } } },
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
        ...f.follower,
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
      include: { following: { select: { id: true, username: true, fullName: true, avatar: true, verified: true, profile: { select: { avatarUrl: true } } } } },
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
        ...f.following,
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
      where: { authorId: userId, pinned: true },
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
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        _count: { select: { likes: true, comments: true } },
      },
    });
    const nextCursor = reels.length > limit ? reels.pop()?.id : undefined;
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

  async getPublicUserReelsByUsername(username: string, cursor?: string, limit: number = 12) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error('Profile not found');
    return this.getUserReels(user.id, cursor, limit);
  }

  // ===== LIVESTREAMS =====
  async getUserLivestreams(userId: string, cursor?: string, limit: number = 10) {
    const streams = await prisma.liveStream.findMany({
      where: { hostId: userId },
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

  async getPublicUserLivestreamsByUsername(username: string, cursor?: string, limit: number = 10) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error('Profile not found');
    return this.getUserLivestreams(user.id, cursor, limit);
  }
}

export const userService = new UserService();
