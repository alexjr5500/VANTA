import {
  VANTA_COIN_PACKAGES,
  VANTA_COINS_PER_USD,
  TRANSFER_FEE_RATE,
  calculateTransferFee,
  coinsToUsd,
} from '../config/wallet.config';

describe('wallet monetary configuration', () => {
  it.each([
    [100, 1], [500, 5], [1_000, 10], [5_000, 50],
    [10_000, 100], [25_000, 250], [50_000, 500],
  ])('converts %i VANTA Coins to $%i', (coins, usd) => {
    expect(coinsToUsd(coins)).toBe(usd);
  });

  it('keeps every base package at the canonical 100 coins per USD rate', () => {
    expect(VANTA_COINS_PER_USD).toBe(100);
    for (const coinPackage of VANTA_COIN_PACKAGES) {
      expect(coinPackage.coins / coinPackage.price).toBe(VANTA_COINS_PER_USD);
    }
  });

  it('charges a rounded-up 5% transfer fee', () => {
    expect(TRANSFER_FEE_RATE).toBe(0.05);
    expect(calculateTransferFee(100)).toBe(5);
    expect(calculateTransferFee(101)).toBe(6);
    expect(calculateTransferFee(1_000)).toBe(50);
  });
});