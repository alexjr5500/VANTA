import { Router } from 'express';
import {
  getActiveStreams,
  getCategories,
  getDiscoveryStreams,
  getStream,
  getStreamChat,
  startStream,
  joinStream,
  leaveStream,
  sendMessage,
  followStreamer,
  endStream,
  getFollowingStreams,
  getStreamHistory,
  getHostStats,
  getViewerToken,
  getHostToken,
  likeStream,
  updateStream,
  deleteStream,
  getTrendingStreams,
  getRecentlyEnded,
  getPopularCreators,
  getStreamAnalytics,
  reportStream,
  getStreamReplay,
  getStreamShare,
  getStreamModeration,
  getStreamBlocked,
  getStreamFollowing,
  getGuests,
  getGuestToken,
} from '../controllers/live.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// Static routes must be registered before /:streamId.
router.get('/categories', getCategories);
router.get('/discover', getDiscoveryStreams);
router.get('/trending', getTrendingStreams);
router.get('/recently-ended', getRecentlyEnded);
router.get('/popular-creators', getPopularCreators);
router.get('/history', authenticateJWT, getStreamHistory);
router.get('/stats', authenticateJWT, getHostStats);
router.get('/following', authenticateJWT, getFollowingStreams);
router.get('/', getActiveStreams);
router.get('/:streamId/chat', getStreamChat);
router.get('/:streamId/viewer-token', authenticateJWT, getViewerToken);
router.get('/:streamId/host-token', authenticateJWT, getHostToken);
router.get('/:streamId/analytics', authenticateJWT, getStreamAnalytics);
router.get('/:streamId/replay', authenticateJWT, getStreamReplay);
router.get('/:streamId/share', getStreamShare);
router.get('/:streamId/moderation', authenticateJWT, getStreamModeration);
router.get('/:streamId/blocked', authenticateJWT, getStreamBlocked);
router.get('/:streamId/following', authenticateJWT, getStreamFollowing);
router.get('/:streamId/guests', authenticateJWT, getGuests);
router.get('/:streamId/guest-token', authenticateJWT, getGuestToken);
router.get('/:streamId', getStream);

router.use(authenticateJWT);

router.post('/start', startStream);
router.post('/:streamId/join', joinStream);
router.post('/:streamId/leave', leaveStream);
router.post('/:streamId/message', sendMessage);
router.post('/:streamId/follow', followStreamer);
router.post('/:streamId/like', likeStream);
router.post('/:streamId/report', reportStream);
router.post('/:streamId/end', endStream);
router.put('/:streamId/end', endStream);
router.patch('/:streamId', updateStream);
router.delete('/:streamId', deleteStream);

export default router;
