import { describe, expect, it } from 'vitest';
import type { AdminWithdrawal } from './adminApi';
import { withdrawalActions, canSubmitWithdrawalAction } from './withdrawalReview';

const pending: AdminWithdrawal = {
  id: 'withdrawal-test', userId: 'synthetic-user', amount: 100, fee: 10, netAmount: 90,
  method: 'USDT_BEP20', currency: 'USDT', cryptoNetwork: 'BNB_SMART_CHAIN',
  walletAddress: '0x' + 'a'.repeat(40), status: 'PENDING', transactionHash: null,
  processedBy: null, processedAt: null, createdAt: '2026-01-01T00:00:00Z',
};
describe('withdrawal review UI guards', () => {
  it('only permits reserve or reject on a clean pending request', () => {
    expect(withdrawalActions(pending)).toEqual(['reserve','reject']);
    expect(withdrawalActions({ ...pending, transactionHash: '' })).toEqual([]);
    expect(withdrawalActions({ ...pending, processedBy: 'legacy-admin' })).toEqual([]);
    expect(withdrawalActions({ ...pending, netAmount: 91 })).toEqual([]);
  });
  it('permits only settlement for a clean reserved request', () => {
    expect(withdrawalActions({ ...pending, status: 'PAYOUT_RESERVED', processedBy: 'admin' })).toEqual(['settle']);
    expect(withdrawalActions({ ...pending, status: 'PAYOUT_RESERVED' })).toEqual([]);
  });
  it('keeps unknown, legacy and final statuses read only', () => {
    for (const status of ['PROCESSING','APPROVED','COMPLETED','FAILED','CANCELLED','UNKNOWN']) {
      expect(withdrawalActions({ ...pending, status })).toEqual([]);
    }
  });
  it('requires exact ID and affirmative review plus evidence appropriate to the action', () => {
    expect(canSubmitWithdrawalAction(pending,'reserve',pending.id,true,'')).toBe(true);
    expect(canSubmitWithdrawalAction(pending,'reserve','wrong',true,'')).toBe(false);
    expect(canSubmitWithdrawalAction(pending,'reserve',pending.id,false,'')).toBe(false);
    expect(canSubmitWithdrawalAction(pending,'reject',pending.id,true,'short')).toBe(false);
    expect(canSubmitWithdrawalAction(pending,'reject',pending.id,true,'Reconciled; no payout')).toBe(true);
    expect(canSubmitWithdrawalAction(pending,'settle',pending.id,true,'0x'+'b'.repeat(64))).toBe(false);
    const reserved = { ...pending, status: 'PAYOUT_RESERVED', processedBy: 'admin' };
    expect(canSubmitWithdrawalAction(reserved,'settle',pending.id,true,'invalid')).toBe(false);
    expect(canSubmitWithdrawalAction(reserved,'settle',pending.id,true,'0x'+'b'.repeat(64))).toBe(true);
    expect(canSubmitWithdrawalAction(reserved,'reject',pending.id,true,'Reconciled; no payout')).toBe(false);
  });
});
