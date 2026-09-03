import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  getCreatorStats,
  getCreatorContent,
  getCreatorAccess,
} from '../controllers/creator.controller';

const router = Router();

// Every Creator Studio route requires an authenticated session. The controller
// then scopes all data to that session's own userId.
router.use(authenticateJWT);

// Authenticated creator's aggregated overview metrics (real data).
router.get('/stats', getCreatorStats);

// Authenticated creator's recent content with per-item performance.
router.get('/content', getCreatorContent);

// Whether the authenticated user may access Creator Studio.
router.get('/access', getCreatorAccess);

export default router;
