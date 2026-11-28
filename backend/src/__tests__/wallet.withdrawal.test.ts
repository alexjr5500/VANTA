/**
 * Withdrawal state machine tests (Phase 9).
 *
 * Guards against: duplicate processing, concurrent rejection (double refund),
 * invalid state transitions, and non-owner cancellation.
 */
import { WalletService } from '../services/wallet.service';
import { blockchainTxVerifier } from '../services/blockchain-verifier.service';
import { prisma } from '../prisma';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('../prisma', () => {
  const mock = {
    wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    user: { findUnique: jest.fn() },
    walletPIN: { findUnique: jest.fn(), updateMany: jest.fn() },
    transferLimit: { create: jest.fn() },
    withdrawal: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    walletTransaction: { create: jest.fn(), updateMany: jest.fn() },
    walletAuditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma: mock };
});

jest.mock('../services/blockchain-verifier.service', () => ({ blockchainTxVerifier: { verifyTransaction: jest.fn() } }));
jest.mock('../security/twoFactorAuth', () => ({ twoFactorAuth: { verifyLogin: jest.fn().mockResolvedValue({ valid: true, isBackupCode: false }) } }));
import { twoFactorAuth } from '../security/twoFactorAuth';
jest.mock('bcryptjs', () => ({ compare: jest.fn().mockResolvedValue(true) }));

jest.mock('../services/notification.service', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue({}), notifyWithdrawalStatus: jest.fn() },
}));

const walletService = new WalletService();

const walletRow: any = {
  id: 'wallet1', userId: 'user1', coinBalance: 0, earningsBalance: 200,
  totalWithdrawn: 0, totalCoinsPurchased: 0, totalCoinsReceived: 0, totalCoinsSent: 0,
  totalGiftsSent: 0, totalGiftsReceived: 0, lifetimeEarnings: 0, bonusCoins: 0,
  lockedCoins: 0, isFrozen: false, usdtWalletAddress: null,
};

const validAddress = `0x${'a'.repeat(40)}`;
const payoutSender = `0x${'c'.repeat(40)}`;
const pendingWithdrawal = { id: 'wd1', userId: 'user1', amount: 100, fee: 10, netAmount: 90, status: 'PENDING', walletAddress: validAddress, transactionHash: null, processedBy: null, method: 'USDT_BEP20', currency: 'USDT', cryptoNetwork: 'BNB_SMART_CHAIN', createdAt: new Date() };
const reservedWithdrawal = { ...pendingWithdrawal, status: 'PAYOUT_RESERVED', processedBy: 'admin1' };
const validTxHash = `0x${'a'.repeat(64)}`;

