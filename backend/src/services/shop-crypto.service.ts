import * as QRCode from 'qrcode';
import { prisma } from '../prisma';
import { ShopCryptoInvoice } from '@prisma/client';
import { getBlockchainNetwork, getMinBlockchainConfirmations, ERC20_TRANSFER_EVENT_SIGNATURE, BlockchainNetworkConfig } from '../config/blockchain-networks.config';
import { shopCryptoAddresses, shopLiveCryptoEnabled } from '../config/shop-crypto.config';
import { coinPaymentService } from './coin-payment.service';
import { verificationPaymentService } from './verification-payment.service';
import { walletService } from './wallet.service';
import { blockchainTxVerifier, BlockchainTxVerificationError } from './blockchain-verifier.service';

type Product = 'coins' | 'badge';
const confirmations = () => Math.max(12, getMinBlockchainConfirmations());
const pendingStates = ['PENDING', 'PROCESSING', 'PAID'];

export function priceToAtomic(amount: number, decimals: number): string {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(amount - cents / 100) > 1e-8 || !Number.isInteger(decimals) || decimals < 2 || decimals > 18) throw new Error('Invalid server price');
  return (BigInt(cents) * BigInt(10) ** BigInt(decimals - 2)).toString();
}
export function paymentUri(network: BlockchainNetworkConfig, address: string, atomic: string): string {
  if (!/^0x[0-9a-f]{40}$/.test(address) || !/^[1-9][0-9]*$/.test(atomic)) throw new Error('Invalid invoice');
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
async function orderFor(i: ShopCryptoInvoice) {
  if (i.product === 'coins') return prisma.purchaseOrder.findFirst({ where: { id: i.orderId, userId: i.payerId, paymentMode: 'live' } });
  if (i.product === 'badge') return prisma.verificationPurchase.findFirst({ where: { id: i.orderId, userId: i.payerId, paymentMode: 'live' } });
  throw new Error('Invalid product');
}
async function renderInvoice(i: ShopCryptoInvoice) {
  const network = getBlockchainNetwork(i.network);
  const order = await orderFor(i);
  if (!network || !order || order.recipientUserId || !shopCryptoAddresses().includes(i.address)) throw new Error('Invoice unavailable');
  if (priceToAtomic(order.amount, network.tokenDecimals) !== i.amountAtomic) throw new Error('Invoice price mismatch');
  const uri = paymentUri(network, i.address, i.amountAtomic);
  return { orderId: i.orderId, product: i.product, amount: order.amount, currency: 'USD', network: i.network,
    mode: 'live' as const, expiresAt: i.expiresAt.toISOString(), address: i.address, paymentUri: uri,
    qrCode: await QRCode.toDataURL(uri, { width: 360, margin: 3, errorCorrectionLevel: 'M' }),
    token: network.tokenName, tokenAmount: order.amount.toFixed(2), status: order.status,
    ...(i.product === 'coins' && 'coins' in order ? { coins: order.coins } : {}),
    ...(i.product === 'badge' && 'planId' in order ? { planId: order.planId } : {}),
  };
}

export async function createShopCryptoInvoice(payerId: string, input: Record<string, unknown>) {
  if (!shopLiveCryptoEnabled()) throw new Error('Live crypto checkout is not configured');
  const product: Product = input.product === 'coins' ? 'coins' : input.product === 'badge' ? 'badge' : (() => { throw new Error('Invalid product'); })();
  if (input.recipientId != null || input.renew === true) throw new Error('Live gifts and recurring billing are not enabled');
  const network = getBlockchainNetwork(input.network);
  if (!network) throw new Error('Unsupported network');
  const startBlock = await getHead(network) + 1;
  // Keep the existing catalog and fulfillment services authoritative. No price
  // or amount supplied by the client is ever used to calculate the invoice.
  const data = product === 'coins'
    ? await coinPaymentService.initializeCoinPurchase(payerId, input.packageId, network.id, undefined, input.customCoins)
    : await verificationPaymentService.initializeVerificationPurchase(payerId, input.planId, network.id);
  const orderId = String(data.orderId);
  const amount = Number(data.amount);
  const expiresAt = new Date(String(data.expiresAt));
  if (data.mode !== 'live' || !orderId || !Number.isFinite(expiresAt.getTime())) throw new Error('Order unavailable');
  const atomic = priceToAtomic(amount, network.tokenDecimals);
  // Never reuse a receiving address, even if an earlier order expired.
  const addresses = shopCryptoAddresses();
  const used = await prisma.shopCryptoInvoice.findMany({ where: { address: { in: addresses } }, select: { address: true } });
  const reserved = new Set(used.map(a => a.address));
  let invoice: ShopCryptoInvoice | undefined;
  for (const address of addresses.filter(a => !reserved.has(a))) {
    try {
      invoice = await prisma.shopCryptoInvoice.create({ data: { product, orderId, payerId, network: network.id, address, amountAtomic: atomic, expiresAt, startBlock, scanCursor: startBlock } });
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
  if (!shopLiveCryptoEnabled()) throw new Error('Live crypto checkout is not configured');
  const invoice = await prisma.shopCryptoInvoice.findFirst({ where: { payerId, orderId } });
  if (!invoice) throw new Error('Invoice not found');
  return renderInvoice(invoice);
}

const running = new Set<string>();
async function verifyAndSettle(i: ShopCryptoInvoice, txHash: string) {
  const network = getBlockchainNetwork(i.network);
  const order = await orderFor(i);
  if (!network || !order || order.recipientUserId || !shopCryptoAddresses().includes(i.address) ||
      priceToAtomic(order.amount, network.tokenDecimals) !== i.amountAtomic) throw new Error('Invoice mismatch');
  if (order.status === 'COMPLETED') {
    await prisma.shopCryptoInvoice.updateMany({ where: { id: i.id, settledAt: null }, data: { settledAt: new Date() } });
    return { success: true, status: 'COMPLETED', ...('coins' in order ? { coins: order.coins } : {}) };
  }
  if (!pendingStates.includes(order.status) || Date.now() >= i.expiresAt.getTime()) return { success: false, status: 'RECONCILIATION', message: 'Invoice closed. If payment was sent, contact support with the order reference and transaction hash.' };
  const verified = await blockchainTxVerifier.verifyTransaction({
    txHash, network: i.network, expectedRecipient: i.address, expectedAmountUsd: order.amount,
    expectedAtomicAmount: i.amountAtomic, minConfirmations: confirmations(),
    notBefore: new Date(Math.floor(i.createdAt.getTime() / 1000) * 1000), notAfter: i.expiresAt, minBlock: i.startBlock,
  });
  const hash = verified.txHash.toLowerCase();
  if (!verified.verified || hash !== txHash.toLowerCase()) throw new Error('Payment could not be independently verified');
  const claim = await prisma.shopCryptoInvoice.updateMany({
    where: { id: i.id, OR: [{ transactionHash: null }, { transactionHash: hash }] },
    data: { transactionHash: hash },
  });
  if (claim.count !== 1) throw new Error('A different payment is already attached to the invoice');
  if (i.product === 'coins') await walletService.completeCoinPurchase(i.payerId, i.orderId, {
    mode: 'live', providerOrderId: hash, verification: { invoiceId: i.id, onChain: verified },
  });
  else await verificationPaymentService.activateEntitlementFromOrder(i.payerId, order, {
    mode: 'live', providerReference: hash, metadata: { onChain: verified, invoiceId: i.id },
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
    if (!network || !order || !shopCryptoAddresses().includes(i.address)) throw new Error('Invoice unavailable');
    if (order.status === 'COMPLETED') {
      await prisma.shopCryptoInvoice.updateMany({ where: { id: i.id, settledAt: null }, data: { settledAt: new Date() } });
      return { success: true, status: 'COMPLETED', ...('coins' in order ? { coins: order.coins } : {}) };
    }
    if (!pendingStates.includes(order.status) || Date.now() >= i.expiresAt.getTime()) return { success: false, status: 'RECONCILIATION', message: 'Invoice expired or closed. If you sent payment, contact support with the order reference and transaction hash.' };
    if (suppliedHash && !/^0x[0-9a-f]{64}$/i.test(suppliedHash)) throw new Error('Enter a valid transaction hash');
    if (i.transactionHash || suppliedHash) {
      try { return await verifyAndSettle(i, i.transactionHash || suppliedHash!); }
      catch (e) {
        if (e instanceof BlockchainTxVerificationError && ['LOW_CONFIRMATIONS', 'TRANSACTION_PENDING', 'TRANSACTION_NOT_FOUND'].includes(e.code)) return { success: false, status: 'PROCESSING', message: 'Waiting for network confirmation.' };
        throw e;
      }
    }
    const head = await getHead(network);
    const safeHead = head - confirmations() + 1;
    if (safeHead < i.scanCursor) return { success: false, status: 'PENDING', message: 'Waiting for payment.' };
    const end = Math.min(safeHead, i.scanCursor + 99);
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
        where: { settledAt: null, expiresAt: { gt: new Date() } },
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
