import { Router, type Response } from 'express';
import { authenticateJWT, type AuthRequest } from '../middleware/auth.middleware';
import { loadLinkPreview, previewUrl, type LinkPreview } from '../services/link-preview.service';

const router = Router();
router.use(authenticateJWT);

const cache = new Map<string, { expires: number; value: LinkPreview }>();
const pending = new Map<string, Promise<LinkPreview>>();
const quota = new Map<string, { expires: number; count: number }>();
const MAX_CACHE = 48;
const MAX_PENDING = 6;
const MAX_USERS = 10000;
const PER_MINUTE = 30;

function permit(userId: string): boolean {
  const now = Date.now();
  const entry = quota.get(userId);
  if (entry && entry.expires > now) {
    if (entry.count >= PER_MINUTE) return false;
    entry.count++;
    return true;
  }
  if (quota.size >= MAX_USERS) {
    for (const [key, value] of quota) if (value.expires <= now) quota.delete(key);
    if (quota.size >= MAX_USERS) return false;
  }
  quota.set(userId, { count: 1, expires: now + 60000 });
  return true;
}

router.post('/', async (req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'private, no-store');
  if (!req.user?.userId) { res.status(401).json({}); return; }
  if (!permit(req.user.userId)) { res.status(429).json({}); return; }
  const url = previewUrl(req.body?.url);
  if (!url) { res.json({}); return; }
  const key = url.href;
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) {
    res.json(existing.value);
    return;
  }
  cache.delete(key);
  let task = pending.get(key);
  if (!task) {
    if (pending.size >= MAX_PENDING) { res.status(429).json({}); return; }
    task = loadLinkPreview(key).catch(() => ({}));
    pending.set(key, task);
    void task.then(value => {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
      cache.set(key, { value, expires: Date.now() + (Object.keys(value).length ? 30 * 60_000 : 60_000) });
    }).finally(() => pending.delete(key));
  }
  const value = await task;
  res.json(value);
});

export default router;