function txMock() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked-row' }]),
    wallet: {
      update: jest.fn().mockResolvedValue({ ...walletRow, earningsBalance: 100 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn()
        .mockResolvedValueOnce(walletRow)
        .mockResolvedValueOnce({ ...walletRow, earningsBalance: 100 }),
    },
    withdrawal: {
      findUnique: jest.fn().mockResolvedValue(pendingWithdrawal),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'wd1', ...pendingWithdrawal }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(pendingWithdrawal),
    },
    walletTransaction: { count: jest.fn().mockResolvedValue(1), create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    walletAuditLog: { create: jest.fn().mockResolvedValue({ id: 'review1', createdAt: new Date() }), findMany: jest.fn().mockResolvedValue([]) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.VANTA_USDT_WITHDRAWAL_SENDER_ADDRESS = payoutSender;
  (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(walletRow);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ twoFactorEnabled: false });
  (twoFactorAuth.verifyLogin as jest.Mock).mockResolvedValue({ valid: true, isBackupCode: false });
  (prisma.walletPIN.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.walletPIN.findUnique as jest.Mock).mockResolvedValue({ id: 'pin1', walletId: 'wallet1', pinHash: 'hash', failedAttempts: 0, lockedUntil: null });
  (blockchainTxVerifier.verifyTransaction as jest.Mock).mockResolvedValue({ verified: true, txHash: validTxHash, network: 'usdt-bep20', chainId: 56, chainName: 'BNB Smart Chain', asset: 'USDT', tokenContract: '0x' + 'b'.repeat(40), recipient: validAddress, sender: payoutSender, amount: 90, confirmations: 12, blockNumber: 100, blockHash: null, verifiedAt: new Date().toISOString() });
  (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(pendingWithdrawal);
  (prisma.withdrawal.findUniqueOrThrow as jest.Mock).mockResolvedValue(pendingWithdrawal);
});
describe('WalletService.requestWithdrawal', () => {
  test('creates a PENDING withdrawal and debits earnings once', async () => {
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    const result = await walletService.requestWithdrawal('user1', 100, validAddress, '1234');

    expect(result.status).toBe('PENDING');
    expect(tx.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user1', earningsBalance: 200 }) })
    );
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'WITHDRAWAL', currency: 'USD', balanceBefore: 200, balance: 100,
      }),
    }));
    expect(tx.withdrawal.create).toHaveBeenCalledTimes(1);
  });

  test('requires authenticator 2FA for withdrawals when enabled', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
    await expect(walletService.requestWithdrawal('user1', 100, validAddress, '1234'))
      .rejects.toThrow('Authenticator 2FA code is required');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(twoFactorAuth.verifyLogin).not.toHaveBeenCalled();
  });

  test('verifies authenticator 2FA before creating a withdrawal when enabled', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await walletService.requestWithdrawal('user1', 100, validAddress, '1234', '123456');
    expect(twoFactorAuth.verifyLogin).toHaveBeenCalledWith('user1', '123456', true, 'TESTSECRET');
  });

  test('aborts when the earnings balance cannot cover the amount (CAS count 0)', async () => {
    const tx = txMock();
    tx.wallet.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(walletService.requestWithdrawal('user1', 100, validAddress, '1234')).rejects.toThrow('Insufficient earnings balance');
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
  });
});

describe('WalletService.processWithdrawal', () => {
  beforeEach(() => { (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(reservedWithdrawal); });
  test('a second concurrent approval cannot succeed (CAS count 0)', async () => {
    const tx = txMock();
    tx.withdrawal.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(walletService.processWithdrawal('wd1', 'admin1', validTxHash)).rejects.toThrow('Withdrawal can only be completed once');
    expect(tx.walletTransaction.updateMany).not.toHaveBeenCalled();
    expect(tx.walletAuditLog.create).not.toHaveBeenCalled();
  });
});
describe('WalletService.rejectWithdrawal', () => {
  test('rejects a PENDING withdrawal and refunds earnings exactly once', async () => {
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    tx.withdrawal.findUniqueOrThrow.mockResolvedValue({ ...pendingWithdrawal, status: 'FAILED' });
    const result = await walletService.rejectWithdrawal('wd1', 'admin1', 'policy');
    expect(result.status).toBe('FAILED');
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ earningsBalance: { increment: 100 } }) })
    );
  });

  test('does not refund if the pending withdrawal ledger row is missing', async () => {
    const tx = txMock();
    tx.walletTransaction.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(walletService.rejectWithdrawal('wd1', 'admin1', 'policy'))
      .rejects.toThrow('Pending withdrawal ledger entry is missing or already processed');
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  test('a concurrent double-rejection is impossible', async () => {
    const tx = txMock();
    tx.withdrawal.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(walletService.rejectWithdrawal('wd1', 'admin2', 'duplicate')).rejects.toThrow('Withdrawal can only be rejected once');
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  test('does not refund if the pending withdrawal ledger row is missing', async () => {
    const tx = txMock();
    tx.walletTransaction.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));

    await expect(walletService.rejectWithdrawal('wd1', 'admin1', 'policy'))
      .rejects.toThrow('Pending withdrawal ledger entry is missing or already processed');
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.walletAuditLog.create).not.toHaveBeenCalled();
  });
});

