import { shopCryptoAddresses, shopLiveCryptoEnabled, shopCryptoNetworks } from '../config/shop-crypto.config';
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

describe('Ethereum shop rail opt-in', () => {
  const old = { ...process.env };
  afterEach(() => { process.env = { ...old }; });
  test('requires explicit switches and HTTPS RPC endpoint', () => {
    delete process.env.VANTA_SHOP_ERC20_ENABLED;
    delete process.env.VANTA_SHOP_NATIVE_ETH_ENABLED;
    process.env.VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES = '0x' + 'd'.repeat(40);
    process.env.VANTA_ETHEREUM_RPC_URL = 'https://rpc.example.test';
    expect(shopCryptoNetworks()).not.toContain('usdt-erc20');
    expect(shopCryptoNetworks()).not.toContain('eth-erc20');
    process.env.VANTA_SHOP_ERC20_ENABLED = 'true';
    expect(shopCryptoNetworks()).toContain('usdt-erc20');
    expect(shopCryptoNetworks()).not.toContain('eth-erc20');
    process.env.VANTA_SHOP_NATIVE_ETH_ENABLED = 'true';
    expect(shopCryptoNetworks()).toContain('eth-erc20');
    process.env.VANTA_ETHEREUM_RPC_URL = 'http://rpc.example.test';
    expect(shopCryptoNetworks()).not.toContain('usdt-erc20');
    expect(shopCryptoNetworks()).not.toContain('eth-erc20');
  });
});

describe('Non-EVM shop opt-in', () => {
  const old = { ...process.env };
  afterEach(() => { process.env = { ...old }; });
  test('TON requires distinct address pool and both provider credentials', () => {
    process.env.VANTA_SHOP_TON_ENABLED = 'true';
    process.env.VANTA_SHOP_TON_DEPOSIT_ADDRESSES = '0:' + 'b'.repeat(64);
    delete process.env.VANTA_TONCENTER_API_KEY;
    delete process.env.VANTA_COINGECKO_DEMO_API_KEY;
    expect(shopCryptoNetworks()).not.toContain('gram-ton');
    process.env.VANTA_TONCENTER_API_KEY = 'test';
    process.env.VANTA_COINGECKO_DEMO_API_KEY = 'test';
    expect(shopCryptoNetworks()).toContain('gram-ton');
    delete process.env.VANTA_SHOP_TON_ENABLED;
    expect(shopCryptoNetworks()).not.toContain('gram-ton');
  });
});
