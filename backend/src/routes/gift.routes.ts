import { Router } from 'express';
import { getGiftHistory, getGifts, sendGift, validateGiftWallet } from '../controllers/gift.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.get('/', getGifts);

router.use(authenticateJWT);
router.post('/send', sendGift);
router.get('/history', getGiftHistory);
router.get('/wallet/validate', validateGiftWallet);

export default router;
