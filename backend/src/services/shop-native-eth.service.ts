import { BlockchainNetworkConfig } from '../config/blockchain-networks.config';
import { BlockchainTxVerificationError } from './blockchain-verifier.service';
import type { ShopCryptoInvoice } from '@prisma/client';

// Chainlink Ethereum mainnet ETH/USD proxy. Quote is a server-side immutable
// snapshot, not the latest exchange rate at fulfillment time.
const FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';
type Rpc = (network: BlockchainNetworkConfig, method: string, params: unknown[]) => Promise<unknown>;
const hex = (x: unknown): bigint => {
  if (typeof x !== 'string' || !/^0x[0-9a-f]+$/i.test(x)) throw new Error('Invalid Ethereum RPC result');
  return BigInt(x);
};
const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Missing Ethereum RPC object');
  return x as Record<string, unknown>;
};
export function ethAtomicFromQuote(usd: number, price8: string): string {
  const cents = Math.round(usd * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(cents / 100 - usd) > 1e-8 || !/^[1-9][0-9]*$/.test(price8)) throw new Error('Invalid ETH quote');
  const price = BigInt(price8);
  const numerator = BigInt(cents) * BigInt(10) ** BigInt(24);
  // Round up to the nearest wei; never lose value by truncating to cents.
  return ((numerator + price - BigInt(1)) / price).toString();
}
export function atomicDisplay(value: string, decimals: number): string {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error('Invalid atomic amount');
  const padded = value.padStart(decimals + 1, '0');
  return padded.slice(0, -decimals) + '.' + (padded.slice(-decimals).replace(/0+$/, '') || '00');
}
export async function quoteEth(network: BlockchainNetworkConfig, usd: number, rpc: Rpc, now = Date.now()) {
  if (!network.native || network.chainId !== 1 || hex(await rpc(network, 'eth_chainId', [])) !== BigInt(1)) throw new Error('Wrong Ethereum network');
  const decimals = await rpc(network, 'eth_call', [{ to: FEED, data: '0x313ce567' }, 'latest']);
  if (hex(decimals) !== BigInt(8)) throw new Error('Unexpected oracle decimals');
  const result = await rpc(network, 'eth_call', [{ to: FEED, data: '0xfeaf968c' }, 'latest']);
  if (typeof result !== 'string' || !/^0x[0-9a-f]{320}$/i.test(result)) throw new Error('Invalid oracle response');
  const words = result.slice(2).match(/.{64}/g)!.map(v => BigInt('0x' + v));
  const [round, answer, started, updated, answered] = words;
  const timestamp = Number(updated) * 1000;
  if (round <= BigInt(0) || answer <= BigInt(0) || answer >= BigInt(2) ** BigInt(255) || started <= BigInt(0) || updated < started || answered < round || !Number.isSafeInteger(timestamp) || timestamp > now || now - timestamp > 3600000) throw new Error('ETH price feed stale or invalid');
  return { amountAtomic: ethAtomicFromQuote(usd, answer.toString()), quotePrice8: answer.toString(), quoteUpdatedAt: new Date(timestamp) };
}
export async function verifyNativeEth(network: BlockchainNetworkConfig, invoice: ShopCryptoInvoice, hash: string, rpc: Rpc) {
  if (!network.native || network.chainId !== 1 || hex(await rpc(network, 'eth_chainId', [])) !== BigInt(1)) throw new Error('Wrong Ethereum network');
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid transaction hash');
  const tx = await rpc(network, 'eth_getTransactionByHash', [hash]);
  const receipt = await rpc(network, 'eth_getTransactionReceipt', [hash]);
  if (!tx || !receipt) throw new BlockchainTxVerificationError('TRANSACTION_PENDING', 'Waiting for Ethereum transaction.', true);
  const t = object(tx), r = object(receipt);
  if (String(t.hash).toLowerCase() !== hash.toLowerCase() || String(r.transactionHash).toLowerCase() !== hash.toLowerCase() || hex(r.status) !== BigInt(1) || String(t.to).toLowerCase() !== invoice.address || String(r.to).toLowerCase() !== invoice.address || typeof t.from !== 'string' || t.from.toLowerCase() === invoice.address || String(t.input) !== '0x' || hex(t.value).toString() !== invoice.amountAtomic) throw new BlockchainTxVerificationError('AMOUNT_MISMATCH', 'Not an exact direct ETH payment for this invoice.');
  const height = hex(r.blockNumber);
  if (hex(t.blockNumber) !== height || String(t.blockHash).toLowerCase() !== String(r.blockHash).toLowerCase() || height < BigInt(invoice.startBlock)) throw new BlockchainTxVerificationError('TRANSACTION_FAILED', 'Invalid invoice block.');
  const final = object(await rpc(network, 'eth_getBlockByNumber', ['finalized', false]));
  if (hex(final.number) < height) throw new BlockchainTxVerificationError('LOW_CONFIRMATIONS', 'Waiting for Ethereum finality.', true);
  const block = object(await rpc(network, 'eth_getBlockByNumber', [r.blockNumber, false]));
  const timestamp = Number(hex(block.timestamp)) * 1000;
  if (String(block.hash).toLowerCase() !== String(r.blockHash).toLowerCase() || hex(block.number) !== height || !Number.isSafeInteger(timestamp) || timestamp < Math.floor(invoice.createdAt.getTime() / 1000) * 1000 || timestamp > invoice.expiresAt.getTime()) throw new BlockchainTxVerificationError('TRANSACTION_FAILED', 'Payment outside canonical invoice window.');
  return { verified: true, txHash: hash.toLowerCase(), network: network.id, recipient: invoice.address, amountAtomic: invoice.amountAtomic, blockNumber: Number(height), blockHash: r.blockHash, verifiedAt: new Date().toISOString() };
}
