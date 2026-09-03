import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { getWelcomeReward, claimWelcomeReward } from '../controllers/welcome-reward.controller';

const router = Router();

router.get('/status', authenticateJWT, getWelcomeReward);
router.post('/claim', authenticateJWT, claimWelcomeReward);

export default router;