import { shopLiveGiftsEnabled } from '../config/shop-crypto.config';
import { shopPaymentReference } from './shop-payment-proof.service';
import { treasuryHash } from '../config/shop-treasury-hash';
import { appendAuditLog } from '../security/auditLog';
import { tonHead, quoteGram, gramAtomicFromQuote, gramPaymentUri, verifyGram, discoverGram, tonDepositWalletReady, tonHashHex } from './shop-ton.service';
import { tonFriendlyAddress } from '../config/ton-address';
import { tronHead, verifyTronUsdt, discoverTronUsdt } from './shop-tron.service';
import * as QRCode from 'qrcode';
import { quoteEth, ethAtomicFromQuote, atomicDisplay, verifyNativeEth } from './shop-native-eth.service';
import { prisma } from '../prisma';
import { ShopCryptoInvoice } from '@prisma/client';
import { getBlockchainNetwork, getMinBlockchainConfirmations, ERC20_TRANSFER_EVENT_SIGNATURE, BlockchainNetworkConfig } from '../config/blockchain-networks.config';
import { shopCryptoAddresses, shopCryptoNetworks, shopLiveCryptoEnabled } from '../config/shop-crypto.config';
import { coinPaymentService } from './coin-payment.service';
import { verificationPaymentService } from './verification-payment.service';
import { walletService } from './wallet.service';
import { blockchainTxVerifier, BlockchainTxVerificationError } from './blockchain-verifier.service';

type Product = 'coins' | 'badge';
const confirmations = () => Math.max(12, getMinBlockchainConfirmations());
const pendingStates = ['PENDING', 'PROCESSING', 'PAID'];
const recoverableStates = [...pendingStates,'EXPIRED'];
const recoveryMs = 7*24*60*60*1000;

