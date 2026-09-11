import { Router, Request, Response } from 'express';
import { coinPaymentService, PaymentWebhookError } from '../services/coin-payment.service';
import { rateLimiter } from '../security/rateLimiter';

const router = Router();

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
router.post('/webhook', rateLimiter.coinWebhook, async (req: Request, res: Response) => {
  // Capture the raw body for signature verification. express.json() has already
  // parsed req.body; we reconstruct the exact bytes the provider signed.
  const rawBody = typeof (req as any).rawBody === 'string' ? (req as any).rawBody : JSON.stringify(req.body || {});

  try {
    const result = await coinPaymentService.processPaymentWebhook({
      rawBody,
      signature: req.headers['x-vanta-signature'] || req.headers['x-signature'],
      eventId: req.body?.eventId,
      orderId: req.body?.orderId,
      txHash: req.body?.txHash,
      network: req.body?.network,
      asset: req.body?.asset,
      amount: req.body?.amount,
      status: req.body?.status,
      confirmations: req.body?.confirmations,
      confirmedAt: req.body?.confirmedAt,
    });

    // Always acknowledge so the provider stops retrying; the payload tells the
    // provider whether it was a duplicate/ignored/failed result.
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof PaymentWebhookError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    // Never leak internals. The provider will retry; the event is marked FAILED.
    console.error('[PAYMENTS] Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

export default router;