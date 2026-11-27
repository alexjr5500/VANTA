import { prisma } from '../prisma';
import { BLOCKCHAIN_NETWORKS, BlockchainNetworkId, ERC20_TRANSFER_EVENT_SIGNATURE, getMinBlockchainConfirmations } from '../config/blockchain-networks.config';
import { getCoinPaymentDepositAddress, isValidTransactionHash } from '../config/coin-payments.config';
import { getBadgePaymentDepositAddress } from '../config/verification-badge.config';
import { getNetworkRetryDelayMs, isBlockRangeLimitError } from './blockchain-rpc-policy';

/**
 * Continuous, restart-safe-by-overlap chain log watcher.
 * It scans ERC-20 Transfer logs for the two VANTA deposit wallets, matches a
 * transfer to candidate live orders by network + amount + validity window.
 * Candidates are reconciliation evidence only. Without independent payer/order
 * binding even a single candidate must never be automatically credited.
 */
const POLL_MS = Math.max(10_000, Number(process.env.VANTA_CHAIN_WATCH_POLL_MS || 30_000));
// Public BSC/Base RPCs commonly reject large eth_getLogs ranges. Keep the
// default deliberately small; operators with a dedicated RPC can raise it.
const CHUNK_BLOCKS = Math.max(1, Math.min(500, Number(process.env.VANTA_CHAIN_WATCH_CHUNK_BLOCKS || 50)));
const LOOKBACK_BLOCKS = Math.max(100, Number(process.env.VANTA_CHAIN_WATCH_LOOKBACK_BLOCKS || 2_000));
const TOLERANCE_USD = 0.005;
const cursors = new Map<BlockchainNetworkId, number>();
const networkFailures = new Map<BlockchainNetworkId, number>();
const networkRetryAt = new Map<BlockchainNetworkId, number>();
const MAX_NETWORK_RETRY_MS = 5 * 60_000;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function topicAddress(address: string): string {
  return '0x' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}
function fromHex(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return 0;
  return Number(BigInt(value));
}
function transferAmount(data: unknown, decimals: number): number {
  if (typeof data !== 'string' || !/^0x[0-9a-f]+$/i.test(data)) return NaN;
  return Number(BigInt(data)) / Math.pow(10, decimals);
}
async function rpc(network: BlockchainNetworkId, method: string, params: unknown[]): Promise<any> {
  const config = BLOCKCHAIN_NETWORKS[network];
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`RPC ${network} ${method} HTTP ${response.status}`);
  const payload = await response.json() as { result?: any; error?: { code?: number; message?: string } };
  if (payload.error) {
    const code = typeof payload.error.code === 'number' ? ` (code ${payload.error.code})` : '';
    throw new Error(`RPC ${network} ${method}${code}: ${payload.error.message || 'provider returned an RPC error'}`);
  }
  return payload.result;
}
async function fulfill(network: BlockchainNetworkId, txHash: string, amount: number, recipient: string, timestamp: Date): Promise<void> {
  const coinWallet = getCoinPaymentDepositAddress();
  const isCoin = recipient.toLowerCase() === coinWallet.toLowerCase();
  const orders = isCoin
    ? await prisma.purchaseOrder.findMany({
        where: { status: { in: ['PENDING','PROCESSING','PAID'] }, paymentMode: 'live', paymentMethod: network, amount: { gte: amount - TOLERANCE_USD, lte: amount + TOLERANCE_USD }, createdAt: { lte: timestamp }, OR: [{ expiresAt: null }, { expiresAt: { gte: timestamp } }] },
        orderBy: { createdAt: 'desc' }, take: 3,
      })
    : await prisma.verificationPurchase.findMany({
        where: { status: { in: ['PENDING','PROCESSING','PAID'] }, paymentMode: 'live', network, amount: { gte: amount - TOLERANCE_USD, lte: amount + TOLERANCE_USD }, createdAt: { lte: timestamp }, expiresAt: { gte: timestamp } },
        orderBy: { createdAt: 'desc' }, take: 3,
      });
  if (orders.length !== 1) {
    console.warn('[CHAIN-WATCH] Transfer needs reconciliation', { network, txHash, amount, recipient, candidateCount: orders.length });
    return;
  }
  // A unique amount/time candidate is not evidence of who paid. Do not
  // fabricate a provider-authenticated order assignment from a chain log.
  console.warn('[CHAIN-WATCH] Transfer requires independently verified order ownership', {
    network, txHash, candidateCount: orders.length, kind: isCoin ? 'coin' : 'badge',
  });
}

