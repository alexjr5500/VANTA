import {
  blockchainTxVerifier,
  BlockchainTxVerificationError,
  BLOCKCHAIN_VERIFICATION_ERROR_CODES,
} from '../services/blockchain-verifier.service';

// ============================================================================
// INDEPENDENT ON-CHAIN VERIFICATION TESTS
//
// These tests mock the global `fetch` (the verifier speaks JSON-RPC over the
// platform fetch API) and assert that the backend re-derives the payment facts
// from the chain: recipient, token contract, amount, network, confirmations.
// ============================================================================

const TX = '0x' + 'a'.repeat(64);
const OFFICIAL_WALLET = '0x7fa9677c65272d80b06cb0c3a9bbeeba8f95db56';
const USDT_BSC_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
const USDC_BASE_CONTRACT = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b608fc26bd2742204fa22e51d0b52488e1c4bccf45d9b';

const padAddress = (addr: string) => `0x${addr.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;

function makeTransferLog(to: string, amountWei: bigint | number, contract = USDT_BSC_CONTRACT) {
  return {
    address: contract,
    topics: [
      TRANSFER_SIG,
      padAddress('0x' + 'c'.repeat(40)), // from
      padAddress(to),
    ],
    data: `0x${BigInt(amountWei).toString(16)}`,
  };
}

function makeReceipt(overrides: Record<string, unknown> = {}, contract = USDT_BSC_CONTRACT) {
  return {
    blockHash: '0x' + 'f'.repeat(64),
    blockNumber: '0x10', // tx is mined at block 16
    from: '0x' + 'c'.repeat(40),
    to: contract,
    status: '0x1',
    transactionHash: TX,
    logs: [makeTransferLog(OFFICIAL_WALLET, BigInt('199') * (10n ** 16n), contract)],
    ...overrides,
  };
}

type FetchResponse = { status: number; json: () => Promise<{ result?: unknown; error?: { message?: string } | null }> };

/**
 * Install a fake `fetch` that dispatches on the JSON-RPC method name.
 */
function mockRpc(handlers: Record<string, (params: unknown[]) => Promise<unknown> | unknown>): jest.Mock {
  const impl = async (_url: string, init: RequestInit): Promise<FetchResponse> => {
    const payload = JSON.parse(String(init.body));
    const handler = handlers[payload.method];
    if (!handler) {
      return { status: 200, json: async () => ({ error: { message: `method not found: ${payload.method}` } }) };
    }
    try {
      const result = await handler(payload.params);
      return { status: 200, json: async () => ({ result }) };
    } catch (error) {
      return { status: 200, json: async () => ({ error: { message: error instanceof Error ? error.message : 'rpc error' } }) };
    }
  };
  const mock = jest.fn(impl);
  globalThis.fetch = mock;
  return mock;
}

function defaultHandlers(): Record<string, (params: unknown[]) => unknown> {
  return {
    eth_getTransactionReceipt: () => makeReceipt(),
    eth_chainId: () => '0x38', // BSC chainId 56
    eth_blockNumber: () => '0x14', // latest block 20 -> confirmations 5
  };
}

describe('BlockchainTxVerifier.verifyTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
  });

  test('verifies a genuine USDT BEP-20 transfer to the official wallet', async () => {
    mockRpc(defaultHandlers());
    const result = await blockchainTxVerifier.verifyTransaction({
      txHash: TX,
      network: 'usdt-bep20',
      expectedAmountUsd: 1.99,
      expectedRecipient: OFFICIAL_WALLET,
    });
    expect(result.verified).toBe(true);
    expect(result.recipient).toBe(OFFICIAL_WALLET.toLowerCase());
    expect(result.asset).toBe('USDT');
    expect(result.amount).toBeCloseTo(1.99, 4);
    expect(result.confirmations).toBe(5);
    expect(result.chainId).toBe(56);
  });

  test('verifies a genuine USDC Base transfer honoring 6-decimal token values', async () => {
    mockRpc({
      eth_getTransactionReceipt: () =>
        makeReceipt(
          { logs: [makeTransferLog(OFFICIAL_WALLET, 1_990_000, USDC_BASE_CONTRACT)] },
          USDC_BASE_CONTRACT
        ),
      eth_chainId: () => '0x2105', // Base chainId 8453
      eth_blockNumber: () => '0x14',
    });
    const result = await blockchainTxVerifier.verifyTransaction({
      txHash: TX,
      network: 'usdc-base',
      expectedAmountUsd: 1.99,
      expectedRecipient: OFFICIAL_WALLET,
    });
    expect(result.verified).toBe(true);
    expect(result.asset).toBe('USDC');
    expect(result.amount).toBeCloseTo(1.99, 4);
    expect(result.chainId).toBe(8453);
  });

  test('rejects an invalid transaction hash shape', async () => {
    mockRpc(defaultHandlers());
    await expect(
      blockchainTxVerifier.verifyTransaction({
        txHash: 'not-a-hash',
        network: 'usdt-bep20',
        expectedAmountUsd: 1.99,
        expectedRecipient: OFFICIAL_WALLET,
      })
    ).rejects.toMatchObject({ code: BLOCKCHAIN_VERIFICATION_ERROR_CODES.INVALID_TX_HASH });
  });

  test('rejects an unsupported network', async () => {
    mockRpc(defaultHandlers());
    await expect(
      blockchainTxVerifier.verifyTransaction({
        txHash: TX,
        network: 'solana-mainnet',
        expectedAmountUsd: 1.99,
        expectedRecipient: OFFICIAL_WALLET,
      })
    ).rejects.toMatchObject({ code: BLOCKCHAIN_VERIFICATION_ERROR_CODES.UNSUPPORTED_NETWORK });
  });

  test('rejects a transfer to the WRONG recipient', async () => {
    mockRpc({
      ...defaultHandlers(),
      eth_getTransactionReceipt: () => makeReceipt({ logs: [makeTransferLog('0x' + 'e'.repeat(40), BigInt('199') * (10n ** 16n))] }),
    });
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect(error).toBeInstanceOf(BlockchainTxVerificationError);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_RECIPIENT);
  });

  test('rejects a transfer in the WRONG token contract', async () => {
    mockRpc({
      ...defaultHandlers(),
      eth_getTransactionReceipt: () =>
        makeReceipt({ to: '0x' + 'b'.repeat(40) }, '0x' + 'b'.repeat(40)),
    });
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_TOKEN);
  });

  test('rejects an AMOUNT MISMATCH against the audited order amount', async () => {
    mockRpc({
      ...defaultHandlers(),
      eth_getTransactionReceipt: () =>
        makeReceipt({ logs: [makeTransferLog(OFFICIAL_WALLET, BigInt('500') * (10n ** 16n))] }), // $5.00 vs $1.99
    });
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH);
  });

  test('rejects a FAILED on-chain transaction (receipt status 0x0)', async () => {
    mockRpc({ ...defaultHandlers(), eth_getTransactionReceipt: () => makeReceipt({ status: '0x0' }) });
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_FAILED);
  });

  test('rejects an unknown transaction (no receipt)', async () => {
    mockRpc({ ...defaultHandlers(), eth_getTransactionReceipt: () => null });
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_NOT_FOUND);
  });

  test('rejects a PENDING (unmined) transaction', async () => {
    mockRpc({ ...defaultHandlers(), eth_getTransactionReceipt: () => makeReceipt({ blockHash: null, blockNumber: null, status: null }) });
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_PENDING);
  });

  test('rejects a transaction with insufficient confirmations', async () => {
    mockRpc({
      eth_getTransactionReceipt: () => makeReceipt({ blockNumber: '0x13' }), // tx at block 19
      eth_chainId: () => '0x38',
      eth_blockNumber: () => '0x14', // latest 20 -> confirmations 2
    });
    const error = await blockchainTxVerifier
      .verifyTransaction({
        txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET,
        minConfirmations: 5,
      })
      .catch((err: Error) => err);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.LOW_CONFIRMATIONS);
  });

  test('rejects a transaction observed on the WRONG chain (chainId mismatch)', async () => {
    mockRpc({ ...defaultHandlers(), eth_chainId: () => '0x1a4' }); // 420 — not BSC
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_NETWORK);
  });

  test('fails closed when the RPC is unreachable (transient)', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('connection refused');
    });
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect(error).toBeInstanceOf(BlockchainTxVerificationError);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_UNAVAILABLE);
    expect((error as BlockchainTxVerificationError).transient).toBe(true);
  });

  test('fails closed when the RPC returns an HTTP error (transient)', async () => {
    globalThis.fetch = jest.fn(async () => ({ status: 503, json: async () => ({}) })) as jest.Mock;
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_UNAVAILABLE);
    expect((error as BlockchainTxVerificationError).transient).toBe(true);
  });

  test('fails closed on a JSON-RPC error response (transient)', async () => {
    mockRpc({
      eth_getTransactionReceipt: () => {
        throw new Error('rate limited');
      },
    });
    const error = await blockchainTxVerifier
      .verifyTransaction({ txHash: TX, network: 'usdt-bep20', expectedAmountUsd: 1.99, expectedRecipient: OFFICIAL_WALLET })
      .catch((err: Error) => err);
    expect((error as BlockchainTxVerificationError).code).toBe(BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_ERROR);
    expect((error as BlockchainTxVerificationError).transient).toBe(true);
  });

  test('withRetry retries only transient failures and honors a later success', async () => {
    let attempts = 0;
    const result = await blockchainTxVerifier.withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new BlockchainTxVerificationError(
            BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_UNAVAILABLE,
            'temporary outage',
            true
          );
        }
        return { ok: true };
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    );
    expect(attempts).toBe(3);
    expect(result).toEqual({ ok: true });
  });

  test('withRetry does NOT retry permanent (non-transient) failures', async () => {
    let attempts = 0;
    await expect(
      blockchainTxVerifier.withRetry(
        async () => {
          attempts += 1;
          throw new BlockchainTxVerificationError(BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_RECIPIENT, 'nope');
        },
        { maxAttempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toMatchObject({ code: BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_RECIPIENT });
    expect(attempts).toBe(1);
  });
});