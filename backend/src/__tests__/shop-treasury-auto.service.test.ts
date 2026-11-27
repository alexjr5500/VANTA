import { prisma } from '../prisma';
import { automaticTreasuryConfig } from '../config/shop-treasury-auto.config';
import { requestCustody, SignerConfig } from '../services/shop-treasury-signer.service';
import { processTreasurySettlement, buildSettlementIntent } from '../services/shop-treasury-auto.service';

jest.mock('../prisma', () => ({ prisma: {
  shopTreasuryTransfer: { updateMany: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock('../security/auditLog', () => ({ appendAuditLog: jest.fn() }));
jest.mock('../services/shop-treasury.service', () => ({ assertVerifiedInvoice: jest.fn() }));
jest.mock('../services/blockchain-verifier.service', () => ({
  blockchainTxVerifier: { verifyTransaction: jest.fn() },
  BlockchainTxVerificationError: Error,
}));
jest.mock('../config/shop-treasury-auto.config', () => ({
  automaticTreasuryConfig: jest.fn(),
  isAutoNetwork: (n: string) => n === 'usdt-bep20',
  positiveAtomic: (n: unknown) => typeof n === 'string' && /^[1-9][0-9]*$/.test(n),
}));
jest.mock('../services/shop-treasury-signer.service', () => ({ requestCustody: jest.fn() }));

const source = '0x' + 'b'.repeat(40), destination = '0x' + 'c'.repeat(40);
const incoming = '0x' + 'd'.repeat(64), outgoing = '0x' + 'e'.repeat(64);
const config: SignerConfig = { origin: 'https://custody.example.test', policyId: 'policy_test', secret: 'x'.repeat(40), maxOrderCents: 5000, dailyCapCents: 100000, networks: [{ network: 'usdt-bep20', destination, maxFeeAtomic: '1000000' }] };
let lease = '';
const row = {
  id: 'transfer-1', invoiceId: 'invoice-1', network: 'usdt-bep20', source, destination, amountAtomic: '1000000000000000000',
  automation: true, signerPolicyId: config.policyId, maxFeeAtomic: '1000000', signerRequestId: 'request-1',
  status: 'AUTO_DISPATCHING', dispatchStartedAt: new Date(), dispatchDeadline: new Date(Date.now()+600000),
  invoice: { id: 'invoice-1', address: source, network: 'usdt-bep20', amountAtomic: '1000000000000000000', transactionHash: incoming },
};
describe('Automatic treasury recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lease = '';
    (automaticTreasuryConfig as jest.Mock).mockReturnValue(config);
    (prisma.shopTreasuryTransfer.updateMany as jest.Mock).mockImplementation(async args => {
      if (args.data.leaseToken && args.data.leaseUntil) lease = args.data.leaseToken;
      return { count: 1 };
    });
    (prisma.shopTreasuryTransfer.findUnique as jest.Mock).mockImplementation(async () => ({ ...row, leaseToken: lease }));
    (prisma.$transaction as jest.Mock).mockImplementation(async cb => cb(prisma));
  });
  test('immutable transfer fields cannot be changed after authorization', () => {
    expect(buildSettlementIntent(row as any, config)).toMatchObject({ source, destination, incomingTransactionHash: incoming });
    expect(() => buildSettlementIntent({ ...row, destination: source } as any, config)).toThrow();
    expect(() => buildSettlementIntent({ ...row, amountAtomic: '1' } as any, config)).toThrow();
    expect(() => buildSettlementIntent({ ...row, signerPolicyId: 'different' } as any, config)).toThrow();
  });
  test('does not process if another worker owns the lease', async () => {
    (prisma.shopTreasuryTransfer.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    await processTreasurySettlement(row.id, config);
    expect(requestCustody).not.toHaveBeenCalled();
    expect(prisma.shopTreasuryTransfer.findUnique).not.toHaveBeenCalled();
  });
  test('restart in dispatching state only performs status lookup', async () => {
    (requestCustody as jest.Mock).mockResolvedValue({ status: 'not_found' });
    await processTreasurySettlement(row.id, config);
    expect(requestCustody).toHaveBeenCalledTimes(1);
    expect(requestCustody).toHaveBeenCalledWith(config, expect.objectContaining({ requestId: 'request-1' }), 'status');
    expect(prisma.shopTreasuryTransfer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastFailure: expect.stringContaining('no automatic resubmission') }) }));
  });
  test('a custody broadcast enters confirmation, not verified', async () => {
    (requestCustody as jest.Mock).mockResolvedValue({ status: 'broadcast', transactionHash: outgoing });
    await processTreasurySettlement(row.id, config);
    expect(prisma.shopTreasuryTransfer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'AUTO_CONFIRMING', transactionHash: outgoing }) }));
    expect(prisma.shopTreasuryTransfer.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'VERIFIED' }) }));
  });
  test('does not call custody when halted', async () => {
    (automaticTreasuryConfig as jest.Mock).mockReturnValue(null);
    await processTreasurySettlement(row.id, config);
    expect(requestCustody).not.toHaveBeenCalled();
  });
});
