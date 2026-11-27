// ============================================================================
// BLOCKCHAIN TRANSACTION VERIFIER — INDEPENDENT ON-CHAIN PAYMENT CHECKS
// ============================================================================
//
// The provider webhook authenticates *that a payment pipeline* reported a
// payment, but the wallet address alone (or a client-submitted tx hash) is
// NEVER proof that a payment occurred. This module independently inspects the
// actual on-chain transaction over public EVM JSON-RPC and re-derives the
// payment facts from the chain itself:
//
//   - the transaction exists and was MINED (receipt present, status success);
//   - the transaction ran on the requested network (chainId check, best-effort);
//   - the asset is the expected token (the receipt `to` = the token contract);
//   - the funds went to the OFFICIAL VANTA receiving wallet (Transfer log `to`);
//   - the transferred amount matches the order amount (token decimals aware);
//   - the transaction has at least the required number of confirmations.
//
// On ANY mismatch — or when the chain cannot be queried — verification FAILS
// CLOSED: no coin credit / badge activation can proceed.
//
// No web3 dependency: JSON-RPC is called with the platform `fetch` so the
// deployment surface stays identical to the rest of the backend.
// ============================================================================

import {
  BlockchainNetworkConfig,
  ERC20_TRANSFER_EVENT_SIGNATURE,
  getBlockchainNetwork,
  getMinBlockchainConfirmations,
  getBlockchainAmountToleranceUsd,
  getBlockchainRpcTimeoutMs,
} from '../config/blockchain-networks.config';
import { isValidTransactionHash } from '../config/coin-payments.config';

export const BLOCKCHAIN_VERIFICATION_ERROR_CODES = Object.freeze({
  INVALID_TX_HASH: 'INVALID_TX_HASH',
  UNSUPPORTED_NETWORK: 'UNSUPPORTED_NETWORK',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  TRANSACTION_PENDING: 'TRANSACTION_PENDING',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  WRONG_NETWORK: 'WRONG_NETWORK',
  WRONG_TOKEN: 'WRONG_TOKEN',
  WRONG_RECIPIENT: 'WRONG_RECIPIENT',
  WRONG_SENDER: 'WRONG_SENDER',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  LOW_CONFIRMATIONS: 'LOW_CONFIRMATIONS',
  RPC_UNAVAILABLE: 'RPC_UNAVAILABLE',
  RPC_ERROR: 'RPC_ERROR',
});

const ADDRESS_HEX = /^0x[a-fA-F0-9]{40}$/;

export class BlockchainTxVerificationError extends Error {
  code: string;
  /** True when the failure is transient (RPC/network) and the event may be retried. */
  transient: boolean;
  constructor(code: string, message: string, transient = false) {
    super(message);
    this.name = 'BlockchainTxVerificationError';
    this.code = code;
    this.transient = transient;
  }
}

export interface BlockchainVerificationResult {
  verified: boolean;
  txHash: string;
  network: string;
  chainId: number;
  chainName: string;
  asset: string;
  tokenContract: string;
  recipient: string;
  sender: string | null;
  amount: number;
  confirmations: number;
  blockNumber: number | null;
  blockHash: string | null;
  verifiedAt: string;
}

interface RpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: { code?: number; message?: string } | null;
}
/** Normalize a padded 32-byte log topic/address to `0x` + 40 lowercase hex chars. */
function topicToAddress(topic: string): string {
  const t = (topic || '').trim();
  if (!/^0x[a-fA-F0-9]+$/.test(t)) return t.toLowerCase();
  const stripped = t.slice(2).toLowerCase().replace(/^0+/, '');
  if (stripped.length <= 40) return `0x${stripped.padStart(40, '0')}`;
  return `0x${stripped.slice(stripped.length - 40)}`;
}

/** Parse a 0x-prefixed uint256 into a JS number with micro precision (avoids BigInt-float issues). */
function parseUint256ToNumber(hex: string, decimals: number): number {
  const cleaned = (hex || '').trim();
  if (!/^0x[a-fA-F0-9]+$/.test(cleaned)) return NaN;
  const raw = BigInt(cleaned);
  const divisor = BigInt(10) ** BigInt(Math.max(0, Math.trunc(decimals)));
  const whole = Number(raw / divisor);
  const remainder = raw % divisor;
  const micros = Number((remainder * BigInt(1_000_000)) / divisor);
  return whole + micros / 1_000_000;
}

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POST a JSON-RPC request and return the `result`. Throws
 * BlockchainTxVerificationError(RPC_*) on transport/HTTP/JSON-RPC errors.
 */
