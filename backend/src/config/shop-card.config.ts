import { shopSandboxEnabled } from './shop-sandbox.config';
export function shopCardEnabled(): boolean {
  return shopSandboxEnabled() && process.env.VANTA_SHOP_CARD_TEST_ENABLED === 'true'
    && /^sk_test_[A-Za-z0-9]+$/.test(process.env.VANTA_SHOP_STRIPE_SECRET_KEY || '')
    && /^whsec_[A-Za-z0-9]+$/.test(process.env.VANTA_SHOP_STRIPE_WEBHOOK_SECRET || '');
}
