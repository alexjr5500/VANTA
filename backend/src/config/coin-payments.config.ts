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

/**
 * Explicit purchase-order lifecycle statuses.
 *
 * Conventions:
 *  - PENDING    order created, no payment processed yet — NEVER credits coins
 *  - PROCESSING a verified provider event (webhook) accepted the payment and
 *               the backend is finalizing it (recoverable on retry)
 *  - PAID       payment verified by the provider, credit not yet applied
 *  - COMPLETED  coins have been credited to the buyer (terminal success)
 *  - FAILED     payment failed / was rejected
 *  - EXPIRED    order TTL elapsed before payment was completed
 *  - CANCELLED  buyer/provider cancelled before payment
 *  - REFUNDED   a completed purchase was refunded (original row stays immutable)
 *
 * Only a server-side verified payment may transition an order into
 * PAID/COMPLETED. Coins are NEVER created at order-creation time.
 */
export const COIN_PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;

export type CoinPaymentStatus = (typeof COIN_PAYMENT_STATUS)[keyof typeof COIN_PAYMENT_STATUS];

// Statuses the atomic completion claim will accept (i.e. not yet credited).
export const COIN_PAYMENT_CREDITABLE_STATUSES: readonly string[] = Object.freeze([
  COIN_PAYMENT_STATUS.PENDING,
  COIN_PAYMENT_STATUS.PROCESSING,
  COIN_PAYMENT_STATUS.PAID,
]);

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
// CONFIGURATION VALIDATION (run at server startup)
// ============================================================================

/** A valid EVM wallet address: 0x + 40 hex chars (checksummed addresses OK). */
export function isValidCoinPaymentDepositAddress(address: string): boolean {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

/**
 * A valid EVM transaction hash: 0x + 64 hex chars. Live payment webhooks must
 * present a blockchain transaction hash in this shape before it can even be
 * considered for verification.
 */
export function isValidTransactionHash(hash: string): boolean {
  return typeof hash === 'string' && /^0x[a-fA-F0-9]{64}$/.test(hash.trim());
}

/**
 * Secret used to authenticate provider payment webhooks.
 * If empty, live webhooks are rejected (nothing can be verified), which keeps
 * coin crediting impossible until the deployment is actually configured.
 */
export function getCoinPaymentWebhookSecret(): string {
  return (process.env.VANTA_COIN_PAYMENT_WEBHOOK_SECRET || '').trim();
}

export interface CoinPaymentConfigValidation {
  mode: CoinPaymentMode;
  isTestMode: boolean;
  isProduction: boolean;
  depositAddress: string | null;
  addressValid: boolean;
  webhookSecretConfigured: boolean;
  /** Errors mean LIVE purchases MUST stay disabled. */
  errors: string[];
  /** Warnings are non-fatal but worth surfacing to operators. */
  warnings: string[];
}

/**
 * Validate the coin-payment configuration. This is the single place that
 * decides whether live purchases can operate.
 *
 * Rules:
 *  - test mode is only honored outside production (a production deployment can
 *    never simulate payments), and never requires a deposit address.
 *  - live mode REQUIRES a valid VANTA_COIN_PAYMENT_ADDRESS. If it is missing or
 *    malformed the configuration is in error and live purchases stay disabled —
 *    the app NEVER silently falls back to test mode.
 */
export function validateCoinPaymentConfig(): CoinPaymentConfigValidation {
  const isProduction = process.env.NODE_ENV === 'production';
  const mode = getCoinPaymentMode();
  const depositAddress = getCoinPaymentDepositAddress();
  const addressValid = depositAddress ? isValidCoinPaymentDepositAddress(depositAddress) : false;
  const webhookSecretConfigured = getCoinPaymentWebhookSecret().length > 0;

  const errors: string[] = [];
  const warnings: string[] = [];

  const raw = (process.env.VANTA_COIN_PAYMENT_MODE || '').trim().toLowerCase();

  if (mode === COIN_PAYMENT_MODE.TEST) {
    if (isProduction) {
      errors.push(
        'VANTA_COIN_PAYMENT_MODE=test is not allowed in production (NODE_ENV=production). ' +
          'Set VANTA_COIN_PAYMENT_MODE=live and VANTA_COIN_PAYMENT_ADDRESS to enable live purchases.'
      );
    }
    if (!raw) {
      warnings.push('VANTA_COIN_PAYMENT_MODE is not set; running in test (sandbox) payment mode for development.');
    } else if (raw === COIN_PAYMENT_MODE.LIVE) {
      warnings.push('VANTA_COIN_PAYMENT_MODE=live is set but the runtime is in test mode (not production).');
    }
  } else {
    if (!depositAddress) {
      errors.push(
        'LIVE coin purchases are disabled: VANTA_COIN_PAYMENT_ADDRESS is not configured. ' +
          'Set it to the public receiving wallet address, or run in test mode with VANTA_COIN_PAYMENT_MODE=test (development only).'
      );
    } else if (!addressValid) {
      errors.push(
        'LIVE coin purchases are disabled: VANTA_COIN_PAYMENT_ADDRESS is not a valid EVM address ' +
          '(expected 0x followed by 40 hex characters).'
      );
    }
    if (!webhookSecretConfigured) {
      warnings.push(
        'VANTA_COIN_PAYMENT_WEBHOOK_SECRET is not configured: live payment webhooks will be rejected ' +
          'and no payment can be credited until it is set.'
      );
    }
    if (isProduction && !depositAddress) {
      warnings.push('Production environment is missing VANTA_COIN_PAYMENT_ADDRESS — live purchases remain disabled.');
    }
  }

  return {
    mode,
    isTestMode: mode === COIN_PAYMENT_MODE.TEST,
    isProduction,
    depositAddress,
    addressValid,
    webhookSecretConfigured,
    errors,
    warnings,
  };
}

/**
 * True when the deployment is safe to offer LIVE coin purchases:
 * live (or production-forced) mode + a valid configured deposit address.
 * Test mode is always usable without an address.
 */
export function isLiveCoinPaymentsAvailable(): boolean {
  const config = validateCoinPaymentConfig();
  if (config.isTestMode) return false;
  return config.depositAddress !== null && config.addressValid;
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