import { Router } from 'express';
import {
  authenticateAppealRequest,
  submitAppeal,
  getOwnAppeals,
  getAccountOverview,
} from '../controllers/appeal.controller';
import { rateLimiter } from '../security';

const router = Router();

// Abuse controls: appeal submission is intentionally infrequent. One open
// appeal per account is additionally enforced by the service (409 on
// duplicates), so this limiter only blunts scripted floods.
const appealSubmitLimiter = rateLimiter.createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many appeal attempts. Please wait a few minutes and try again.',
});

// All appeal endpoints resolve the actor server-side from a restricted
// session (suspended) or a short-lived appeal token (banned). No endpoint
// accepts a target user id from the client.
router.post('/', appealSubmitLimiter, authenticateAppealRequest, submitAppeal);
router.get('/mine', authenticateAppealRequest, getOwnAppeals);
router.get('/account', authenticateAppealRequest, getAccountOverview);

export default router;
