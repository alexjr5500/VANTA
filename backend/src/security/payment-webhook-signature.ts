import { createHmac, timingSafeEqual } from 'node:crypto';

/** Authenticate the exact body bytes. No compatibility fallback to raw SHA256. */
export function verifyPaymentWebhookSignature(rawBody: string, signature: unknown, secret: string): boolean {
  if (!secret || typeof rawBody !== 'string' || typeof signature !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/** Bind every business field to the authenticated body. Optional fields may
 * be omitted by an internal caller but cannot be supplied unsigned.
 * Never spread arbitrary body keys onto service options. */
export function paymentWebhookFieldsMatch(rawBody: string, input: {
  eventId?: unknown; orderId?: unknown; txHash?: unknown; network?: unknown;
  asset?: unknown; amount?: unknown; status?: unknown; confirmations?: unknown;
  confirmedAt?: unknown; recipient?: unknown;
}): boolean {
  if (Buffer.byteLength(rawBody, 'utf8') > 100_000) return false;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const body = parsed as Record<string, unknown>;
    const required = ['eventId', 'orderId', 'txHash', 'network', 'asset', 'amount', 'status'] as const;
    const optional = ['confirmations', 'confirmedAt', 'recipient'] as const;
    return required.every(key => Object.is(body[key], input[key])) &&
      optional.every(key => input[key] === undefined || Object.is(body[key], input[key]));
  } catch {
    return false;
  }
}
