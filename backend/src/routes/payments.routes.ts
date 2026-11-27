import { Router, Request, Response } from 'express';
import { rateLimiter } from '../security/rateLimiter';

import { shopCardEnabled } from '../config/shop-card.config';
import { handleShopCardWebhook } from '../services/shop-card.service';

const router = Router();

router.post('/shop/stripe/webhook', rateLimiter.coinWebhook, async (req: Request, res: Response) => {
  if (!shopCardEnabled()) { res.status(503).json({ error: 'Card checkout disabled' }); return; }
  const raw = (req as Request & { rawBody?: string }).rawBody;
  const sig = req.headers['stripe-signature'];
  if (typeof raw !== 'string' || typeof sig !== 'string') { res.status(400).json({ error: 'Missing signature or raw body' }); return; }
  try { res.json(await handleShopCardWebhook(raw, sig)); }
  catch { res.status(400).json({ error: 'Card event verification or reconciliation failed' }); }
});

/**
 * POST /api/payments/webhook
 *
 * Provider payment webhook for LIVE coin purchases. This is the ONLY path that
 * credits coins for a live payment:
 *
 *   - AUTHENTICATED: HMAC-SHA256 signature over the raw request body using
 *     VANTA_COIN_PAYMENT_WEBHOOK_SECRET (constant-time compare).
 *   - REPLAY-SAFE: eventId uniqueness is enforced by the WebhookEvent table.
 *   - IDEMPOTENT: an already-completed order or an already-used transaction
 *     hash can never credit coins twice.
 *   - TRANSACTION-SAFE: crediting + ledger + status flip happen atomically.
 *
 * This endpoint deliberately does NOT require a user session — the provider
 * authenticates via HMAC. It must be reachable by the payment provider, so it
 * lives outside the JWT-protected wallet router.
 */
router.post('/webhook', rateLimiter.coinWebhook, (_req: Request, res: Response) => {
  res.status(503).json({ code: 'PURCHASES_UNDER_MAINTENANCE', error: 'Crypto coin purchases are temporarily disabled.' });
});



export default router;