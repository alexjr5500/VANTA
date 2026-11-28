import { Router } from 'express';
import { getConversations, getMessages, startConversation, sendMessage, markMessagesRead, searchMessages, editMessage, deleteMessage, getUnreadCount, reactToMessage, setMessagePinned, setConversationMuted, recordCallMessage, voteOnPoll } from '../controllers/message.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { rateLimiter } from '../security/rateLimiter';
import { chatContactRoutes } from './chat-contact.routes';

const router = Router();

router.use(authenticateJWT);
// Authenticate first so messaging rate limits are keyed to the real user, not a shared 'unknown' key.
router.use(rateLimiter.messaging);

router.use(chatContactRoutes);
router.get('/', getConversations);
router.get('/unread/count', getUnreadCount);
router.post('/start', startConversation);

// Call history log for private 1-to-1 conversations
router.post('/:conversationId/call', recordCallMessage);

router.put('/message/:messageId', editMessage);
router.delete('/message/:messageId', deleteMessage);
router.put('/message/:messageId/reaction', reactToMessage);
router.put('/message/:messageId/pin', setMessagePinned);
router.put('/:conversationId/mute', setConversationMuted);
router.get('/:conversationId/search', searchMessages);
router.get('/:conversationId', getMessages);
router.post('/send', sendMessage);
router.post('/poll/:messageId/vote', voteOnPoll);
router.put('/:conversationId/read', markMessagesRead);

export default router;