async function rpcCall(
  network: BlockchainNetworkConfig,
  method: string,
  params: unknown[],
  timeoutMs: number
): Promise<unknown> {
  let timeoutSignal: AbortSignal | null = null;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    timeoutSignal = AbortSignal.timeout(timeoutMs);
  }

  let response: Response;
  try {
    const init: RequestInit = timeoutSignal ? { signal: timeoutSignal } : {};
    response = await fetch(`${network.rpcUrl}`, {
      ...init,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'vanta-verifier', method, params }),
    });
  } catch (error) {
    throw new BlockchainTxVerificationError(
      BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_UNAVAILABLE,
      `Cannot reach ${network.chainName} RPC: ${error instanceof Error ? error.message : 'network error'}`,
      true
    );
  }

  if (!response || response.status !== 200) {
    throw new BlockchainTxVerificationError(
      BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_UNAVAILABLE,
      `${network.chainName} RPC returned HTTP ${response ? response.status : 'unknown'}`,
      true
    );
  }

  let body: RpcResponse;
  try {
    body = (await response.json()) as RpcResponse;
  } catch (error) {
    throw new BlockchainTxVerificationError(
      BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_ERROR,
      `${network.chainName} RPC returned an invalid JSON response`,
      true
    );
  }

  if (body && body.error) {
    throw new BlockchainTxVerificationError(
      BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_ERROR,
      `${network.chainName} RPC error (${method}): ${body.error.message || 'unknown RPC error'}`,
      true
    );
  }
  return body?.result;
}

function hexToNumber(hex: unknown): number | null {
  if (typeof hex !== 'string' || !hex) return null;
  const parsed = parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : null;
}
export class BlockchainTxVerifier {
  /**
   * Independently verify a real on-chain payment.
   *
   * On success returns the chain-derived payment facts. On ANY mismatch or
   * when the chain cannot be queried, throws `BlockchainTxVerificationError`
   * (never returns "verified" for an unverified transaction).
   */
  async verifyTransaction(options: {
    txHash: unknown;
    network: unknown;
    expectedAmountUsd: number;
    expectedRecipient: string;
    /** Optional treasury/source wallet required for platform withdrawal verification. */
    expectedSender?: string;
    minConfirmations?: number;
    expectedAtomicAmount?: string;
    notBefore?: Date;
    notAfter?: Date;
  }): Promise<BlockchainVerificationResult> {
    const txHash = typeof options.txHash === 'string' ? options.txHash.trim() : '';
    if (!isValidTransactionHash(txHash)) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.INVALID_TX_HASH,
        'Invalid transaction hash shape (expected 0x + 64 hex characters).'
      );
    }
    const network = getBlockchainNetwork(options.network);
    if (!network) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.UNSUPPORTED_NETWORK,
        `Unsupported blockchain network: ${String(options.network)}`
      );
    }
    const recipient = (options.expectedRecipient || '').trim();
    if (!ADDRESS_HEX.test(recipient)) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_RECIPIENT,
        'The expected receiving wallet address is not a valid EVM address.'
      );
    }
    const expectedSender = typeof options.expectedSender === 'string' ? options.expectedSender.trim() : undefined;
    if (expectedSender !== undefined && !ADDRESS_HEX.test(expectedSender)) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_SENDER,
        'The expected payout sender wallet address is not a valid EVM address.'
      );
    }

    const minConfirmations = Math.max(
      1,
      Number.isFinite(options.minConfirmations)
        ? Math.trunc(options.minConfirmations ?? 1)
        : getMinBlockchainConfirmations()
    );
    const tolerance = getBlockchainAmountToleranceUsd();
    const exact = options.expectedAtomicAmount;
    if (exact !== undefined && (!/^[1-9]\d*$/.test(exact) || !options.notBefore || !options.notAfter)) {
      throw new BlockchainTxVerificationError(BLOCKCHAIN_VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH, 'Invalid invoice verification constraints.');
    }
    const amountMatches = (raw: string, numeric: number) => exact !== undefined
      ? /^0x[0-9a-f]+$/i.test(raw) && BigInt(raw) === BigInt(exact)
      : Number.isFinite(numeric) && numeric > 0 && Math.abs(numeric - options.expectedAmountUsd) <= tolerance;
    const timeoutMs = getBlockchainRpcTimeoutMs();
    const identityChainId = hexToNumber(await rpcCall(network, 'eth_chainId', [], Math.min(timeoutMs, 4000)));
    if (identityChainId === null) {
      throw new BlockchainTxVerificationError(BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_ERROR, `Could not verify the ${network.chainName} RPC chain identity.`, true);
    }
    if (identityChainId !== network.chainId) {
      throw new BlockchainTxVerificationError(BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_NETWORK, `Transaction lookup is on chain ${identityChainId}, expected ${network.chainName} (chain ${network.chainId}).`);
    }

    const receipt = await rpcCall(network, 'eth_getTransactionReceipt', [txHash], timeoutMs);
    if (!receipt || typeof receipt !== 'object') {
      const transaction = await rpcCall(network, 'eth_getTransactionByHash', [txHash], timeoutMs);
      if (!transaction || typeof transaction !== 'object') {
        throw new BlockchainTxVerificationError(
          BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_NOT_FOUND,
          `Transaction ${txHash} was not found on ${network.chainName}.`
        );
      }
      const tx = transaction as Record<string, unknown>;
      if (expectedSender && (typeof tx.from !== 'string' || tx.from.toLowerCase() !== expectedSender.toLowerCase())) {
        throw new BlockchainTxVerificationError(
          BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_SENDER,
          'Unmined transaction was not sent by the configured VANTA payout wallet.'
        );
      }
      // A pending transaction is only retryable when it is already a matching
      // token transfer. Never label an unrelated/unverified mempool hash pending.
      if (typeof tx.to !== 'string' || tx.to.toLowerCase() !== network.tokenContract.toLowerCase() ||
          typeof tx.input !== 'string' || !/^0xa9059cbb[0-9a-fA-F]{128}$/.test(tx.input)) {
        throw new BlockchainTxVerificationError(
          BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_TOKEN,
          `Unmined transaction does not call the expected ${network.tokenName} transfer contract.`
        );
      }
      const pendingChainId = hexToNumber(await rpcCall(network, 'eth_chainId', [], Math.min(timeoutMs, 4000)));
      if (pendingChainId !== network.chainId) {
        throw new BlockchainTxVerificationError(
          BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_NETWORK,
          `Transaction lookup is on chain ${pendingChainId ?? 'unknown'}, expected ${network.chainName} (${network.chainId}).`
        );
      }
      const input = tx.input;
      const pendingRecipient = topicToAddress(`0x${input.slice(34, 74)}`);
      const pendingAmount = parseUint256ToNumber(`0x${input.slice(74)}`, network.tokenDecimals);
      if (pendingRecipient.toLowerCase() !== recipient.toLowerCase()) {
        throw new BlockchainTxVerificationError(
          BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_RECIPIENT,
          'Unmined transaction is not directed to the official receiving wallet.'
        );
      }
      if (!amountMatches('0x' + input.slice(74), pendingAmount)) {
        throw new BlockchainTxVerificationError(
          BLOCKCHAIN_VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH,
          `Unmined transaction amount does not match the order amount ${options.expectedAmountUsd}.`
        );
      }
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_PENDING,
        `Matching transaction ${txHash} exists on ${network.chainName} but is awaiting mining/indexing.`
      );
    }
    const receiptObj = receipt as Record<string, unknown>;
    const txBlock = hexToNumber(receiptObj.blockNumber);
    const status = typeof receiptObj.status === 'string' ? receiptObj.status.toLowerCase() : null;

    if (status !== '0x1') {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_FAILED,
        `Transaction ${txHash} has no confirmed successful receipt status.`
      );
    }
    const receiptHash = typeof receiptObj.transactionHash === 'string' ? receiptObj.transactionHash.toLowerCase() : '';
    if (receiptHash !== txHash.toLowerCase()) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_ERROR,
        `The RPC receipt did not match requested transaction ${txHash}.`,
        true
      );
    }
    if (!txBlock) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_PENDING,
        `Transaction ${txHash} is not yet mined on ${network.chainName}.`
      );
    }
