import { automaticTreasuryConfig, positiveAtomic } from '../config/shop-treasury-auto.config';
describe('Automatic treasury release gate', () => {
  const old = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'production', VANTA_COIN_PAYMENT_MODE: 'live',
      VANTA_TREASURY_AUTO_ENABLED: 'true', VANTA_TREASURY_CUSTODY_VERIFIED: 'true',
      VANTA_TREASURY_AUTO_NOT_BEFORE: '2020-01-01T00:00:00Z',
      VANTA_TREASURY_SIGNER_POLICY_ID: 'policy_example',
      VANTA_TREASURY_SIGNER_HMAC_SECRET: 'x'.repeat(40),
      VANTA_TREASURY_SIGNER_URL: 'https://custody.example.test',
      VANTA_TREASURY_AUTO_MAX_ORDER_CENTS: '5000', VANTA_TREASURY_AUTO_DAILY_CAP_CENTS: '100000',
      VANTA_TREASURY_AUTO_NETWORKS: 'usdt-bep20',
      VANTA_TREASURY_BSC_ADDRESS: '0x' + 'a'.repeat(40), VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES: '0x' + 'b'.repeat(40),
      VANTA_TREASURY_BSC_MAX_FEE_WEI: '1000000000000000',
    });
  });
  afterEach(() => { process.env = { ...old }; });
  test('requires the explicit custody, policy, destination and amount limits', () => {
    expect(automaticTreasuryConfig()?.networks[0]).toMatchObject({ network: 'usdt-bep20', destination: '0x' + 'a'.repeat(40) });
    for (const key of ['VANTA_TREASURY_AUTO_ENABLED','VANTA_TREASURY_CUSTODY_VERIFIED','VANTA_TREASURY_AUTO_NOT_BEFORE','VANTA_TREASURY_SIGNER_POLICY_ID','VANTA_TREASURY_SIGNER_HMAC_SECRET','VANTA_TREASURY_BSC_MAX_FEE_WEI']) {
      const value = process.env[key]; delete process.env[key];
      expect(automaticTreasuryConfig()).toBeNull();
      process.env[key] = value;
    }
  });
  test('rejects unverified rails, HTTP endpoints and wrong limits', () => {
    process.env.VANTA_TREASURY_AUTO_NETWORKS = 'gram-ton';
    expect(automaticTreasuryConfig()).toBeNull();
    process.env.VANTA_TREASURY_AUTO_NETWORKS = 'usdt-bep20';
    process.env.VANTA_TREASURY_SIGNER_URL = 'http://custody.example.test';
    expect(automaticTreasuryConfig()).toBeNull();
    process.env.VANTA_TREASURY_SIGNER_URL = 'https://custody.example.test';
    process.env.VANTA_TREASURY_AUTO_DAILY_CAP_CENTS = '1';
    expect(automaticTreasuryConfig()).toBeNull();
  });
  test('rejects noninteger and overflowing atomic values', () => {
    for (const value of ['0','-1','0.1','01','1e18','9'.repeat(78)]) expect(positiveAtomic(value)).toBe(false);
    expect(positiveAtomic('1000000')).toBe(true);
  });
});