async function getTransferLogs(network: BlockchainNetworkId, filter: Record<string, unknown>, fromBlock: number, toBlock: number): Promise<any[]> {
  try {
    const logs = await rpc(network, 'eth_getLogs', [filter]);
    if (!Array.isArray(logs)) throw new Error(`RPC ${network} eth_getLogs returned an invalid result`);
    return logs;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rangeSize = toBlock - fromBlock + 1;
    // Split only errors that explicitly identify a block-range/result-size cap.
    // A generic "limit exceeded" is commonly an RPC quota/rate-limit response;
    // recursively splitting it would multiply requests and worsen throttling.
    if (rangeSize > 1 && isBlockRangeLimitError(message)) {
      const midpoint = Math.floor((fromBlock + toBlock) / 2);
      const left = await getTransferLogs(network, filter, fromBlock, midpoint);
      const right = await getTransferLogs(network, filter, midpoint + 1, toBlock);
      return left.concat(right);
    }
    throw error;
  }
}

async function scanNetwork(network: BlockchainNetworkId): Promise<void> {
  const config = BLOCKCHAIN_NETWORKS[network];
  const latest = fromHex(await rpc(network, 'eth_blockNumber', []));
  if (!latest) return;
  let cursor = cursors.get(network);
  if (!cursor) {
    cursor = Math.max(0, latest - LOOKBACK_BLOCKS);
    cursors.set(network, cursor);
  }
  const safeHead = Math.max(0, latest - Math.max(1, getMinBlockchainConfirmations()));
  while (cursor <= safeHead) {
    const end = Math.min(safeHead, cursor + CHUNK_BLOCKS - 1);
    for (const [kind, wallet] of [['coin', getCoinPaymentDepositAddress()], ['badge', getBadgePaymentDepositAddress()]] as const) {
      const filter = {
        fromBlock: '0x' + cursor.toString(16),
        toBlock: '0x' + end.toString(16),
        address: config.tokenContract,
        topics: [ERC20_TRANSFER_EVENT_SIGNATURE, null, topicAddress(wallet)],
      };
      const logs = await getTransferLogs(network, filter, cursor, end);
      for (const log of logs) {
        const txHash = String(log.transactionHash || '');
        if (!isValidTransactionHash(txHash)) continue;
        const amount = transferAmount(log.data, config.tokenDecimals);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const block = await rpc(network, 'eth_getBlockByNumber', [log.blockNumber, false]);
        const timestamp = new Date(fromHex(block?.timestamp) * 1000);
        if (!Number.isFinite(timestamp.getTime())) continue;
        // Keep wallet classification explicit; a transfer is only fulfilled
        // against the matching purchase family and dedicated recipient.
        if (kind === 'coin' && wallet.toLowerCase() !== getCoinPaymentDepositAddress().toLowerCase()) continue;
        if (kind === 'badge' && wallet.toLowerCase() !== getBadgePaymentDepositAddress().toLowerCase()) continue;
        await fulfill(network, txHash, amount, wallet, timestamp);
      }
    }
    cursor = end + 1;
    cursors.set(network, cursor);
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Keep each chain independent: an unavailable BSC RPC must not prevent
    // Base from being scanned (and vice versa).
    for (const network of ['usdt-bep20', 'usdc-base'] as const) {
      const retryAt = networkRetryAt.get(network) || 0;
      if (Date.now() < retryAt) continue;

      try {
        await scanNetwork(network);
        if (networkFailures.has(network)) {
          console.info('[CHAIN-WATCH] Network scan recovered', { network });
        }
        networkFailures.delete(network);
        networkRetryAt.delete(network);
      } catch (error) {
        const failures = (networkFailures.get(network) || 0) + 1;
        const delayMs = getNetworkRetryDelayMs(failures, POLL_MS, MAX_NETWORK_RETRY_MS);
        networkFailures.set(network, failures);
        networkRetryAt.set(network, Date.now() + delayMs);
        console.error('[CHAIN-WATCH] Network scan failed; retry scheduled', {
          network,
          failures,
          retryInMs: delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    running = false;
    timer = setTimeout(() => void tick(), POLL_MS);
  }
}

export function startBlockchainPaymentMonitor(): void {
  if (timer || process.env.VANTA_CHAIN_WATCH_ENABLED === 'false') return;
  console.info('[CHAIN-WATCH] Starting continuous BSC/Base payment monitoring', { pollMs: POLL_MS, chunkBlocks: CHUNK_BLOCKS });
  void tick();
}
