import { createHmac, timingSafeEqual } from 'node:crypto';

/** Authenticate the exact body bytes. No compatibility fallback to raw SHA256. */
export function verifyPaymentWebhookSignature(rawBody: string, signature: unknown, secret: string): boolean {
  if (!secret || typeof rawBody !== 'string' || typeof signature !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
