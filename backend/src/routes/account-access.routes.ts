import { Router } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { auditLog } from '../security/auditLog';
import { connectedIdentities, trustedDeviceRecords, removeTrustedDeviceRecord } from '../services/account-access.service';

export const accountAccessRoutes = Router();
// Mounted only after the canonical authentication middleware.
accountAccessRoutes.get('/connected-accounts', async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try { res.set('Cache-Control', 'private, no-store'); res.json({ items: await connectedIdentities(userId) }); }
  catch { res.status(500).json({ error: 'Could not load connected accounts' }); }
});
accountAccessRoutes.get('/trusted-devices', async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try { res.set('Cache-Control', 'private, no-store'); res.json({ items: await trustedDeviceRecords(userId) }); }
  catch { res.status(500).json({ error: 'Could not load trusted devices' }); }
});
accountAccessRoutes.delete('/trusted-devices/:id', async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!id) { res.status(400).json({ error: 'Device required' }); return; }
  try {
    if (!await removeTrustedDeviceRecord(userId, id)) { res.status(404).json({ error: 'Device not found' }); return; }
    await auditLog.log({ userId, action: 'TRUSTED_DEVICE_REMOVED', metadata: { id } });
    res.json({ message: 'Trusted-device record removed' });
  } catch { res.status(500).json({ error: 'Could not remove trusted device' }); }
});