// ---- Chain / asset identity -------------------------------------------
    const receiptTo = typeof receiptObj.to === 'string' ? receiptObj.to.toLowerCase() : '';
    if (!receiptTo || receiptTo !== network.tokenContract.toLowerCase()) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_TOKEN,
        `The transaction interacted with contract ${receiptTo}, expected ${network.tokenContract} (${network.tokenName}).`
      );
    }

    // Verify the RPC endpoint is actually serving the configured chain. If the
    // identity check is unavailable, fail closed and let the caller retry.
    const chainId = hexToNumber(await rpcCall(network, 'eth_chainId', [], Math.min(timeoutMs, 4000)));
    if (chainId === null) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_ERROR,
        `Could not verify the ${network.chainName} RPC chain identity.`,
        true
      );
    }
    if (chainId !== network.chainId) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_NETWORK,
        `Transaction ${txHash} is on chain ${chainId}, expected ${network.chainName} (chain ${network.chainId}).`
      );
    }

    // ---- The Transfer event targeting the official receiving wallet --------
    const logs = Array.isArray(receiptObj.logs) ? (receiptObj.logs as Record<string, unknown>[]) : [];
    let transferLog: Record<string, unknown> | null = null;
    for (const log of logs) {
      const topics = Array.isArray(log.topics) ? (log.topics as string[]) : [];
      if (topics.length < 3) continue;
      if (topics[0].toLowerCase() !== ERC20_TRANSFER_EVENT_SIGNATURE.toLowerCase()) continue;
      if (topicToAddress(topics[2]).toLowerCase() !== recipient.toLowerCase()) continue;
      transferLog = log;
      break;
    }

    if (!transferLog) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_RECIPIENT,
        `No ${network.tokenName} transfer to the receiving wallet ${recipient} found in transaction ${txHash}.`
      );
    }
