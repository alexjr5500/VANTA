import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { getParamString } from '../utils/params';
import { uploadService, userService, matchService } from '../services';
import { emitSocialEvent } from '../services/social-events.service';

const parseLimit = (value: unknown, defaultLimit = 12) => {
  const parsed = typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(parsed, 50);
};

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const profile = await userService.getUserProfile(userId);
    res.status(200).json(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const profile = await userService.updateProfile(userId, req.body);
    res.status(200).json({ message: 'Profile updated successfully', profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const uploadAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Avatar file is required' });
      return;
    }
    const previousProfile = await userService.getUserProfile(userId);
    const result = await uploadService.uploadFile(req, req.file, {
      category: 'avatar', recordType: 'User', recordId: userId, optimize: true,
    });
    const url = result.url;
    const profile = await userService.updateProfileImage(userId, 'avatar', url);
    await uploadService.deletePreviousForUser(userId, 'avatar', result.id);
    emitSocialEvent('profile_updated', {
      userId,
      avatar: url,
      bannerUrl: profile.bannerUrl || null,
      previousAvatar: previousProfile.avatarUrl || null,
      previousBannerUrl: previousProfile.bannerUrl || null,
      updatedAt: Date.now(),
    });
    res.status(200).json({ message: 'Avatar uploaded successfully', profile, url, fileId: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const uploadBanner = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Banner file is required' });
      return;
    }
    const previousProfile = await userService.getUserProfile(userId);
    const result = await uploadService.uploadFile(req, req.file, {
      category: 'banner', recordType: 'User', recordId: userId, optimize: true,
    });
    const url = result.url;
    const profile = await userService.updateProfileImage(userId, 'banner', url);
    await uploadService.deletePreviousForUser(userId, 'banner', result.id);
    emitSocialEvent('profile_updated', {
      userId,
      avatar: profile.avatarUrl || null,
      bannerUrl: url,
      previousAvatar: previousProfile.avatarUrl || null,
      previousBannerUrl: previousProfile.bannerUrl || null,
      updatedAt: Date.now(),
    });
    res.status(200).json({ message: 'Banner uploaded successfully', profile, url, fileId: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const uploadProfileMedia = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Media file is required' });
      return;
    }
    const result = await uploadService.uploadFile(req, req.file, {
      category: 'profile-media', recordType: 'ProfileMedia', recordId: userId, optimize: true,
    });
    const url = result.url;
    const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 80) : undefined;
    const media = await userService.addProfileMedia(userId, url, 'IMAGE', title);
    await uploadService.linkFile(result.id, userId, 'ProfileMedia', media.id);
    res.status(201).json({ message: 'Media uploaded successfully', media, fileId: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getProfilePosts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 10);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const posts = await userService.getUserPosts(userId, cursor, limit);
    res.status(200).json(posts);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getProfileMedia = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 12);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const media = await userService.getProfileMedia(userId, cursor, limit);
    res.status(200).json(media);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getProfileReplies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 10);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const replies = await userService.getUserReplies(userId, cursor, limit);
    res.status(200).json(replies);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getProfileLikes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 10);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const likes = await userService.getUserLikes(userId, cursor, limit);
    res.status(200).json(likes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getPublicProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const username = getParamString(req.params.username);
    const userId = (req as AuthRequest).user?.userId;
    const profile = await userService.getPublicProfileByUsername(username, userId);
    res.status(200).json(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const getPublicProfilePosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const username = getParamString(req.params.username);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 10);
    const posts = await userService.getPublicUserPostsByUsername(username, cursor, limit);
    res.status(200).json(posts);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const getPublicProfileMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const username = getParamString(req.params.username);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 12);
    const media = await userService.getPublicUserMediaByUsername(username, cursor, limit);
    res.status(200).json(media);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const getProfileFollowersByUsername = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const username = getParamString(req.params.username);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const followers = await userService.getFollowersByUsername(username, cursor, limit, req.user?.userId);
    res.status(200).json(followers);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const getProfileFollowingByUsername = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const username = getParamString(req.params.username);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    const following = await userService.getFollowingByUsername(username, cursor, limit, req.user?.userId);
    res.status(200).json(following);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const followUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentUserId = req.user?.userId;
    const username = getParamString(req.params.username);
    if (!currentUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await userService.followUser(currentUserId, username);
    res.status(200).json({ message: 'Followed successfully', ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const unfollowUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentUserId = req.user?.userId;
    const username = getParamString(req.params.username);
    if (!currentUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await userService.unfollowUser(currentUserId, username);
    res.status(200).json({ message: 'Unfollowed successfully', ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getDiscoverProfiles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseLimit(req.query.limit, 10);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const profiles = await matchService.discover(userId, limit);
    res.status(200).json(profiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ===== NEW CREATOR HUB ENDPOINTS =====

export const getProfileAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const analytics = await userService.getProfileAnalytics(userId);
    res.status(200).json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getProfileAchievements = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const achievements = await userService.getUserAchievements(userId);
    res.status(200).json(achievements);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getCreatorScore = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const score = await userService.calculateCreatorScore(userId);
    res.status(200).json(score);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getFollowers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const followers = await userService.getFollowers(userId, cursor, limit);
    res.status(200).json(followers);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getFollowing = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 20);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const following = await userService.getFollowing(userId, cursor, limit);
    res.status(200).json(following);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getPinnedContent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const pinned = await userService.getPinnedContent(userId);
    res.status(200).json(pinned);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const pinContent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { contentId, contentType } = req.body;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!contentId || !contentType) {
      res.status(400).json({ error: 'contentId and contentType are required' });
      return;
    }
    const pinned = await userService.pinContent(userId, contentId, contentType);
    res.status(200).json({ message: 'Content pinned successfully', pinned });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const unpinContent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { contentId } = req.body;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!contentId) {
      res.status(400).json({ error: 'contentId is required' });
      return;
    }
    await userService.unpinContent(userId, contentId);
    res.status(200).json({ message: 'Content unpinned successfully' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getWalletPreview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const wallet = await userService.getWalletPreview(userId);
    res.status(200).json(wallet);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getProfileReels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 12);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const reels = await userService.getUserReels(userId, cursor, limit);
    res.status(200).json(reels);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getPublicProfileReels = async (req: Request, res: Response): Promise<void> => {
  try {
    const username = getParamString(req.params.username);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 12);
    const reels = await userService.getPublicUserReelsByUsername(username, cursor, limit);
    res.status(200).json(reels);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const getProfileLivestreams = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 10);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const streams = await userService.getUserLivestreams(userId, cursor, limit);
    res.status(200).json(streams);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getPublicProfileLivestreams = async (req: Request, res: Response): Promise<void> => {
  try {
    const username = getParamString(req.params.username);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseLimit(req.query.limit, 10);
    const streams = await userService.getPublicUserLivestreamsByUsername(username, cursor, limit);
    res.status(200).json(streams);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};
