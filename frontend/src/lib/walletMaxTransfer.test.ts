// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { calculateTransferFee, maxTransferableCoins } from './wallet';

describe('fee-aware transfer maximum', () => {
  it.each([0, 1, 2, 19, 20, 21, 100, 105, 13263, 1_000_000])('respects the wallet balance of %i', balance => {
    const amount = maxTransferableCoins(balance);
    expect(amount + calculateTransferFee(amount)).toBeLessThanOrEqual(balance);
    expect(amount + 1 + calculateTransferFee(amount + 1)).toBeGreaterThan(balance);
  });
  it('does not permit invalid balances', () => {
    for (const value of [-1, NaN, Infinity, 1.5]) expect(maxTransferableCoins(value)).toBe(0);
  });
});