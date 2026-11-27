import { Router } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth.middleware';
import { assertDirectMessageAllowed } from '../services/chat.service';
import { getChatUploadUsage } from '../services/chat-contact.service';

export const chatContactRoutes = Router();
const publicSelect = { id: true, username: true } as const;
const requestSelect = { id: true, sender: { select: publicSelect }, recipient: { select: publicSelect }, status: true, createdAt: true, updatedAt: true } as const;

chatContactRoutes.get('/storage-usage', async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await getChatUploadUsage(userId));
  } catch { res.status(500).json({ error: 'Could not load chat storage usage' }); }
});

chatContactRoutes.get('/requests', async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const [incoming, outgoing] = await Promise.all([
      prisma.chatContactRequest.findMany({ where: { recipientId: userId, status: 'PENDING' }, select: requestSelect, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.chatContactRequest.findMany({ where: { senderId: userId }, select: requestSelect, orderBy: { updatedAt: 'desc' }, take: 100 }),
    ]);
    res.set('Cache-Control', 'private, no-store');
    res.json({ incoming, outgoing });
  } catch { res.status(500).json({ error: 'Could not load contact requests' }); }
});

chatContactRoutes.post('/requests', async (req: AuthRequest, res) => {
  const senderId = req.user?.userId;
  if (!senderId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().replace(/^@/, '') : '';
  if (!/^[a-zA-Z0-9_]{1,30}$/.test(username)) { res.status(400).json({ error: 'Enter a valid username' }); return; }
  try {
    const target = await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' }, status: 'ACTIVE' }, select: publicSelect });
    if (!target || target.id === senderId) { res.status(400).json({ error: 'Contact request unavailable' }); return; }
    try { await assertDirectMessageAllowed(senderId, target.id); }
    catch { res.status(403).json({ error: 'Contact request unavailable under this account’s privacy settings' }); return; }
    // Unique sender/recipient pair prevents repeat requests after a decline
    // and makes retries idempotent rather than sending additional requests.
    const item = await prisma.chatContactRequest.upsert({
      where: { senderId_recipientId: { senderId, recipientId: target.id } },
      create: { senderId, recipientId: target.id }, update: {}, select: requestSelect,
    });
    res.status(200).json(item);
  } catch { res.status(500).json({ error: 'Could not send contact request' }); }
});

chatContactRoutes.put('/requests/:id', async (req: AuthRequest, res) => {
  const recipientId = req.user?.userId;
  if (!recipientId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const status = req.body?.status;
  if (!id || !['ACCEPTED', 'DECLINED'].includes(status)) { res.status(400).json({ error: 'Invalid request decision' }); return; }
  try {
    const request = await prisma.chatContactRequest.findFirst({ where: { id, recipientId, status: 'PENDING' }, select: { senderId: true } });
    if (!request) { res.status(404).json({ error: 'Pending request not found' }); return; }
    if (status === 'ACCEPTED') {
      try { await assertDirectMessageAllowed(request.senderId, recipientId); }
      catch { res.status(403).json({ error: 'This contact is restricted by your privacy settings' }); return; }
    }
    const changed = await prisma.chatContactRequest.updateMany({ where: { id, recipientId, status: 'PENDING' }, data: { status } });
    if (!changed.count) { res.status(409).json({ error: 'Request has already been reviewed' }); return; }
    res.json({ status });
  } catch { res.status(500).json({ error: 'Could not review request' }); }
});