describe('WalletService.cancelWithdrawal', () => {
  test('only the owner can cancel', async () => {
    (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(pendingWithdrawal);
    await expect(walletService.cancelWithdrawal('wd1', 'attacker')).rejects.toThrow('only cancel your own');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('cancels a PENDING withdrawal and refunds once', async () => {
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    tx.withdrawal.findUniqueOrThrow.mockResolvedValue({ ...pendingWithdrawal, status: 'CANCELLED' });
    const result = await walletService.cancelWithdrawal('wd1', 'user1');
    expect(result.status).toBe('CANCELLED');
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ earningsBalance: { increment: 100 } }) })
    );
  });

  test('cannot cancel a non-PENDING withdrawal', async () => {
    const tx = txMock();
    tx.withdrawal.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.cancelWithdrawal('wd1', 'user1')).rejects.toThrow('can no longer be cancelled');
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
});

describe('WalletService.processWithdrawal on-chain verification', () => {
  beforeEach(() => { (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(reservedWithdrawal); });
  test('verifies the exact USDT payout before completing the ledger', async () => {
    const tx = txMock();
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await walletService.processWithdrawal('wd1', 'admin1', validTxHash);
    expect(blockchainTxVerifier.verifyTransaction).toHaveBeenCalledWith(expect.objectContaining({
      txHash: validTxHash,
      network: 'usdt-bep20',
      expectedAmountUsd: 90,
      expectedRecipient: validAddress,
      expectedSender: payoutSender,
    }));
    expect(tx.withdrawal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'wd1', status: 'PAYOUT_RESERVED', transactionHash: null, processedBy: 'admin1', userId: 'user1', amount: 100, fee: 10, netAmount: 90, walletAddress: validAddress }),
      data: expect.objectContaining({ status: 'COMPLETED', transactionHash: validTxHash }),
    }));
    expect(tx.walletTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ reference: 'wd1', type: 'WITHDRAWAL', status: 'PENDING' }),
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
  });

  test('fails closed when the authorized payout sender is not configured', async () => {
    delete process.env.VANTA_USDT_WITHDRAWAL_SENDER_ADDRESS;
    await expect(walletService.processWithdrawal('wd1', 'admin1', validTxHash))
      .rejects.toThrow('VANTA_USDT_WITHDRAWAL_SENDER_ADDRESS must be configured');
    expect(blockchainTxVerifier.verifyTransaction).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('does not change balances or ledger when the on-chain verifier rejects the transaction', async () => {
    (blockchainTxVerifier.verifyTransaction as jest.Mock).mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(walletService.processWithdrawal('wd1', 'admin1', validTxHash)).rejects.toThrow('RPC unavailable');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a missing or malformed transaction hash', async () => {
    await expect(walletService.processWithdrawal('wd1', 'admin1', '')).rejects.toThrow('transaction hash is required');
    expect(blockchainTxVerifier.verifyTransaction).not.toHaveBeenCalled();
  });
});

describe('Withdrawal authorization row fencing', () => {
  test('rejects changed 2FA state before reserving earnings', async () => {
    const tx = txMock();
    tx.$queryRaw.mockResolvedValueOnce([]);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.requestWithdrawal('user1', 100, validAddress, '1234')).rejects.toThrow('Authenticator security state changed');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
  });
  test('rejects a changed PIN after locking the authenticator state', async () => {
    const tx = txMock();
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'locked-user' }]).mockResolvedValueOnce([]);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.requestWithdrawal('user1', 100, validAddress, '1234')).rejects.toThrow('PIN security state changed');
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
  });
});

