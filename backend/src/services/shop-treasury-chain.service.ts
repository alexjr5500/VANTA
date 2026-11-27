import type { ShopCryptoInvoice, ShopTreasuryTransfer } from '@prisma/client';
import { BlockchainNetworkConfig } from '../config/blockchain-networks.config';
import { normalizeTronHex, tronAddressHex, TRON_USDT_ADDRESS } from '../config/tron-address';
import { tonRawAddress } from '../config/ton-address';
import { BlockchainTxVerificationError } from './blockchain-verifier.service';
import { tronCall, verifyTronUsdt } from './shop-tron.service';
import { tonCall, tonHead, tonHashHex, verifyGram, validTransfer } from './shop-ton.service';
import { verifyNativeEth, ethAtomicFromQuote } from './shop-native-eth.service';
import { gramAtomicFromQuote } from './shop-ton.service';
type Row = ShopTreasuryTransfer & { invoice: ShopCryptoInvoice };
type Rpc = (chain: BlockchainNetworkConfig, method: string, params: unknown[]) => Promise<unknown>;
type Json = Record<string, any>;
type TronCall = typeof tronCall;
type TonCall = typeof tonCall;
const fail = (message: string) => new BlockchainTxVerificationError('TRANSACTION_FAILED', message);
function integer(x: unknown): bigint {
  if (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0) return BigInt(x);
  if (typeof x === 'string' && /^(0|[1-9][0-9]*|0x[0-9a-f]+)$/i.test(x)) return BigInt(x);
  throw new Error('Invalid chain integer');
}
export function canonicalTreasuryAddress(network: string, address: unknown): string | null {
  if (network === 'gram-ton') return tonRawAddress(address);
  if (network === 'usdt-trc20') return tronAddressHex(address) ? address as string : null;
  return typeof address === 'string' && /^0x[0-9a-f]{40}$/.test(address) ? address : null;
}
export function expectedInvoiceAtomic(invoice: ShopCryptoInvoice, amount: number, chain: BlockchainNetworkConfig): string {
  if (chain.native || chain.ton) {
    const age = invoice.quoteUpdatedAt ? invoice.createdAt.getTime() - invoice.quoteUpdatedAt.getTime() : Infinity;
    if (!invoice.quotePrice8 || age < 0 || age > (chain.ton ? 330000 : 3630000)) throw new Error('Invalid stored invoice quote');
    return chain.native ? ethAtomicFromQuote(amount, invoice.quotePrice8) : gramAtomicFromQuote(amount, invoice.quotePrice8);
  }
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(amount - cents / 100) > 1e-8) throw new Error('Invalid invoice value');
  return (BigInt(cents) * BigInt(10) ** BigInt(chain.tokenDecimals - 2)).toString();
}
export async function preflightSpecial(row: Row, chain: BlockchainNetworkConfig, rpc: Rpc, tc: TronCall = tronCall, nc: TonCall = tonCall) {
  const amount = BigInt(row.amountAtomic), maxFee = BigInt(row.maxFeeAtomic!);
  if (chain.native) {
    await verifyNativeEth(chain, row.invoice, row.invoice.transactionHash!, rpc);
    if (integer(await rpc(chain,'eth_chainId',[])) !== BigInt(chain.chainId)) throw new Error('Wrong chain');
    if (await rpc(chain,'eth_getCode',[row.source,'latest']) !== '0x' || await rpc(chain,'eth_getCode',[row.destination,'latest']) !== '0x') throw new Error('Native ETH direct accounts required');
    if (integer(await rpc(chain,'eth_getBalance',[row.source,'latest'])) < amount + maxFee) throw new Error('Insufficient ETH amount plus separate fee reserve');
    const gas = integer(await rpc(chain,'eth_estimateGas',[{from:row.source,to:row.destination,value:'0x'+amount.toString(16),data:'0x'}]));
    const price = integer(await rpc(chain,'eth_gasPrice',[]));
    if (!gas || !price || gas * price > maxFee) throw new Error('Estimated ETH fee exceeds cap');
    return;
  }
  if (chain.tron) {
    await verifyTronUsdt(row.invoice, row.invoice.transactionHash!, tc);
    const account = await tc('/wallet/getaccount',{ address: row.source, visible:true });
    if (normalizeTronHex(account.address) !== tronAddressHex(row.source) || integer(account.balance ?? 0) < maxFee) throw new Error('Insufficient TRX fee reserve');
    const balance = await tc('/wallet/triggerconstantcontract',{owner_address:row.source,contract_address:TRON_USDT_ADDRESS,function_selector:'balanceOf(address)',parameter:tronAddressHex(row.source)!.slice(2).padStart(64,'0'),visible:true});
    if (balance.result?.result !== true || !/^[0-9a-f]{64}$/i.test(balance.constant_result?.[0] || '') || BigInt('0x'+balance.constant_result[0]) < amount) throw new Error('Insufficient TRON USDT balance');
    // Custody adapter must simulate exact call and cap total bandwidth/energy fees before signing.
    return;
  }
  if (chain.ton) {
    await verifyGram(row.invoice, row.invoice.transactionHash!, nc);
    for (const addr of [row.source,row.destination]) {
      const response = await nc('/api/v2/getWalletInformation',{address:addr});
      if (response.ok !== true || response.result?.wallet !== true || response.result.account_state !== 'active') throw new Error('Active TON custody wallets required');
      if (addr === row.source && integer(response.result.balance) < amount + maxFee) throw new Error('Insufficient TON amount plus separate fee reserve');
    }
    return;
  }
  throw new Error('Unsupported special chain');
}
function outboundInvoice(row: Row): ShopCryptoInvoice {
  if (!row.dispatchStartedAt) throw new Error('Missing dispatch time');
  return {...row.invoice,address:row.destination,amountAtomic:row.amountAtomic,startBlock:0,
    createdAt:row.dispatchStartedAt,expiresAt:new Date()};
}
function finalizedTx(tx: Json, account: string, hash: string, head: number, since: number) {
  const d=tx.description;
  return tonHashHex(tx.hash)===hash && tonRawAddress(tx.account)===account && tx.emulated===false &&
    Number.isSafeInteger(tx.now) && tx.now*1000 >= since && tx.now*1000 <= Date.now() &&
    Number.isSafeInteger(tx.mc_block_seqno) && tx.mc_block_seqno > 0 && tx.mc_block_seqno <= head &&
    tx.block_ref?.workchain===0 && tx.orig_status==='active' && tx.end_status==='active' &&
    d?.aborted===false && d.destroyed===false && !d.bounce && d.compute_ph?.success===true &&
    [0,1].includes(d.compute_ph.exit_code) && (!d.action || (d.action.success===true && d.action.valid===true && d.action.result_code===0));
}
export async function verifyTonSweep(row: Row, nc: TonCall = tonCall): Promise<bigint> {
  const hash=tonHashHex(row.transactionHash);
  if (!hash || !row.dispatchStartedAt) throw new Error('Missing TON sweep reference');
  const head=await tonHead(nc);
  const since=Math.floor(row.dispatchStartedAt.getTime()/1000)*1000;
  const source=await nc('/api/v3/transactions',{account:row.source,hash:Buffer.from(hash,'hex').toString('base64'),limit:'2'});
  if (!Array.isArray(source.transactions)) throw new Error('TON transaction response invalid');
  if (!source.transactions.length) throw new BlockchainTxVerificationError('TRANSACTION_PENDING','Waiting for source transaction',true);
  const tx=source.transactions[0];
  if (source.transactions.length!==1 || !finalizedTx(tx,row.source,hash,head,since) || !Array.isArray(tx.out_msgs) || tx.out_msgs.length!==1) throw fail('Invalid finalized TON source sweep');
  const msg=tx.out_msgs[0], messageHash=tonHashHex(msg.hash);
  if (!messageHash || msg.ihr_disabled !== true || integer(msg.ihr_fee ?? 0) !== BigInt(0) || tonRawAddress(msg.source)!==row.source || tonRawAddress(msg.destination)!==row.destination || msg.bounced!==false || msg.value!==row.amountAtomic || (msg.value_extra_currencies && Object.keys(msg.value_extra_currencies).length)) throw fail('TON outgoing message mismatch');
  const received=await nc('/api/v3/transactionsByMessage',{msg_hash:Buffer.from(messageHash,'hex').toString('base64'),direction:'in',limit:'2'});
  if (!Array.isArray(received.transactions)) throw new Error('TON delivery response invalid');
  if (!received.transactions.length) throw new BlockchainTxVerificationError('TRANSACTION_PENDING','Waiting for TON destination delivery',true);
  const dest=received.transactions[0], destHash=tonHashHex(dest.hash);
  if (received.transactions.length!==1 || !destHash || !finalizedTx(dest,row.destination,destHash,head,since) || tonHashHex(dest.in_msg?.hash)!==messageHash ||
      tonRawAddress(dest.in_msg?.source)!==row.source || !validTransfer(dest,outboundInvoice(row),destHash,head)) throw fail('TON treasury delivery mismatch');
  // total_fees excludes the remaining outbound forwarding fee; add it
  // conservatively along with destination fees. Missing fee fields fail closed.
  const destinationFee=integer(dest.total_fees);
  const receivedAmount=BigInt(row.amountAtomic);
  if (destinationFee >= receivedAmount) throw fail('TON treasury credit consumed by fees');
  const before=integer(dest.account_state_before?.balance), after=integer(dest.account_state_after?.balance);
  if (after < before || after-before !== receivedAmount-destinationFee) throw fail('TON destination balance delta mismatch');
  return integer(tx.total_fees)+integer(msg.fwd_fee)+destinationFee;
}
export async function verifySpecialOutgoing(row: Row, chain: BlockchainNetworkConfig, rpc: Rpc, tc: TronCall=tronCall, nc: TonCall=tonCall): Promise<bigint> {
  if (!row.transactionHash || !row.dispatchStartedAt) throw new Error('Missing sweep proof');
  if (chain.native) {
    const proof=await verifyNativeEth(chain,outboundInvoice(row),row.transactionHash,rpc,row.source);
    const r=await rpc(chain,'eth_getTransactionReceipt',[row.transactionHash]) as Json;
    if (!r || String(r.transactionHash).toLowerCase()!==row.transactionHash || String(r.blockHash).toLowerCase()!==String(proof.blockHash).toLowerCase() || r.status!=='0x1') throw new Error('ETH receipt changed');
    return integer(r.gasUsed)*integer(r.effectiveGasPrice);
  }
  if (chain.tron) {
    const proof=await verifyTronUsdt(outboundInvoice(row),row.transactionHash,tc,row.source);
    return integer(proof.feeAtomic);
  }
  if (chain.ton) return verifyTonSweep(row,nc);
  throw new Error('Unsupported special chain');
}
