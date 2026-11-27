import { shopCardEnabled } from '../config/shop-card.config';

describe('Stripe card sandbox release gate', () => {
  const old = { ...process.env };
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    process.env.VANTA_SHOP_SANDBOX_ENABLED = 'true';
    process.env.VANTA_SHOP_CARD_TEST_ENABLED = 'true';
    process.env.VANTA_SHOP_STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
    process.env.VANTA_SHOP_STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
  });
  afterEach(() => { process.env = { ...old }; });
  test('allows only explicitly configured isolated test mode', () => {
    expect(shopCardEnabled()).toBe(true);
    delete process.env.VANTA_SHOP_CARD_TEST_ENABLED;
    expect(shopCardEnabled()).toBe(false);
  });
  test('rejects production even with test credentials', () => {
    process.env.NODE_ENV = 'production';
    expect(shopCardEnabled()).toBe(false);
  });
  test('rejects live Stripe key', () => {
    process.env.VANTA_SHOP_STRIPE_SECRET_KEY = 'sk_live_' + 'x'.repeat(24);
    expect(shopCardEnabled()).toBe(false);
  });
  test('rejects missing webhook secret', () => {
    delete process.env.VANTA_SHOP_STRIPE_WEBHOOK_SECRET;
    expect(shopCardEnabled()).toBe(false);
  });
  test('rejects live wallet mode', () => {
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    expect(shopCardEnabled()).toBe(false);
  });
});
