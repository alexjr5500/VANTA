import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { automaticTreasuryConfig, positiveAtomic } from '../config/shop-treasury-auto.config';

export type SignerConfig = NonNullable<ReturnType<typeof automaticTreasuryConfig>>;
export type SettlementIntent = {
  requestId: string; policyId: string; network: string; chainId: number; tokenContract: string;
  source: string; destination: string; amountAtomic: string; maxFeeAtomic: string;
  incomingTransactionHash: string; expiresAt: string;
};
export type SignerResult = { status: 'accepted' | 'pending' | 'broadcast' | 'rejected' | 'not_found'; transactionHash?: string };

function mac(secret: string, data: string) { return createHmac('sha256', secret).update(data).digest('hex'); }
export function verifySignerResponse(secret: string, nonce: string, raw: string, signature: string | null) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) throw new Error('Signer response not authenticated');
  const expected = mac(secret, 'vanta-treasury-response-v1\n' + nonce + '\n' + raw);
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) throw new Error('Signer response not authenticated');
}
export function validateSignerResult(value: unknown, intent: SettlementIntent, allowNotFound: boolean): SignerResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid signer response');
  const v = value as Record<string, unknown>;
  if (v.requestId !== intent.requestId || v.policyId !== intent.policyId) throw new Error('Signer request binding mismatch');
  if (v.status === 'not_found' && allowNotFound) return { status: 'not_found' };
  if (v.network !== intent.network || v.chainId !== intent.chainId || v.tokenContract !== intent.tokenContract ||
      v.source !== intent.source || v.destination !== intent.destination || v.amountAtomic !== intent.amountAtomic ||
      v.maxFeeAtomic !== intent.maxFeeAtomic || v.incomingTransactionHash !== intent.incomingTransactionHash || v.expiresAt !== intent.expiresAt) throw new Error('Signer transfer binding mismatch');
  if (v.status === 'broadcast') {
    if (typeof v.transactionHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(v.transactionHash) || v.transactionHash.toLowerCase() === intent.incomingTransactionHash.toLowerCase() ||
        !positiveAtomic(v.approvedFeeAtomic) || BigInt(v.approvedFeeAtomic) > BigInt(intent.maxFeeAtomic)) throw new Error('Invalid signer broadcast proof');
    return { status: 'broadcast', transactionHash: v.transactionHash.toLowerCase() };
  }
  if (v.status === 'accepted' || v.status === 'pending' || v.status === 'rejected') {
    if (v.transactionHash != null) throw new Error('Unexpected signer transaction hash');
    return { status: v.status };
  }
  throw new Error('Unknown signer response status');
}
/** The custodian MUST enforce immutable idempotency and sign only policy-allowed
 * transfers, including an all-in native fee cap. No key material enters VANTA. */
export async function requestCustody(config: SignerConfig, intent: SettlementIntent, operation: 'submit' | 'status') {
  if (config.policyId !== intent.policyId) throw new Error('Custody policy changed');
  const path = '/v1/settlements/' + encodeURIComponent(intent.requestId);
  const method = operation === 'submit' ? 'PUT' : 'GET';
  const body = operation === 'submit' ? JSON.stringify(intent) : '';
  const nonce = randomUUID();
  const timestamp = new Date().toISOString();
  const signature = mac(config.secret, ['vanta-treasury-request-v1', method, path, timestamp, nonce, body].join('\n'));
  const response = await fetch(config.origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json', 'X-Vanta-Timestamp': timestamp, 'X-Vanta-Nonce': nonce, 'X-Vanta-Signature': signature, 'Idempotency-Key': intent.requestId },
    ...(body ? { body } : {}),
  });
  const raw = await response.text();
  if (raw.length > 16000) throw new Error('Signer response too large');
  verifySignerResponse(config.secret, nonce, raw, response.headers.get('X-Custody-Signature'));
  if (!response.ok && !(operation === 'status' && response.status === 404)) throw new Error('Custody service unavailable');
  return validateSignerResult(JSON.parse(raw), intent, operation === 'status');
}
