// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveWalletSpendable, transferDeductionBudget, maxTransferableCoins, calculateTransferFee } from './wallet';
describe('Balance 2.0 accounting', () => {
  it('excludes locked coins, even against an older backend', () => {
    expect(resolveWalletSpendable({coinBalance: 1000, lockedCoins: 250})).toBe(750);
    expect(resolveWalletSpendable({coinBalance: 1000, lockedCoins: 1200})).toBe(0);
  });
  it('fails closed when reserve data is missing or inconsistent', () => {
    expect(resolveWalletSpendable({coinBalance: 1000})).toBeNull();
    expect(resolveWalletSpendable({coinBalance: 1000, lockedCoins: 250, availableCoins: 1000})).toBeNull();
    expect(resolveWalletSpendable({coinBalance: 1000, lockedCoins: -1})).toBeNull();
  });
  it('applies daily, single transfer and spendable caps including fees', () => {
    const budget = transferDeductionBudget(750, {dailyLimit: 5000, singleTxLimit: 400, dailyRemaining: 300});
    expect(budget).toBe(300);
    const max = maxTransferableCoins(budget);
    expect(max + calculateTransferFee(max)).toBeLessThanOrEqual(300);
    expect(max + 1 + calculateTransferFee(max + 1)).toBeGreaterThan(300);
    expect(transferDeductionBudget(750, null)).toBe(0);
  });
});
