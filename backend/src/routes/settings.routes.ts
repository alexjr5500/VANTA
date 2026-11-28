import { Router } from 'express';
import {
  getPrivacySettings,
  updatePrivacySettings,
  getNotificationPreferences,
  updateNotificationPreferences,
  getActiveSessions,
  revokeSession,
  revokeAllSessions,
  updateAccountSettings,
  requestEmailChange,
  verifyEmailChange,
  deleteAccount,
  getBlockedUsers,
  blockUser,
  unblockUser,
  getMutedUsers,
  muteUser,
  unmuteUser,
  getSecurityLogs,
} from '../controllers/settings.controller';
import { delegationRoutes } from './delegation.routes';
import { accountAccessRoutes } from './account-access.routes';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT);
router.use(accountAccessRoutes);
router.use(delegationRoutes);

router.get('/privacy', getPrivacySettings);
router.put('/privacy', updatePrivacySettings);

router.get('/notifications', getNotificationPreferences);
router.put('/notifications', updateNotificationPreferences);

router.get('/sessions', getActiveSessions);
router.delete('/sessions/:id', revokeSession);
router.delete('/sessions', revokeAllSessions);

router.put('/account', updateAccountSettings);
router.post('/account/email-change/request', requestEmailChange);
router.post('/account/email-change/verify', verifyEmailChange);
router.delete('/account', deleteAccount);

router.get('/blocked', getBlockedUsers);
router.post('/blocked', blockUser);
router.delete('/blocked/:targetId', unblockUser);

router.get('/muted', getMutedUsers);
router.post('/muted', muteUser);
router.delete('/muted/:targetId', unmuteUser);

router.get('/security-logs', getSecurityLogs);

export default router;
