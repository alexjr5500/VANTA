import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  getDiscoverProfiles,
  uploadProfileMedia,
  getProfilePosts,
  getProfileMedia,
  getProfileReplies,
  getProfileLikes,
  getPublicProfile,
  getPublicProfilePosts,
  getPublicProfileMedia,
  getProfileFollowersByUsername,
  getProfileFollowingByUsername,
  followUser,
  unfollowUser,
  // New Creator Hub endpoints
  getProfileAnalytics,
  getProfileAchievements,
  getCreatorScore,
  getFollowers,
  getFollowing,
  getPinnedContent,
  pinContent,
  unpinContent,
  getWalletPreview,
  getProfileReels,
  getPublicProfileReels,
  getProfileLivestreams,
  getPublicProfileLivestreams,
} from '../controllers/profile.controller';
import { authenticateJWT, optionallyAuthenticateJWT } from '../middleware/auth.middleware';
import {
  uploadAvatar,
  uploadBanner,
} from '../controllers/upload.controller';
import { uploadAvatarMulter, uploadBannerMulter, upload } from '../services';

const router = Router();

// Public routes (no auth required)
router.get('/public/:username', optionallyAuthenticateJWT, getPublicProfile);
router.get('/public/:username/posts', getPublicProfilePosts);
router.get('/public/:username/media', getPublicProfileMedia);
router.get('/public/:username/reels', getPublicProfileReels);
router.get('/public/:username/livestreams', getPublicProfileLivestreams);

// Auth required routes
router.use(authenticateJWT);

// Own profile
router.get('/me', getProfile);
router.get('/me/posts', getProfilePosts);
router.get('/me/media', getProfileMedia);
router.get('/me/replies', getProfileReplies);
router.get('/me/likes', getProfileLikes);
router.put('/me', updateProfile);
router.post('/me/avatar', uploadAvatarMulter.single('avatar'), uploadAvatar);
router.post('/me/banner', uploadBannerMulter.single('banner'), uploadBanner);
router.post('/me/media', upload.single('media'), uploadProfileMedia);

// Creator Hub endpoints
router.get('/me/analytics', getProfileAnalytics);
router.get('/me/achievements', getProfileAchievements);
router.get('/me/creator-score', getCreatorScore);
router.get('/me/followers', getFollowers);
router.get('/me/following', getFollowing);
router.get('/me/pinned', getPinnedContent);
router.post('/me/pin', pinContent);
router.delete('/me/pin', unpinContent);
router.get('/me/wallet-preview', getWalletPreview);
router.get('/me/reels', getProfileReels);
router.get('/me/livestreams', getProfileLivestreams);

// Follow system
router.get('/:username/followers', getProfileFollowersByUsername);
router.get('/:username/following', getProfileFollowingByUsername);
router.post('/:username/follow', followUser);
router.delete('/:username/follow', unfollowUser);

// Discover
router.get('/discover', getDiscoverProfiles);

export default router;