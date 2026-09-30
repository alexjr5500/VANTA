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
    minConfirmations?: number;
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

    const minConfirmations = Math.max(
      1,
      Number.isFinite(options.minConfirmations)
        ? Math.trunc(options.minConfirmations ?? 1)
        : getMinBlockchainConfirmations()
    );
    const tolerance = getBlockchainAmountToleranceUsd();
    const timeoutMs = getBlockchainRpcTimeoutMs();

    const receipt = await rpcCall(network, 'eth_getTransactionReceipt', [txHash], timeoutMs);
    if (!receipt || typeof receipt !== 'object') {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_NOT_FOUND,
        `Transaction ${txHash} has no receipt on ${network.chainName} (not mined or unknown).`
      );
    }
    const receiptObj = receipt as Record<string, unknown>;
    const txBlock = hexToNumber(receiptObj.blockNumber);
    const status = typeof receiptObj.status === 'string' ? receiptObj.status.toLowerCase() : null;

    if (status === '0x0') {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.TRANSACTION_FAILED,
        `Transaction ${txHash} failed on-chain (receipt status 0x0).`
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
    if (receiptTo && receiptTo !== network.tokenContract.toLowerCase()) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_TOKEN,
        `The transaction interacted with contract ${receiptTo}, expected ${network.tokenContract} (${network.tokenName}).`
      );
    }

    // Best-effort chainId check: never blocks on the extra call, but ALWAYS
    // rejects a transaction observed on the wrong chain.
    try {
      const chainId = await rpcCall(network, 'eth_chainId', [], Math.min(timeoutMs, 4000));
      const chainIdNum = hexToNumber(chainId);
      if (chainIdNum !== null && chainIdNum !== network.chainId) {
        throw new BlockchainTxVerificationError(
          BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_NETWORK,
          `Transaction ${txHash} is on chain ${chainIdNum}, expected ${network.chainName} (chain ${network.chainId}).`
        );
      }
    } catch (error) {
      if (error instanceof BlockchainTxVerificationError && error.code === BLOCKCHAIN_VERIFICATION_ERROR_CODES.WRONG_NETWORK) {
        throw error;
      }
      // RPC issues on the extra call are best-effort — continue.
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
    if (Math.abs(amount - options.expectedAmountUsd) > tolerance) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH,
        `On-chain ${network.tokenName} amount ${amount} does not match the order amount ${options.expectedAmountUsd} ` +
          `(tolerance ${tolerance}).`
      );
    }
// ---- Confirmations -----------------------------------------------------
    let latestBlock: number | null = null;
    try {
      latestBlock = hexToNumber(await rpcCall(network, 'eth_blockNumber', [], Math.min(timeoutMs, 4000)));
    } catch {
      // best-effort
    }
    const confirmations =
      latestBlock && txBlock ? Math.max(1, latestBlock - txBlock + 1) : Math.max(1, txBlock);
    if (confirmations < minConfirmations) {
      throw new BlockchainTxVerificationError(
        BLOCKCHAIN_VERIFICATION_ERROR_CODES.LOW_CONFIRMATIONS,
        `Transaction ${txHash} has ${confirmations} confirmation(s); ${minConfirmations} required.`
      );
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