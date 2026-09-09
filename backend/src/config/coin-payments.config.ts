import * as crypto from 'crypto';

// ============================================================================
// VANTA COIN PURCHASE PAYMENT MODE
// ============================================================================
//
// The Balance "Buy Coins" flow supports two payment modes:
//
//   VANTA_COIN_PAYMENT_MODE=live   Real (production) crypto payments. Requires
//                                  VANTA_COIN_PAYMENT_ADDRESS to be set to the
//                                  exchange deposit address, and coins are only
//                                  credited after a trusted provider webhook /
//                                  on-chain confirmation (never from a
//                                  client-submitted transaction hash).
//
//   VANTA_COIN_PAYMENT_MODE=test   Development / sandbox payment mode. The
//                                  backend acts as its own test payment gateway:
//                                  the client completes a *simulated* payment
//                                  (clearly labelled in the UI, no real funds)
//                                  and must present the order's HMAC simulate
//                                  token, which the backend created and signed
//                                  at order-initialization time. Coins are still
//                                  credited atomically and idempotently through
//                                  the exact same completion path used by live
//                                  payments, so the full purchase flow can be
//                                  exercised safely without real money.
//
// SECURITY: test mode is ONLY honored outside production. Setting
// VANTA_COIN_PAYMENT_MODE=test in a production environment is ignored and the
// API falls back to live mode, so a simulated payment can never credit coins in
// production.
//
// ============================================================================

export const COIN_PAYMENT_MODE = {
  TEST: 'test',
  LIVE: 'live',
} as const;

export type CoinPaymentMode = (typeof COIN_PAYMENT_MODE)['TEST'] | (typeof COIN_PAYMENT_MODE)['LIVE'];

export const COIN_PAYMENT_ORDER_TTL_SECONDS = 30 * 60; // orders expire after 30 minutes

/**
 * Clearly fake BEP-20-shaped address (0x + 40 hex chars) used to render the
 * test payment screen. It is unmistakably not a real deposit address.
 */
export const TEST_MODE_DEPOSIT_ADDRESS = '0x0000000000000000000000000000000000000000';

const TEST_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/** Effective payment mode for coin purchases. */
export function getCoinPaymentMode(): CoinPaymentMode {
  const isProduction = process.env.NODE_ENV === 'production';
  const raw = (process.env.VANTA_COIN_PAYMENT_MODE || '').trim().toLowerCase();
  // Test mode is a developer/sandbox affordance ONLY. A production deployment
  // can never be put into test mode, even if the env var is set.
  if (!isProduction && (raw === COIN_PAYMENT_MODE.TEST || raw === 'sandbox')) {
    return COIN_PAYMENT_MODE.TEST;
  }
  return COIN_PAYMENT_MODE.LIVE;
}

export function isCoinPaymentTestMode(): boolean {
  return getCoinPaymentMode() === COIN_PAYMENT_MODE.TEST;
}

/**
 * The live deposit address buyers are told to send crypto to.
 * Returns null when live payments are not configured (the exact missing
 * configuration callers should surface).
 */
export function getCoinPaymentDepositAddress(): string | null {
  const address = (process.env.VANTA_COIN_PAYMENT_ADDRESS || '').trim();
  return address || null;
}

/** Test-mode deposit address used to render the (fake) payment screen. */
export function getTestPaymentDepositAddress(): string {
  const address = (process.env.VANTA_TEST_PAYMENT_ADDRESS || '').trim();
  if (address && TEST_ADDRESS_REGEX.test(address)) return address;
  return TEST_MODE_DEPOSIT_ADDRESS;
}
// ============================================================================
// TEST PAYMENT SIMULATE TOKEN (HMAC)
// ============================================================================

function getTestPaymentSecret(): string {
  const configured = (process.env.VANTA_COIN_PAYMENT_TEST_SECRET || '').trim();
  if (configured) return configured;
  const fallback = (process.env.JWT_SECRET || '').trim();
  // Dev-only fallback. Test mode is blocked in production, so this shared
  // development secret cannot be used to credit coins in a live environment.
  return fallback || 'vanta-dev-test-payment-secret-do-not-use-in-production';
}

function orderTimestamp(order: { id: string; userId: string; amount: number; createdAt: Date | string }): number {
  const value = order.createdAt;
  return (value instanceof Date ? value.getTime() : new Date(value).getTime()) || Date.now();
}

/**
 * One-time, order-bound simulate token handed to the client when a test payment
 * session is initialized. The token binds the order id, user id, amount, and
 * creation time with the server secret, so a client cannot construct one.
 */
export function createCoinPaymentSimulateToken(order: { id: string; userId: string; amount: number; createdAt: Date | string }): string {
  const data = `${order.id}:${order.userId}:${order.amount}:${orderTimestamp(order)}`;
  return crypto.createHmac('sha256', getTestPaymentSecret()).update(data, 'utf8').digest('hex');
}

/** Constant-time verification of a test payment simulate token. */
export function verifyCoinPaymentSimulateToken(
  order: { id: string; userId: string; amount: number; createdAt: Date | string },
  token?: unknown
): boolean {
  if (typeof token !== 'string' || !token) return false;
  const expected = createCoinPaymentSimulateToken(order);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

/** Returns the list of supported payment networks for the Buy Coins flow. */
export const SUPPORTED_COIN_PAYMENT_NETWORKS: readonly string[] = Object.freeze([
  'usdt-bep20',
  'usdc-base',
]);