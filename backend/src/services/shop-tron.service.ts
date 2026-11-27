import type { ShopCryptoInvoice } from '@prisma/client';
import { tronAddressHex, normalizeTronHex, TRON_USDT_ADDRESS } from '../config/tron-address';
import { ERC20_TRANSFER_EVENT_SIGNATURE } from '../config/blockchain-networks.config';
import { BlockchainTxVerificationError } from './blockchain-verifier.service';

// Fixed official mainnet origin. No client-supplied URLs or testnet override.
const ORIGIN = 'https://api.trongrid.io';
const CONTRACT = tronAddressHex(TRON_USDT_ADDRESS)!;
type Json = Record<string, any>;
type Call = (path: string, body?: Record<string, unknown>) => Promise<Json>;
export async function tronCall(path: string, body?: Record<string, unknown>): Promise<Json> {
  if (!/^\/(wallet|walletsolidity|v1)\//.test(path)) throw new Error('Invalid TRON API path');
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN) throw new Error('Invalid TRON API origin');
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(process.env.VANTA_TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.VANTA_TRONGRID_API_KEY } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('TRON provider unavailable');
  const data = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.Error || data.error || data.success === false) throw new Error('Invalid TRON provider response');
  return data;
}
const txId = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : null;
export async function tronHead(call: Call = tronCall): Promise<number> {
  const head = await call('/wallet/getnowblock', {});
  const n = head.block_header?.raw_data?.number;
  if (!Number.isSafeInteger(n) || n < 0 || n >= 2147483647 || !txId(head.blockID)) throw new Error('Invalid TRON mainnet head');
  return n;
}
export async function verifyTronUsdt(invoice: ShopCryptoInvoice, hash: string, call: Call = tronCall, expectedSender?: string) {
  const id = txId(hash);
  const recipient = tronAddressHex(invoice.address);
  if (!id || !recipient || invoice.network !== 'usdt-trc20') throw new Error('Invalid TRON invoice or transaction');
  const [tx, info] = await Promise.all([
    call('/walletsolidity/gettransactionbyid', { value: id, visible: false }),
    call('/walletsolidity/gettransactioninfobyid', { value: id, visible: false }),
  ]);
  if (!tx.txID || !info.id) throw new BlockchainTxVerificationError('TRANSACTION_PENDING', 'Waiting for solidified TRON transaction.', true);
  if (txId(tx.txID) !== id || txId(info.id) !== id || info.result === 'FAILED' || info.receipt?.result !== 'SUCCESS' ||
      !Array.isArray(tx.ret) || tx.ret.length !== 1 || tx.ret[0].contractRet !== 'SUCCESS' ||
      !Number.isSafeInteger(info.blockNumber) || info.blockNumber < invoice.startBlock ||
      !Number.isSafeInteger(info.blockTimeStamp) || info.blockTimeStamp < invoice.createdAt.getTime() || info.blockTimeStamp > invoice.expiresAt.getTime()) {
    throw new BlockchainTxVerificationError('TRANSACTION_FAILED', 'TRON transaction failed or is outside the invoice window.');
  }
  const contracts = tx.raw_data?.contract;
  const callData = contracts?.[0]?.parameter?.value;
  if (!Array.isArray(contracts) || contracts.length !== 1 || contracts[0].type !== 'TriggerSmartContract' ||
      normalizeTronHex(callData?.contract_address) !== CONTRACT || typeof callData?.data !== 'string' ||
      !/^a9059cbb[0-9a-f]{128}$/i.test(callData.data) ||
      '41' + callData.data.slice(32, 72).toLowerCase() !== recipient ||
      BigInt('0x' + callData.data.slice(72)).toString() !== invoice.amountAtomic) {
    throw new BlockchainTxVerificationError('WRONG_TOKEN', 'Not an exact direct official USDT transfer.');
  }
  const sender = normalizeTronHex(callData.owner_address);
  if (!sender || sender === recipient || (expectedSender !== undefined && sender !== tronAddressHex(expectedSender))) throw new BlockchainTxVerificationError('WRONG_SENDER', 'Invalid TRON payment sender.');
  const matching = (Array.isArray(info.log) ? info.log : []).filter((log: Json) => {
    const topics = log.topics;
    return normalizeTronHex(log.address) === CONTRACT && Array.isArray(topics) && topics.length === 3 &&
      String(topics[0]).toLowerCase() === ERC20_TRANSFER_EVENT_SIGNATURE.slice(2) &&
      /^[0-9a-f]{64}$/i.test(topics[1]) && /^[0-9a-f]{64}$/i.test(topics[2]) &&
      '41' + topics[1].slice(24).toLowerCase() === sender && '41' + topics[2].slice(24).toLowerCase() === recipient &&
      typeof log.data === 'string' && /^[0-9a-f]{64}$/i.test(log.data) && BigInt('0x' + log.data).toString() === invoice.amountAtomic;
  });
  if (matching.length !== 1) throw new BlockchainTxVerificationError('AMOUNT_MISMATCH', 'Exact official USDT transfer log not found.');
  const block = await call('/walletsolidity/getblockbynum', { num: info.blockNumber, visible: false });
  if (block.block_header?.raw_data?.number !== info.blockNumber || block.block_header?.raw_data?.timestamp !== info.blockTimeStamp ||
      !txId(block.blockID) || !Array.isArray(block.transactions) || !block.transactions.some((t: Json) => txId(t.txID) === id)) {
    throw new BlockchainTxVerificationError('RPC_ERROR', 'Solidified block inclusion could not be established.', true);
  }
  // Reject attached native currency or auxiliary token value on an outgoing sweep.
  if (expectedSender && ((callData.call_value ?? 0) !== 0 || (callData.call_token_value ?? 0) !== 0)) throw new BlockchainTxVerificationError('TRANSACTION_FAILED', 'Unexpected attached value.');
  const fee = info.fee ?? 0;
  if (!Number.isSafeInteger(fee) || fee < 0) throw new Error('Invalid TRON fee');
  return { verified: true, sender, feeAtomic: String(fee), txHash: id, network: 'usdt-trc20', recipient: invoice.address, asset: 'USDT', amountAtomic: invoice.amountAtomic, blockNumber: info.blockNumber, blockHash: block.blockID, verifiedAt: new Date().toISOString() };
}