const logAddress = String(transferLog.address || '').toLowerCase();
    if (logAddress !== network.tokenContract.toLowerCase()) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_TOKEN,
        `The transfer log was emitted by ${logAddress}, expected ${network.tokenContract} (${network.tokenName}).`
      );
    }

    const topics = transferLog.topics as string[];
    const sender = topicToAddress(topics[1]);
    if (expectedSender && sender.toLowerCase() !== expectedSender.toLowerCase()) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_SENDER,
        'The USDT transfer was not sent by the configured VANTA payout wallet.'
      );
    }
    if (sender.toLowerCase() === recipient.toLowerCase()) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_RECIPIENT,
        'Self-transfer detected: sender and recipient are the same address.'
      );
    }

    const rawAmount = typeof transferLog.data === 'string' ? transferLog.data : '';
    const amount = parseUint256ToNumber(rawAmount, network.tokenDecimals);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH,
        `Could not parse the transferred ${network.tokenName} amount from transaction ${txHash}.`
      );
    }
    if (!amountMatches(rawAmount, amount)) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH,
        `On-chain ${network.tokenName} amount ${amount} does not match the order amount ${options.expectedAmountUsd} ` +
          `(tolerance ${tolerance}).`
      );
    }
// ---- Confirmations -----------------------------------------------------
    let latestBlock: number | null;
    try {
      latestBlock = hexToNumber(await rpcCall(network, 'eth_blockNumber', [], Math.min(timeoutMs, 4000)));
    } catch (error) {
      if (error instanceof BlockchainTxVerificationError) throw error;
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_UNAVAILABLE,
        `Could not verify the latest block on ${network.chainName}; refusing to assume confirmations.`,
        true
      );
    }
    if (latestBlock === null || latestBlock < txBlock) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_ERROR,
        `The latest block height could not be verified on ${network.chainName}.`,
        true
      );
    }
    const confirmations = latestBlock - txBlock + 1;
    if (confirmations < minConfirmations) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.LOW_CONFIRMATIONS,
        `Transaction ${txHash} has ${confirmations} confirmation(s); ${minConfirmations} required.`
      );
    }

    if (exact !== undefined) {
      const block = await rpcCall(network, 'eth_getBlockByNumber', ['0x' + txBlock.toString(16), false], timeoutMs);
      const canonical = block && typeof block === 'object' ? block as Record<string, unknown> : null;
      const blockTime = hexToNumber(canonical?.timestamp);
      if (!canonical || typeof canonical.hash !== 'string' || typeof receiptObj.blockHash !== 'string' || canonical.hash.toLowerCase() !== receiptObj.blockHash.toLowerCase() || blockTime === null) {
        throw new BlockchainTxVerificationError(BLOCKCHAIN_VERIFICATION_ERROR_CODES.RPC_ERROR, 'Cannot establish canonical invoice payment block.', true);
      }
      const timestamp = blockTime * 1000;
      if (timestamp < options.notBefore!.getTime() || timestamp > options.notAfter!.getTime()) {
        throw new BlockchainTxVerificationError(BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_FAILED, 'Payment falls outside the invoice validity window.');
      }
    }
    return {
      verified: true,
      txHash,
      network: network.id,
      chainId: network.chainId,
      chainName: network.chainName,
      asset: network.tokenName,
      tokenContract: network.tokenContract,
      recipient: recipient.toLowerCase(),
      sender,
      amount,
      confirmations,
      blockNumber: txBlock,
      blockHash: typeof receiptObj.blockHash === 'string' ? receiptObj.blockHash : null,
      verifiedAt: new Date().toISOString(),
    };
  }

  /** Retry helper used by webhook paths to honor RPC backoff (transient failures only). */
  async withRetry<T>(
    fn: () => Promise<T>,
    options: { maxAttempts?: number; baseDelayMs?: number } = {}
  ): Promise<T> {
    const maxAttempts = Math.max(1, Math.min(5, options.maxAttempts || 3));
    const baseDelayMs = Math.max(100, options.baseDelayMs || 500);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!(error instanceof BlockchainTxVerificationError) || !error.transient) throw error;
        if (attempt < maxAttempts) await sleepMs(baseDelayMs * attempt);
      }
    }
    throw lastError;
  }
}

export const blockchainTxVerifier = new BlockchainTxVerifier();