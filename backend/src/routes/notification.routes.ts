import { Router } from 'express';
import { deleteNotification, getNotifications, getUnreadCount, markAsRead, markAllAsRead } from '../controllers/notification.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.get('/unread/count', getUnreadCount);
router.patch('/read-all', markAllAsRead);
router.put('/read-all', markAllAsRead);
router.patch('/:notificationId/read', markAsRead);
router.put('/:notificationId/read', markAsRead);
router.delete('/:notificationId', deleteNotification);

export default router;