describe('Withdrawal payout reservation', () => {
  test('requires explicit unsent reconciliation before reserving', async () => {
    await expect(walletService.reserveWithdrawalPayout('wd1', 'admin1', false)).rejects.toThrow('Confirm reconciliation');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('reserves one pending request and audits without debiting or sending', async () => {
    const tx = txMock();
    tx.withdrawal.findUniqueOrThrow.mockResolvedValue(reservedWithdrawal);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.reserveWithdrawalPayout('wd1', 'admin1', true)).resolves.toMatchObject({ status: 'PAYOUT_RESERVED' });
    expect(tx.withdrawal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'PENDING', transactionHash: null }), data: { status: 'PAYOUT_RESERVED', processedBy: 'admin1' } }));
    expect(tx.walletAuditLog.create).toHaveBeenCalled();
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(blockchainTxVerifier.verifyTransaction).not.toHaveBeenCalled();
  });
  test('losing reservation race cannot return success', async () => {
    const tx = txMock();
    tx.withdrawal.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.reserveWithdrawalPayout('wd1', 'admin1', true)).rejects.toThrow('reservation already changed');
    expect(tx.walletAuditLog.create).not.toHaveBeenCalled();
  });
  test('missing ledger aborts reservation before audit', async () => {
    const tx = txMock();
    tx.walletTransaction.count.mockResolvedValue(0);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.reserveWithdrawalPayout('wd1', 'admin1', true)).rejects.toThrow('ledger entry is missing');
    expect(tx.walletAuditLog.create).not.toHaveBeenCalled();
  });
  test('cannot complete unreserved payout', async () => {
    await expect(walletService.processWithdrawal('wd1', 'admin1', validTxHash)).rejects.toThrow('must be reserved');
    expect(blockchainTxVerifier.verifyTransaction).not.toHaveBeenCalled();
  });
  test('cannot reject or refund a reserved payout', async () => {
    (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(reservedWithdrawal);
    await expect(walletService.rejectWithdrawal('wd1', 'admin1', 'reason')).rejects.toThrow('Only pending');
    const tx = txMock();
    tx.withdrawal.updateMany.mockResolvedValue({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.cancelWithdrawal('wd1', 'user1')).rejects.toThrow('no longer be cancelled');
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
});

test('historical settlement evidence prevents ordinary rejection', async () => {
  (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue({ ...pendingWithdrawal, transactionHash: validTxHash });
  await expect(walletService.rejectWithdrawal('wd1', 'admin1', 'reason')).rejects.toThrow('without settlement evidence');
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

describe('Withdrawal recovery review (evidence only)', () => {
  const review = { expectedStatus: 'PAYOUT_RESERVED', outcome: 'NO_PAYOUT_FOUND', caseReference: 'case-123', notes: 'Reviewed treasury history; no evidence located.' };
  test('records unverified evidence without moving funds or changing settlement state', async () => {
    const tx = txMock();
    tx.withdrawal.findUniqueOrThrow.mockResolvedValue(reservedWithdrawal);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.recordWithdrawalRecovery('wd1','admin2',review)).resolves.toMatchObject({ observedStatus: 'PAYOUT_RESERVED', independentlyVerified: false, financialActionAuthorized: false });
    expect(tx.walletAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'WITHDRAWAL_RECOVERY_REVIEW' }) }));
    expect(tx.withdrawal.updateMany).not.toHaveBeenCalled();
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.walletTransaction.updateMany).not.toHaveBeenCalled();
    expect(blockchainTxVerifier.verifyTransaction).not.toHaveBeenCalled();
  });
  test('rejects stale observed status before recording evidence', async () => {
    const tx = txMock();
    tx.$queryRaw.mockResolvedValueOnce([]);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.recordWithdrawalRecovery('wd1','admin2',review)).rejects.toThrow('state changed');
    expect(tx.walletAuditLog.create).not.toHaveBeenCalled();
  });
  test('rejects final-state review and missing candidate hash for reported payout', async () => {
    await expect(walletService.recordWithdrawalRecovery('wd1','admin2',{...review,expectedStatus:'COMPLETED'})).rejects.toThrow('Invalid recovery');
    await expect(walletService.recordWithdrawalRecovery('wd1','admin2',{...review,outcome:'PAYOUT_FOUND'})).rejects.toThrow('candidate hash');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('history is scoped to the exact withdrawal and never authorizes finance', async () => {
    const tx = txMock();
    tx.withdrawal.findUnique.mockResolvedValue(reservedWithdrawal);
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: any) => unknown) => cb(tx));
    await expect(walletService.getWithdrawalRecoveryHistory('wd1')).resolves.toEqual({status:'PAYOUT_RESERVED', entries:[], more:false, financialActionAuthorized:false});
    expect(tx.walletAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{userId:'user1',action:'WITHDRAWAL_RECOVERY_REVIEW',details:{startsWith:'{"withdrawalId":"wd1",'}}}));
  });
});
