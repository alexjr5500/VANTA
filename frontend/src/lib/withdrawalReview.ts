import type { AdminWithdrawal } from './adminApi';

export type WithdrawalAction = 'reserve' | 'settle' | 'reject';

/** UI policy only; server-side RBAC, ledger and transaction checks remain authoritative. */
export function withdrawalActions(row: AdminWithdrawal): WithdrawalAction[] {
  if (row.transactionHash !== null) return [];
  if (row.method !== 'USDT_BEP20' || row.currency !== 'USDT' || row.cryptoNetwork !== 'BNB_SMART_CHAIN') return [];
  if (!row.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(row.walletAddress)) return [];
  if (![row.amount, row.fee, row.netAmount].every(Number.isFinite) || row.amount <= 0 || row.fee < 0 || row.netAmount <= 0) return [];
  if (Math.abs(row.amount - row.fee - row.netAmount) > 0.005) return [];
  if (row.status === 'PENDING' && row.processedBy === null && row.processedAt === null) return ['reserve', 'reject'];
  if (row.status === 'PAYOUT_RESERVED' && row.processedBy && row.processedAt === null) return ['settle'];
  return [];
}

export function canSubmitWithdrawalAction(row: AdminWithdrawal, action: WithdrawalAction, confirmation: string, reviewed: boolean, evidence: string): boolean {
  if (!withdrawalActions(row).includes(action) || !reviewed || confirmation.trim() !== row.id) return false;
  if (action === 'settle') return /^0x[a-fA-F0-9]{64}$/.test(evidence.trim());
  if (action === 'reject') return evidence.trim().length >= 10 && evidence.trim().length <= 500;
  return true;
}