export function priceToAtomic(amount: number, decimals: number): string {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(amount - cents / 100) > 1e-8 || !Number.isInteger(decimals) || decimals < 2 || decimals > 18) throw new Error('Invalid server price');
  return (BigInt(cents) * BigInt(10) ** BigInt(decimals - 2)).toString();
}
export function paymentUri(network: BlockchainNetworkConfig, address: string, atomic: string): string {
  if (network.ton) return gramPaymentUri(address, atomic);
  if (network.tron) { if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error('Invalid TRON address'); return address; }
  if (!/^0x[0-9a-f]{40}$/.test(address) || !/^[1-9][0-9]*$/.test(atomic)) throw new Error('Invalid invoice');
  if (network.native) return 'ethereum:' + address + '@' + network.chainId + '?value=' + atomic;
  return 'ethereum:' + network.tokenContract + '@' + network.chainId + '/transfer?address=' + address + '&uint256=' + atomic;
}
function hexNumber(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Invalid chain response');
  const n = Number(BigInt(value));
  if (!Number.isSafeInteger(n) || n < 0 || n >= 2147483647) throw new Error('Invalid block number');
  return n;
}
async function rpc(network: BlockchainNetworkConfig, method: string, params: unknown[]) {
  const response = await fetch(network.rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'vanta-shop', method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Chain service unavailable');
  const data = await response.json() as { result?: unknown; error?: unknown };
  if (data.error || data.result === undefined) throw new Error('Chain service unavailable');
  return data.result;
}
async function getHead(network: BlockchainNetworkConfig): Promise<number> {
  if (hexNumber(await rpc(network, 'eth_chainId', [])) !== network.chainId) throw new Error('Incorrect chain RPC');
  return hexNumber(await rpc(network, 'eth_blockNumber', []));
}
function expectedAtomic(i: ShopCryptoInvoice, network: BlockchainNetworkConfig, amount: number) {
  if (network.ton) {
    if (!i.quotePrice8 || !i.quoteUpdatedAt || i.quoteUpdatedAt > i.createdAt || i.createdAt.getTime() - i.quoteUpdatedAt.getTime() > 330000) throw new Error('Invalid stored GRAM quote');
    return gramAtomicFromQuote(amount, i.quotePrice8);
  }
  if (network.native) {
    if (!i.quotePrice8 || !i.quoteUpdatedAt || i.quoteUpdatedAt > i.createdAt || i.createdAt.getTime() - i.quoteUpdatedAt.getTime() > 3600000 + 30000) throw new Error('Missing or stale stored ETH quote');
    return ethAtomicFromQuote(amount, i.quotePrice8);
  }
  return priceToAtomic(amount, network.tokenDecimals);
}
async function orderFor(i: ShopCryptoInvoice) {
  if (i.product === 'coins') return prisma.purchaseOrder.findFirst({ where: { id: i.orderId, userId: i.payerId, paymentMode: 'live' } });
  if (i.product === 'badge') return prisma.verificationPurchase.findFirst({ where: { id: i.orderId, userId: i.payerId, paymentMode: 'live' } });
  throw new Error('Invalid product');
}
async function renderInvoice(i: ShopCryptoInvoice) {
  const network = getBlockchainNetwork(i.network);
  const order = await orderFor(i);
  if (!network || !order) throw new Error('Invoice unavailable');
  if (expectedAtomic(i, network, order.amount) !== i.amountAtomic) throw new Error('Invoice price mismatch');
  if (!recoverableStates.includes(order.status) && !['COMPLETED','REFUNDED'].includes(order.status)) throw new Error('Invoice unavailable');
  const closed=!shopLiveCryptoEnabled()||!shopCryptoNetworks().includes(network.id)||!shopCryptoAddresses(i.network).includes(i.address)||(!!order.recipientUserId&&!shopLiveGiftsEnabled())||!pendingStates.includes(order.status)||Date.now()>=i.expiresAt.getTime();
  const uri = paymentUri(network, i.address, i.amountAtomic);
  return { orderId: i.orderId, product: i.product, amount: order.amount, currency: 'USD', network: i.network,
    gift: !!order.recipientUserId, closed, mode: 'live' as const, expiresAt: i.expiresAt.toISOString(), address: network.ton ? tonFriendlyAddress(i.address) : i.address, paymentUri: uri,
    qrCode: await QRCode.toDataURL(uri, { width: 360, margin: 3, errorCorrectionLevel: 'M' }),
    token: network.tokenName, tokenAmount: (network.native || network.ton) ? atomicDisplay(i.amountAtomic, network.tokenDecimals) : order.amount.toFixed(2), status: closed && !['COMPLETED','REFUNDED'].includes(order.status)?'RECONCILIATION':order.status,
    ...(i.product === 'coins' && 'coins' in order ? { coins: order.coins } : {}),
    ...(i.product === 'badge' && 'planId' in order ? { planId: order.planId } : {}),
  };
}

export async function createShopCryptoInvoice(payerId: string, input: Record<string, unknown>) {
  if (!shopLiveCryptoEnabled()) throw new Error('Live crypto checkout is not configured');
  const product: Product = input.product === 'coins' ? 'coins' : input.product === 'badge' ? 'badge' : (() => { throw new Error('Invalid product'); })();
  if (input.renew === true || (input.recipientId != null && !shopLiveGiftsEnabled())) throw new Error('Gift or recurring checkout unavailable');
  if(product==='badge' && typeof input.recipientId==='string') {
    const badge=await prisma.verificationBadge.findUnique({where:{userId:input.recipientId}});
    if(badge && ['ACTIVE','SUSPENDED'].includes(badge.status)) throw new Error('Recipient already has an active or suspended badge');
  }
  const network = getBlockchainNetwork(input.network);
  if (!network || !shopCryptoNetworks().includes(network.id)) throw new Error('Unsupported or disabled network');
  const startBlock = (network.ton ? await tonHead() : network.tron ? await tronHead() : await getHead(network)) + 1;
  // Keep the existing catalog and fulfillment services authoritative. No price
  // or amount supplied by the client is ever used to calculate the invoice.
  const data = product === 'coins'
    ? await coinPaymentService.initializeCoinPurchase(payerId, input.packageId, network.id, undefined, input.customCoins, input.recipientId, true)
    : await verificationPaymentService.initializeVerificationPurchase(payerId, input.planId, network.id, undefined, input.recipientId, true);
  const orderId = String(data.orderId);
  const amount = Number(data.amount);
  const expiresAt = new Date(String(data.expiresAt));
  if (data.mode !== 'live' || !orderId || !Number.isFinite(expiresAt.getTime())) throw new Error('Order unavailable');
  const quote = network.ton ? await quoteGram(amount) : network.native ? await quoteEth(network, amount, rpc) : { amountAtomic: priceToAtomic(amount, network.tokenDecimals) };
  // Never reuse a receiving address, even if an earlier order expired.
  const addresses = shopCryptoAddresses(network.id);
  const used = await prisma.shopCryptoInvoice.findMany({ where: { address: { in: addresses } }, select: { address: true } });
  const reserved = new Set(used.map(a => a.address));
  let invoice: ShopCryptoInvoice | undefined;
  for (const address of addresses.filter(a => !reserved.has(a))) {
    try {
      if (network.ton && !(await tonDepositWalletReady(address))) continue;
      if (network.native && await rpc(network, 'eth_getCode', [address, 'latest']) !== '0x') continue;
      invoice = await prisma.shopCryptoInvoice.create({ data: { product, orderId, payerId, network: network.id, address, ...quote, expiresAt, startBlock, scanCursor: startBlock } });
      break;
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') throw e;
    }
  }
  if (!invoice) {
    if (product === 'coins') await prisma.purchaseOrder.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    else await prisma.verificationPurchase.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    throw new Error('No deposit address available. No payment was requested.');
  }
  return renderInvoice(invoice);
}

export async function resumeShopCryptoInvoice(payerId: string, orderId: string) {
  const invoice = await prisma.shopCryptoInvoice.findFirst({ where: { payerId, orderId } });
  if (!invoice) throw new Error('Invoice not found');
  return renderInvoice(invoice);
}

export async function listShopCryptoInvoices(payerId: string) {
  const invoices = await prisma.shopCryptoInvoice.findMany({ where: { payerId }, orderBy: { createdAt: 'desc' }, take: 10 });
  const result: { orderId: string; product: string; network: string; amount: number; expiresAt: Date; status:string; gift:boolean }[] = [];
  for (const invoice of invoices) {
    const order = await orderFor(invoice);
    if (order && (recoverableStates.includes(order.status)||['COMPLETED','REFUNDED'].includes(order.status))) result.push({ orderId: invoice.orderId, product: invoice.product, network: invoice.network, amount: order.amount, expiresAt: invoice.expiresAt, status:['COMPLETED','REFUNDED'].includes(order.status)?order.status:Date.now()>=invoice.expiresAt.getTime()?'RECONCILIATION':order.status,gift:!!order.recipientUserId });
  }
  return { invoices: result };
}
export async function shopCryptoStatus(payerId: string, orderId: string) {
  const invoice = await prisma.shopCryptoInvoice.findFirst({ where: { payerId, orderId } });
  if (!invoice) throw new Error('Invoice not found');
  const order = await orderFor(invoice);
  if (!order) throw new Error('Order not found');
  const supportCase=await prisma.shopCryptoCase.findUnique({where:{invoiceId:invoice.id},select:{id:true,kind:true,status:true,refundHash:true}});
  const success = order.status === 'COMPLETED';
  const status = success ? 'COMPLETED' : order.status==='REFUNDED'?'REFUNDED': !pendingStates.includes(order.status) || Date.now() >= invoice.expiresAt.getTime() ? 'RECONCILIATION' : invoice.transactionHash ? 'PROCESSING' : order.status;
  return { success, status, supportCase, gift:!!order.recipientUserId, ...(success && 'coins' in order ? { coins: order.coins } : {}) };
}
const running = new Set<string>();
async function verifyAndSettle(i: ShopCryptoInvoice, txHash: string) {
  const network = getBlockchainNetwork(i.network);
  const order = await orderFor(i);
  if (!network || !shopCryptoNetworks().includes(network.id) || !order || (order.recipientUserId && !shopLiveGiftsEnabled()) || !shopCryptoAddresses(i.network).includes(i.address) ||
      expectedAtomic(i, network, order.amount) !== i.amountAtomic) throw new Error('Invoice mismatch');
  if (order.status === 'COMPLETED') {
    await prisma.shopCryptoInvoice.updateMany({ where: { id: i.id, settledAt: null }, data: { settledAt: new Date() } });
    return { success: true, status: 'COMPLETED', ...('coins' in order ? { coins: order.coins } : {}) };
  }
  if (!recoverableStates.includes(order.status)) return { success: false, status: 'RECONCILIATION', message: 'Invoice closed. Contact support with the order reference.' };
  const verified = network.ton ? await verifyGram(i, txHash) : network.tron ? await verifyTronUsdt(i, txHash) : network.native ? await verifyNativeEth(network, i, txHash, rpc) : await blockchainTxVerifier.verifyTransaction({
    txHash, network: i.network, expectedRecipient: i.address, expectedAmountUsd: order.amount,
    expectedAtomicAmount: i.amountAtomic, minConfirmations: confirmations(),
    notBefore: new Date(Math.floor(i.createdAt.getTime() / 1000) * 1000), notAfter: i.expiresAt, minBlock: i.startBlock,
  });
  const hash = verified.txHash.toLowerCase();
  if (!verified.verified || hash !== (network.ton ? tonHashHex(txHash) : txHash.toLowerCase())) throw new Error('Payment could not be independently verified');
  const sender = 'sender' in verified && typeof verified.sender === 'string' ? verified.sender : null;
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "ShopCryptoInvoice" WHERE "id" = ${i.id} FOR UPDATE`;
    const existing=await tx.shopCryptoInvoice.findUniqueOrThrow({where:{id:i.id}});
    if(await tx.shopCryptoCase.findFirst({where:{refundHash:hash}}))throw new Error('Hash already recorded as a refund');
    const claim=await tx.shopCryptoInvoice.updateMany({where:{id:i.id,OR:[{transactionHash:null},{transactionHash:hash}]},data:{transactionHash:hash,verifiedAt:existing.verifiedAt||new Date(),paymentSender:sender||existing.paymentSender}});
    if(claim.count!==1)throw new Error('A different payment is already attached to the invoice');
    if(!existing.verifiedAt)await appendAuditLog(tx,{userId:i.payerId,action:'SHOP_CRYPTO_PAYMENT_VERIFIED',metadata:{invoiceId:i.id,network:i.network,hash}});
  });
  const hold=await prisma.shopCryptoCase.findUnique({where:{invoiceId:i.id}});
  if(hold?.kind==='REFUND'&&hold.status!=='REJECTED')return {success:false,status:'RECONCILIATION',message:'Payment verified; refund review pending.'};
  if (i.product === 'coins') await walletService.completeCoinPurchase(i.payerId, i.orderId, {
    mode: 'live', dedicatedInvoiceId:i.id, providerOrderId: shopPaymentReference(i.network,hash), verification: { invoiceId: i.id, onChain: verified },
  });
  else await verificationPaymentService.activateEntitlementFromOrder(i.payerId, order, {
    mode: 'live', dedicatedInvoiceId:i.id, providerReference: shopPaymentReference(i.network,hash), metadata: { onChain: verified, invoiceId: i.id },
  });
  await prisma.shopCryptoInvoice.updateMany({ where: { id: i.id, transactionHash: hash }, data: { settledAt: new Date() } });
  return { success: true, status: 'COMPLETED', ...('coins' in order ? { coins: order.coins } : {}) };
}

async function checkInvoice(i: ShopCryptoInvoice, suppliedHash?: string) {
  if (running.has(i.id)) return { success: false, status: 'PROCESSING', message: 'Payment is being checked.' };
  running.add(i.id);
  try {
    const network = getBlockchainNetwork(i.network);
    const order = await orderFor(i);
    if (!network || !shopCryptoNetworks().includes(network.id) || !order || !shopCryptoAddresses(i.network).includes(i.address)) throw new Error('Invoice unavailable');
    if (order.status === 'COMPLETED') {
      await prisma.shopCryptoInvoice.updateMany({ where: { id: i.id, settledAt: null }, data: { settledAt: new Date() } });
      return { success: true, status: 'COMPLETED', ...('coins' in order ? { coins: order.coins } : {}) };
    }
    if (!recoverableStates.includes(order.status) || (!i.transactionHash && Date.now() > i.expiresAt.getTime()+recoveryMs && !suppliedHash)) return { success: false, status: 'RECONCILIATION', message: 'Invoice closed. If you sent payment, contact support with the order reference and transaction hash.' };
    if (suppliedHash && !(network.ton ? tonHashHex(suppliedHash) : (network.tron ? /^[0-9a-f]{64}$/i : /^0x[0-9a-f]{64}$/i).test(suppliedHash))) throw new Error('Enter a valid transaction hash');
    if (i.transactionHash || suppliedHash) {
      try { return await verifyAndSettle(i, i.transactionHash || suppliedHash!); }
      catch (e) {
        if (e instanceof BlockchainTxVerificationError && ['LOW_CONFIRMATIONS', 'TRANSACTION_PENDING', 'TRANSACTION_NOT_FOUND'].includes(e.code)) return { success: false, status: 'PROCESSING', message: 'Waiting for network confirmation.' };
        throw e;
      }
    }
    if (network.ton || network.tron) {
      for (const hash of await (network.ton ? discoverGram(i) : discoverTronUsdt(i))) {
        try { return await verifyAndSettle(i, hash); }
        catch (e) {
          if (e instanceof BlockchainTxVerificationError && !e.transient && !['LOW_CONFIRMATIONS', 'TRANSACTION_PENDING', 'TRANSACTION_NOT_FOUND'].includes(e.code)) continue;
          throw e;
        }
      }
      return { success: false, status: 'PENDING', message: network.ton ? 'Waiting for finalized GRAM payment.' : 'Waiting for solidified TRON USDT payment.' };
    }
    const head = await getHead(network);
    let safeHead = head - confirmations() + 1;
    if (network.chainId === 1) {
      const finalized = await rpc(network, 'eth_getBlockByNumber', ['finalized', false]);
      if (!finalized || typeof finalized !== 'object') throw new Error('Ethereum finality unavailable');
      safeHead = Math.min(safeHead, hexNumber((finalized as Record<string, unknown>).number));
    }
    if (safeHead < i.scanCursor) return { success: false, status: 'PENDING', message: 'Waiting for payment.' };
    const end = Math.min(safeHead, i.scanCursor + (network.native ? 7 : 99));
    if (network.native) {
      // Native ETH has no ERC-20 Transfer event. Scan bounded finalized blocks
      // for direct transfers only; verify the receipt separately before crediting.
      for (let height = i.scanCursor; height <= end; height++) {
        const raw = await rpc(network, 'eth_getBlockByNumber', ['0x' + height.toString(16), true]);
        if (!raw || typeof raw !== 'object') throw new Error('Finalized block unavailable');
        const block = raw as Record<string, unknown>;
        if (hexNumber(block.number) !== height || !Array.isArray(block.transactions)) throw new Error('Invalid finalized block');
        for (const item of block.transactions) {
          if (!item || typeof item !== 'object' || typeof item.to !== 'string' || item.to.toLowerCase() !== i.address || item.input !== '0x' || typeof item.value !== 'string' || !/^0x[0-9a-f]+$/i.test(item.value) || BigInt(item.value).toString() !== i.amountAtomic || typeof item.hash !== 'string') continue;
          try { return await verifyAndSettle(i, item.hash); }
          catch (e) {
            if (e instanceof BlockchainTxVerificationError && !e.transient && !['LOW_CONFIRMATIONS', 'TRANSACTION_PENDING', 'TRANSACTION_NOT_FOUND'].includes(e.code)) continue;
            throw e;
          }
        }
      }
      await prisma.shopCryptoInvoice.updateMany({ where: { id: i.id, scanCursor: i.scanCursor }, data: { scanCursor: end + 1 } });
      return { success: false, status: 'PENDING', message: 'Waiting for finalized ETH payment.' };
    }
    const logs = await rpc(network, 'eth_getLogs', [{
      address: network.tokenContract, fromBlock: '0x' + i.scanCursor.toString(16), toBlock: '0x' + end.toString(16),
      topics: [ERC20_TRANSFER_EVENT_SIGNATURE, null, '0x' + i.address.slice(2).padStart(64, '0')],
    }]);
    if (!Array.isArray(logs)) throw new Error('Invalid chain log response');
    const candidates = logs.filter(l => l && typeof l === 'object' && !l.removed && typeof l.data === 'string' && /^0x[0-9a-f]+$/i.test(l.data) && BigInt(l.data).toString() === i.amountAtomic && typeof l.transactionHash === 'string' && /^0x[0-9a-f]{64}$/i.test(l.transactionHash));
    for (const log of candidates) {
      try { return await verifyAndSettle(i, log.transactionHash); }
      catch (e) {
        if (e instanceof BlockchainTxVerificationError && !e.transient && !['LOW_CONFIRMATIONS', 'TRANSACTION_PENDING', 'TRANSACTION_NOT_FOUND'].includes(e.code)) continue;
        throw e;
      }
    }
    await prisma.shopCryptoInvoice.updateMany({ where: { id: i.id, scanCursor: i.scanCursor }, data: { scanCursor: end + 1 } });
    return { success: false, status: 'PENDING', message: 'Waiting for payment.' };
  } finally {
    running.delete(i.id);
    await prisma.shopCryptoInvoice.updateMany({ where: { id: i.id }, data: { lastCheckedAt: new Date() } });
  }
}
export async function checkShopCryptoInvoice(payerId: string, orderId: string, txHash?: string) {
  if (!shopLiveCryptoEnabled()) throw new Error('Live crypto checkout is not configured');
  const invoice = await prisma.shopCryptoInvoice.findFirst({ where: { payerId, orderId } });
  if (!invoice) throw new Error('Invoice not found');
  return checkInvoice(invoice, txHash);
}
let monitorRunning = false;
export function startShopCryptoMonitor() {
  if (!shopLiveCryptoEnabled() || monitorRunning) return;
  monitorRunning = true;
  const tick = async () => {
    try {
      if (!shopLiveCryptoEnabled()) return;
      const invoices = await prisma.shopCryptoInvoice.findMany({
        where: { settledAt: null, AND:[{OR:[{supportCase:null},{supportCase:{status:'REJECTED'}},{supportCase:{kind:'RECONCILIATION'}}]},{OR:[{expiresAt:{gt:new Date(Date.now()-recoveryMs)}},{transactionHash:{not:null}}]}] },
        orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } }, take: 12,
      });
      await Promise.allSettled(invoices.map(i => checkInvoice(i)));
    } catch {
      console.warn('[SHOP-CRYPTO] Invoice monitoring temporarily unavailable');
    } finally {
      if (shopLiveCryptoEnabled()) setTimeout(tick, 15000);
      else monitorRunning = false;
    }
  };
  void tick();
}