/** Indexer discovery is not proof. Each candidate is independently verified. */
export async function discoverTronUsdt(invoice: ShopCryptoInvoice, call: Call = tronCall): Promise<string[]> {
  const recipient = tronAddressHex(invoice.address);
  if (!recipient) throw new Error('Invalid deposit address');
  const base = '/v1/accounts/' + encodeURIComponent(invoice.address) + '/transactions/trc20';
  const ids = new Set<string>();
  let fingerprint: string | undefined;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ only_confirmed: 'true', only_to: 'true', contract_address: TRON_USDT_ADDRESS,
      min_timestamp: String(invoice.createdAt.getTime()), max_timestamp: String(invoice.expiresAt.getTime()), limit: '200' });
    if (fingerprint) query.set('fingerprint', fingerprint);
    const result = await call(base + '?' + query.toString());
    if (!Array.isArray(result.data)) throw new Error('Invalid TRON history response');
    for (const row of result.data) {
      const id = txId(row.transaction_id);
      if (id && row.type === 'Transfer' && normalizeTronHex(row.token_info?.address) === CONTRACT && normalizeTronHex(row.to) === recipient &&
          typeof row.value === 'string' && row.value === invoice.amountAtomic) ids.add(id);
    }
    const next = result.meta?.fingerprint;
    if (typeof next !== 'string' || !next || next === fingerprint) break;
    fingerprint = next;
  }
  return [...ids];
}
