import { prisma } from '../prisma';
import { assertVerifiedInvoice } from '../services/shop-treasury.service';
import { blockchainTxVerifier } from '../services/blockchain-verifier.service';
import { automaticTreasuryConfig } from '../config/shop-treasury-auto.config';
import { requestCustody, SignerConfig } from '../services/shop-treasury-signer.service';
import { processTreasurySettlement, buildSettlementIntent } from '../services/shop-treasury-auto.service';

jest.mock('../prisma', () => ({ prisma: {
  shopTreasuryTransfer: { updateMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), aggregate: jest.fn() },
  shopCryptoInvoice: { findUnique: jest.fn() },
  $queryRaw: jest.fn(), $transaction: jest.fn(),
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
  orderAmountCents: 100,
  invoice: { id: 'invoice-1', product: 'coins', orderId: 'order-1', createdAt: new Date(Date.now()-60000), expiresAt: new Date(Date.now()+600000), startBlock: 1, address: source, network: 'usdt-bep20', amountAtomic: '1000000000000000000', transactionHash: incoming },
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

describe('Automatic treasury first dispatch', () => {
  let state: any;
  let calls: string[];
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.resetAllMocks();
    state = { ...row, status: 'AUTO_QUEUED', dispatchStartedAt: null, dispatchDeadline: null, transactionHash: null };
    calls = [];
    (automaticTreasuryConfig as jest.Mock).mockReturnValue(config);
    (assertVerifiedInvoice as jest.Mock).mockResolvedValue({ amount: 1 });
    (blockchainTxVerifier.verifyTransaction as jest.Mock).mockResolvedValue({ verified: true });
    (prisma.shopTreasuryTransfer.findUnique as jest.Mock).mockImplementation(async () => ({ ...state }));
    (prisma.shopTreasuryTransfer.findFirst as jest.Mock).mockResolvedValue({ id: row.id });
    (prisma.shopTreasuryTransfer.aggregate as jest.Mock).mockResolvedValue({ _sum: { orderAmountCents: 0 } });
    (prisma.shopCryptoInvoice.findUnique as jest.Mock).mockImplementation(async args => args.where.address ? null : state.invoice);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    (prisma.$transaction as jest.Mock).mockImplementation(async cb => {
      const snapshot = { ...state };
      try { return await cb(prisma); } catch (e) { state = snapshot; throw e; }
    });
    (prisma.shopTreasuryTransfer.updateMany as jest.Mock).mockImplementation(async args => {
      if (typeof args.where.status === 'string' && args.where.status !== state.status) return { count: 0 };
      if (args.where.dispatchStartedAt === null && state.dispatchStartedAt !== null) return { count: 0 };
      if (args.where.leaseToken && args.where.leaseToken !== state.leaseToken) return { count: 0 };
      Object.assign(state, args.data);
      return { count: 1 };
    });
    global.fetch = jest.fn(async (_url, init) => {
      const method = JSON.parse(String(init?.body)).method;
      const values: Record<string, string> = { eth_chainId: '0x38', eth_call: '0xde0b6b3a7640000', eth_getCode: '0x', eth_getBalance: '0x1000000', eth_estimateGas: '0x5208', eth_gasPrice: '0x1' };
      if (!(method in values)) throw new Error('Unexpected RPC');
      return { ok: true, json: async () => ({ result: values[method] }) } as Response;
    }) as typeof fetch;
    (requestCustody as jest.Mock).mockImplementation(async (_cfg, _intent, operation) => {
      calls.push(operation);
      expect(state.status).toBe('AUTO_DISPATCHING');
      if (operation === 'submit') throw new Error('Connection lost after submission');
      return { status: 'broadcast', transactionHash: outgoing };
    });
  });
  afterEach(() => { global.fetch = originalFetch; });
  test('persists dispatch before submitting; lost response recovers by GET only', async () => {
    await processTreasurySettlement(row.id, config);
    expect(state.status).toBe('AUTO_DISPATCHING');
    expect(state.dispatchStartedAt).toBeInstanceOf(Date);
    expect(calls).toEqual(['submit']);
    await processTreasurySettlement(row.id, config);
    expect(calls).toEqual(['submit', 'status']);
    expect(state.status).toBe('AUTO_CONFIRMING');
    expect(state.transactionHash).toBe(outgoing);
  });
  test('never contacts custody when dispatch cap is exceeded', async () => {
    (prisma.shopTreasuryTransfer.aggregate as jest.Mock).mockResolvedValue({ _sum: { orderAmountCents: config.dailyCapCents } });
    await processTreasurySettlement(row.id, config);
    expect(calls).toEqual([]);
    expect(state.status).toBe('AUTO_QUEUED');
  });
  test('never contacts custody if payment is refunded during preflight', async () => {
    (assertVerifiedInvoice as jest.Mock).mockResolvedValueOnce({ amount: 1 }).mockRejectedValueOnce(new Error('Order refunded'));
    await processTreasurySettlement(row.id, config);
    expect(calls).toEqual([]);
    expect(state.status).toBe('AUTO_QUEUED');
  });
  test('never contacts custody when fees exceed the approved maximum', async () => {
    const goodFetch = global.fetch;
    global.fetch = jest.fn(async (url, init) => JSON.parse(String(init?.body)).method === 'eth_gasPrice'
      ? { ok: true, json: async () => ({ result: '0x1000000' }) } as Response : goodFetch(url, init)) as typeof fetch;
    await processTreasurySettlement(row.id, config);
    expect(calls).toEqual([]);
    expect(state.status).toBe('AUTO_QUEUED');
  });
});
