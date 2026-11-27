import { shopCryptoAddresses, shopLiveCryptoEnabled } from '../config/shop-crypto.config';
import { getCoinPaymentDepositAddress } from '../config/coin-payments.config';
import { getBadgePaymentDepositAddress } from '../config/verification-badge.config';

describe('shop crypto configuration', () => {
  const old = { ...process.env };
  const address = '0x' + 'd'.repeat(40);
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.VANTA_COIN_PAYMENT_MODE = 'live';
    process.env.VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES = address;
    delete process.env.VANTA_SHOP_LIVE_CRYPTO_ENABLED;
  });
  afterEach(() => { process.env = { ...old }; });
  test('disabled unless explicitly opted in', () => {
    expect(shopLiveCryptoEnabled()).toBe(false);
    process.env.VANTA_SHOP_LIVE_CRYPTO_ENABLED = 'true';
    expect(shopLiveCryptoEnabled()).toBe(true);
  });
  test('refuses shared treasury, zero and invalid addresses', () => {
    process.env.VANTA_SHOP_LIVE_CRYPTO_ENABLED = 'true';
    for (const bad of [getCoinPaymentDepositAddress(), getBadgePaymentDepositAddress(), '0x' + '0'.repeat(40), 'invalid']) {
      process.env.VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES = address + ',' + bad;
      expect(shopCryptoAddresses()).toEqual([]);
      expect(shopLiveCryptoEnabled()).toBe(false);
    }
  });
  test('normalizes addresses and removes duplicates', () => {
    process.env.VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES = address + ',0x' + 'D'.repeat(40);
    expect(shopCryptoAddresses()).toEqual([address]);
  });
  test('simulation never opens live checkout', () => {
    process.env.NODE_ENV = 'development';
    process.env.VANTA_COIN_PAYMENT_MODE = 'test';
    process.env.VANTA_SHOP_LIVE_CRYPTO_ENABLED = 'true';
    expect(shopLiveCryptoEnabled()).toBe(false);
  });
});
