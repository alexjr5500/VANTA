import { shopSandboxEnabled } from '../config/shop-sandbox.config';

describe('shop sandbox gate', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  test('disabled by default', () => {
    process.env.NODE_ENV = 'development';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    delete process.env.VANTA_SHOP_SANDBOX_ENABLED;
    expect(shopSandboxEnabled()).toBe(false);
  });
  test('requires explicit test payment mode', () => {
    process.env.NODE_ENV = 'development';
    process.env.VANTA_SHOP_SANDBOX_ENABLED = 'true';
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    expect(shopSandboxEnabled()).toBe(false);
  });
  test('production cannot enable simulation', () => {
    process.env.NODE_ENV = 'production';
    process.env.VANTA_SHOP_SANDBOX_ENABLED = 'true';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    expect(shopSandboxEnabled()).toBe(false);
  });
  test('explicit isolated sandbox opt-in allows test checkout', () => {
    process.env.NODE_ENV = 'development';
    process.env.VANTA_SHOP_SANDBOX_ENABLED = 'true';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    expect(shopSandboxEnabled()).toBe(true);
  });
});
