import { getCoinPaymentMode } from './coin-payments.config';

/** Requires an isolated sandbox database; never enabled in production. */
export function shopSandboxEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' &&
    process.env.VANTA_SHOP_SANDBOX_ENABLED === 'true' &&
    getCoinPaymentMode() === 'test';
}
