import type { ShopCryptoInvoice } from '@prisma/client';
import { tonRawAddress, tonFriendlyAddress } from '../config/ton-address';
import { BlockchainTxVerificationError } from './blockchain-verifier.service';

type Json = Record<string, any>;
type Call = (path: string, query?: Record<string, string>) => Promise<Json>;
const ORIGIN = 'https://toncenter.com';
async function readJson(url: URL, headers: Record<string, string>) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('TON data provider unavailable');
  const body = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.error) throw new Error('Invalid TON provider response');
  return body as Json;
}
export async function tonCall(path: string, query: Record<string, string> = {}): Promise<Json> {
  if (!['/api/v3/masterchainInfo', '/api/v3/transactions', '/api/v3/transactionsByMessage', '/api/v2/getWalletInformation'].includes(path)) throw new Error('Invalid TON API path');
  const url = new URL(path, ORIGIN);
  url.search = new URLSearchParams(query).toString();
  const key = process.env.VANTA_TONCENTER_API_KEY;
  if (!key) throw new Error('TON API not configured');
  return readJson(url, { 'X-API-Key': key });
}
export function gramAtomicFromQuote(usd: number, price8: string): string {
  const cents = Math.round(usd * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(cents / 100 - usd) > 1e-8 || !/^[1-9][0-9]*$/.test(price8)) throw new Error('Invalid GRAM quote');
  const price = BigInt(price8);
  const numerator = BigInt(cents) * BigInt(10) ** BigInt(15);
  return ((numerator + price - BigInt(1)) / price).toString();
}
export function parseGramQuote(body: Json, usd: number, now = Date.now()) {
  const price = body['the-open-network']?.usd;
  const updated = body['the-open-network']?.last_updated_at;
  const scaled = Math.floor(price * 100000000);
  if (typeof price !== 'number' || !Number.isFinite(price) || !Number.isSafeInteger(scaled) || scaled <= 0 || !Number.isSafeInteger(updated) || updated * 1000 > now || now - updated * 1000 > 300000) throw new Error('GRAM price feed stale or invalid');
  const quotePrice8 = String(scaled);
  return { amountAtomic: gramAtomicFromQuote(usd, quotePrice8), quotePrice8, quoteUpdatedAt: new Date(updated * 1000) };
}
export async function quoteGram(usd: number) {
  const key = process.env.VANTA_COINGECKO_DEMO_API_KEY;
  if (!key) throw new Error('GRAM quote provider not configured');
  const url = new URL('https://api.coingecko.com/api/v3/simple/price');
  url.search = new URLSearchParams({ ids: 'the-open-network', vs_currencies: 'usd', include_last_updated_at: 'true', precision: '8' }).toString();
  return parseGramQuote(await readJson(url, { 'x-cg-demo-api-key': key }), usd);
}
export function tonHashHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) return null;
  const data = Buffer.from(value, 'base64');
  return data.length === 32 ? data.toString('hex') : null;
}
export async function tonHead(call: Call = tonCall): Promise<number> {
  const result = await call('/api/v3/masterchainInfo');
  const last = result.last;
  if (last?.global_id !== -239 || last.workchain !== -1 || !Number.isSafeInteger(last.seqno) || last.seqno < 0 || last.seqno >= 2147483647 || !tonHashHex(last.root_hash)) throw new Error('TON mainnet identity or finality unavailable');
  return last.seqno;
}
export async function tonDepositWalletReady(address: string, call: Call = tonCall) {
  const info = await call('/api/v2/getWalletInformation', { address });
  return info.ok === true && info.result?.wallet === true && info.result.account_state === 'active';
}
export function gramPaymentUri(address: string, atomic: string) {
  if (!/^[1-9][0-9]*$/.test(atomic)) throw new Error('Invalid GRAM amount');
  return 'ton://transfer/' + tonFriendlyAddress(address) + '?amount=' + atomic;
}
export function validTransfer(tx: Json, invoice: ShopCryptoInvoice, hash: string, head: number) {
  const message = tx.in_msg, desc = tx.description;
  const sender = tonRawAddress(message?.source);
  return tonHashHex(tx.hash) === hash && tonRawAddress(tx.account) === invoice.address &&
    tx.emulated === false && Number.isSafeInteger(tx.now) && tx.now * 1000 >= Math.floor(invoice.createdAt.getTime() / 1000) * 1000 && tx.now * 1000 <= invoice.expiresAt.getTime() &&
    Number.isSafeInteger(tx.mc_block_seqno) && tx.mc_block_seqno >= invoice.startBlock && tx.mc_block_seqno <= head &&
    tx.block_ref?.workchain === 0 && tx.orig_status === 'active' && tx.end_status === 'active' &&
    !!sender && sender !== invoice.address && tonRawAddress(message?.destination) === invoice.address &&
    message?.bounced === false && message.value === invoice.amountAtomic && (!message.value_extra_currencies || Object.keys(message.value_extra_currencies).length === 0) &&
    desc?.aborted === false && desc.destroyed === false && !desc.bounce && desc.credit_ph?.credit === invoice.amountAtomic &&
    desc.compute_ph?.success === true && [0, 1].includes(desc.compute_ph.exit_code) && (!desc.action || (desc.action.success === true && desc.action.valid === true && desc.action.result_code === 0)) &&
    Array.isArray(tx.out_msgs) && tx.out_msgs.length === 0;
}
export async function verifyGram(invoice: ShopCryptoInvoice, suppliedHash: string, call: Call = tonCall) {
  const hash = tonHashHex(suppliedHash);
  if (!hash || invoice.network !== 'gram-ton' || !tonRawAddress(invoice.address)) throw new Error('Invalid TON invoice or hash');
  const head = await tonHead(call);
  const queryHash = Buffer.from(hash, 'hex').toString('base64');
  const result = await call('/api/v3/transactions', { account: invoice.address, hash: queryHash, limit: '2' });
  const txs = result.transactions;
  if (!Array.isArray(txs)) throw new Error('Invalid TON transaction response');
  if (txs.length === 0) throw new BlockchainTxVerificationError('TRANSACTION_PENDING', 'Waiting for TON masterchain inclusion.', true);
  const tx = txs[0];
  if (txs.length !== 1 || !validTransfer(tx, invoice, hash, head)) throw new BlockchainTxVerificationError('TRANSACTION_FAILED', 'Not an exact finalized native GRAM deposit.');
  // Re-query using the finalized masterchain sequence AND account/hash. This
  // trusts the configured mainnet indexer; it is not a local Merkle proof.
  const block = await call('/api/v3/transactions', { account: invoice.address, hash: queryHash, mc_seqno: String(tx.mc_block_seqno), limit: '2' });
  if (!Array.isArray(block.transactions) || block.transactions.length !== 1 || !validTransfer(block.transactions[0], invoice, hash, head) || block.transactions[0].mc_block_seqno !== tx.mc_block_seqno) throw new BlockchainTxVerificationError('RPC_ERROR', 'Masterchain inclusion not established.', true);
  return { verified: true, sender:tonRawAddress(tx.in_msg.source), txHash: hash, network: 'gram-ton', asset: 'GRAM', recipient: invoice.address, amountAtomic: invoice.amountAtomic, masterchainSeqno: tx.mc_block_seqno, verifiedAt: new Date().toISOString() };
}
export async function discoverGram(invoice: ShopCryptoInvoice, call: Call = tonCall): Promise<string[]> {
  const hashes = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const result = await call('/api/v3/transactions', { account: invoice.address, start_utime: String(Math.floor(invoice.createdAt.getTime() / 1000)), end_utime: String(Math.floor(invoice.expiresAt.getTime() / 1000)), limit: '100', offset: String(page * 100), sort: 'asc' });
    if (!Array.isArray(result.transactions)) throw new Error('Invalid TON history response');
    for (const tx of result.transactions) {
      const hash = tonHashHex(tx.hash);
      if (hash && tx.in_msg?.value === invoice.amountAtomic && tonRawAddress(tx.in_msg.destination) === invoice.address) hashes.add(hash);
    }
    if (result.transactions.length < 100) break;
  }
  return [...hashes];
}
