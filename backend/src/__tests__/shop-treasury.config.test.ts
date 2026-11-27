import { treasuryAddress, treasuryInstructionsEnabled } from '../config/shop-treasury.config';

describe('Treasury destination gate', () => {
  const old = { ...process.env };
  afterEach(() => { process.env = { ...old }; });
  test('uses explicit destination and rejects invoice address reuse', () => {
    process.env.VANTA_TREASURY_BSC_ADDRESS = '0x' + 'a'.repeat(40);
    process.env.VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES = '0x' + 'b'.repeat(40);
    expect(treasuryAddress('usdt-bep20')).toBe('0x' + 'a'.repeat(40));
    process.env.VANTA_TREASURY_BSC_ADDRESS = '0x' + 'b'.repeat(40);
    expect(treasuryAddress('usdt-bep20')).toBeNull();
  });
  test('rejects malformed, zero, token-contract and unknown network destinations', () => {
    for (const address of ['bad', '0x' + '0'.repeat(40), '0x55d398326f99059ff775485246999027b3197955']) {
      process.env.VANTA_TREASURY_BSC_ADDRESS = address;
      expect(treasuryAddress('usdt-bep20')).toBeNull();
    }
    expect(treasuryAddress('__proto__')).toBeNull();
  });
  test('authorization is opt-in', () => {
    delete process.env.VANTA_TREASURY_INSTRUCTIONS_ENABLED;
    expect(treasuryInstructionsEnabled()).toBe(false);
    process.env.VANTA_TREASURY_INSTRUCTIONS_ENABLED = 'true';
    expect(treasuryInstructionsEnabled()).toBe(true);
  });
});
