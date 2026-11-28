import { randomUUID } from 'crypto';
import { prisma } from '../prisma';
import type { Prisma, ShopTreasuryTransfer, ShopCryptoInvoice } from '@prisma/client';
import { appendAuditLog } from '../security/auditLog';
import { automaticTreasuryConfig, isAutoNetwork, positiveAtomic } from '../config/shop-treasury-auto.config';
import { getBlockchainNetwork, getMinBlockchainConfirmations, BlockchainNetworkConfig } from '../config/blockchain-networks.config';
import { canonicalTreasuryAddress, expectedInvoiceAtomic, preflightSpecial, verifySpecialOutgoing } from './shop-treasury-chain.service';
import { treasuryHash } from '../config/shop-treasury-hash';
import { assertVerifiedInvoice } from './shop-treasury.service';
import { blockchainTxVerifier, BlockchainTxVerificationError } from './blockchain-verifier.service';
import { requestCustody, SignerConfig, SettlementIntent } from './shop-treasury-signer.service';

const SYSTEM = 'SYSTEM_TREASURY';
const WORK_STATES = ['AUTO_QUEUED', 'AUTO_DISPATCHING', 'AUTO_CONFIRMING'];
const delay = (ms: number) => new Date(Date.now() + ms);
type Row = ShopTreasuryTransfer & { invoice: ShopCryptoInvoice };
function cents(amount: number) {
  const n = Math.round(amount * 100);
  if (!Number.isSafeInteger(n) || n <= 0 || Math.abs(amount - n / 100) > 1e-8) throw new Error('Invalid invoice value');
  return n;
}

export function buildSettlementIntent(row: Row, config: SignerConfig): SettlementIntent {
  const chain = getBlockchainNetwork(row.network);
  const policy = config.networks.find(n => n.network === row.network);
  if (!row.automation || !isAutoNetwork(row.network) || !chain || !policy || row.signerPolicyId !== config.policyId ||
      row.destination !== policy.destination || row.maxFeeAtomic !== policy.maxFeeAtomic || !row.signerRequestId ||
      !row.dispatchDeadline || !row.invoice.transactionHash || !positiveAtomic(row.amountAtomic) ||
      row.source !== row.invoice.address || row.amountAtomic !== row.invoice.amountAtomic || row.network !== row.invoice.network ||
      row.source === row.destination || canonicalTreasuryAddress(row.network,row.source) !== row.source || canonicalTreasuryAddress(row.network,row.destination) !== row.destination || !treasuryHash(row.network,row.invoice.transactionHash)) throw new Error('Settlement policy or invoice binding changed');
  return { requestId: row.signerRequestId, policyId: config.policyId, network: row.network, chainId: chain.chainId,
    tokenContract: chain.tokenContract, source: row.source, destination: row.destination, amountAtomic: row.amountAtomic,
    maxFeeAtomic: policy.maxFeeAtomic, incomingTransactionHash: row.invoice.transactionHash, expiresAt: row.dispatchDeadline.toISOString() };
}

async function rpc(chain: BlockchainNetworkConfig, method: string, params: unknown[]) {
  const response = await fetch(chain.rpcUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'vanta-treasury', method, params }) });
  if (!response.ok) throw new Error('Chain provider unavailable');
  const body = await response.json() as { result?: unknown; error?: unknown };
  if (body.error || body.result === undefined) throw new Error('Chain provider unavailable');
  return body.result;
}
function hex(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Invalid chain result');
  return BigInt(value);
}
async function preflight(row: Row, intent: SettlementIntent) {
  const chain = getBlockchainNetwork(row.network)!;
  if (await prisma.shopCryptoInvoice.findUnique({ where: { address: row.destination }, select: { id: true } })) throw new Error('Treasury destination is a historical invoice address');
  const order = await assertVerifiedInvoice(prisma, row.invoice);
  if (cents(order.amount) !== row.orderAmountCents || expectedInvoiceAtomic(row.invoice,order.amount,chain) !== row.amountAtomic) throw new Error('Invoice amount changed');
  if (chain.native || chain.tron || chain.ton) { await preflightSpecial(row,chain,rpc); return; }
  await blockchainTxVerifier.verifyTransaction({ network: row.network, txHash: intent.incomingTransactionHash,
    expectedRecipient: row.source, expectedAmountUsd: order.amount, expectedAtomicAmount: row.amountAtomic,
    notBefore: new Date(Math.floor(row.invoice.createdAt.getTime() / 1000) * 1000), notAfter: row.invoice.expiresAt,
    minBlock: row.invoice.startBlock, minConfirmations: Math.max(12, getMinBlockchainConfirmations()) });
  if (hex(await rpc(chain, 'eth_chainId', [])) !== BigInt(chain.chainId)) throw new Error('Wrong chain');
  const balance = await rpc(chain, 'eth_call', [{ to: chain.tokenContract, data: '0x70a08231' + row.source.slice(2).padStart(64, '0') }, 'latest']);
  if (hex(balance) < BigInt(row.amountAtomic)) throw new Error('Insufficient token balance');
  if (await rpc(chain, 'eth_getCode', [row.source, 'latest']) !== '0x') throw new Error('Source is not a direct custody account');
  const gasBalance = hex(await rpc(chain, 'eth_getBalance', [row.source, 'latest']));
  if (gasBalance < BigInt(intent.maxFeeAtomic)) throw new Error('Source gas balance below fee reserve');
  const data = '0xa9059cbb' + row.destination.slice(2).padStart(64, '0') + BigInt(row.amountAtomic).toString(16).padStart(64, '0');
  const estimate = hex(await rpc(chain, 'eth_estimateGas', [{ from: row.source, to: chain.tokenContract, data, value: '0x0' }]));
  const price = hex(await rpc(chain, 'eth_gasPrice', []));
  if (estimate <= BigInt(0) || price <= BigInt(0) || estimate * price > BigInt(intent.maxFeeAtomic)) throw new Error('Estimated network fee exceeds cap');
  // Base L1 fee and actual max fee must additionally be enforced by the custodian.
}

async function enqueue(config: SignerConfig) {
  // No historical invoice is queued before a configured, explicit activation.
  const start = process.env.VANTA_TREASURY_AUTO_NOT_BEFORE || '';
  const since = new Date(start);
  if (!start || !Number.isFinite(since.getTime()) || since > new Date()) return;
  // Filter completed live orders and caps in SQL, rather than repeatedly
  // selecting the same refunded/oversized oldest invoices and starving new ones.
  const rows = await prisma.$queryRaw<ShopCryptoInvoice[]> `
    SELECT i.* FROM "ShopCryptoInvoice" i
    LEFT JOIN "ShopTreasuryTransfer" t ON t."invoiceId" = i."id"
    LEFT JOIN "ShopCryptoCase" c ON c."invoiceId"=i."id"
    WHERE i."settledAt" >= ${since} AND i."transactionHash" IS NOT NULL AND t."id" IS NULL AND (c."id" IS NULL OR c."status" IN ('REJECTED','RESOLVED'))
      AND i."network" = ANY(${config.networks.map(n => n.network)}::text[])
      AND (
        (i."product" = 'coins' AND EXISTS (
          SELECT 1 FROM "PurchaseOrder" p WHERE p."id" = i."orderId"
            AND p."userId" = i."payerId" AND p."status" = 'COMPLETED'
            AND p."paymentMode" = 'live' AND p."paymentMethod" = i."network"
            AND p."providerOrderId" = 'live:' || CASE WHEN i."network" = 'gram-ton' THEN 'ton:' WHEN i."network" = 'usdt-trc20' THEN 'tron:' ELSE '' END || i."transactionHash"
            AND p."amount" > 0 AND p."amount" <= ${config.maxOrderCents / 100}))
        OR (i."product" = 'badge' AND EXISTS (
          SELECT 1 FROM "VerificationPurchase" p WHERE p."id" = i."orderId"
            AND p."userId" = i."payerId" AND p."status" = 'COMPLETED'
            AND p."paymentMode" = 'live' AND p."network" = i."network"
            AND p."providerOrderId" = 'live:' || CASE WHEN i."network" = 'gram-ton' THEN 'ton:' WHEN i."network" = 'usdt-trc20' THEN 'tron:' ELSE '' END || i."transactionHash"
            AND p."amount" > 0 AND p."amount" <= ${config.maxOrderCents / 100}))
      )
    ORDER BY i."settledAt", i."id" LIMIT 25
  `;
  for (const invoice of rows) {
    try {
      await prisma.$transaction(async tx => {
        // Serialize the daily cap across every worker and chain.
        await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(8675310)) AS treasury_lock`;
        const active = automaticTreasuryConfig();
        const policy = active?.networks.find(n => n.network === invoice.network);
        if (!active || active.policyId !== config.policyId || !policy) return;
        if (await tx.shopCryptoInvoice.findUnique({ where: { address: policy.destination }, select: { id: true } })) return;
        const order = await assertVerifiedInvoice(tx, invoice);
        const usd = cents(order.amount);
        const chain = getBlockchainNetwork(invoice.network);
        if (!chain || !positiveAtomic(invoice.amountAtomic) || expectedInvoiceAtomic(invoice,order.amount,chain) !== invoice.amountAtomic ||
            invoice.address === policy.destination || usd > active.maxOrderCents) return;
        const day = new Date(); day.setUTCHours(0, 0, 0, 0);
        const totals = await tx.shopTreasuryTransfer.aggregate({ where: { automation: true, authorizedAt: { gte: day } }, _sum: { orderAmountCents: true } });
        if ((totals._sum.orderAmountCents || 0) + usd > active.dailyCapCents) return;
        const record = await tx.shopTreasuryTransfer.create({ data: {
          invoiceId: invoice.id, network: invoice.network, source: invoice.address, destination: policy.destination,
          amountAtomic: invoice.amountAtomic, status: 'AUTO_QUEUED', authorizedBy: SYSTEM, automation: true,
          maxFeeAtomic: policy.maxFeeAtomic, signerRequestId: randomUUID(), signerPolicyId: active.policyId,
          orderAmountCents: usd, nextAttemptAt: new Date(),
        } });
        await appendAuditLog(tx, { action: 'TREASURY_AUTO_QUEUED', severity: 'CRITICAL', metadata: { transferId: record.id, invoiceId: invoice.id, network: invoice.network, source: record.source, destination: record.destination, amountAtomic: record.amountAtomic, policyId: record.signerPolicyId } });
      }, { isolationLevel: 'ReadCommitted' });
    } catch { /* Duplicate or ineligible rows remain unmodified; manual review may be needed. */ }
  }
}
async function change(row: Row, lease: string, data: Prisma.ShopTreasuryTransferUpdateManyMutationInput, action?: string) {
  await prisma.$transaction(async tx => {
    const count = await tx.shopTreasuryTransfer.updateMany({ where: { id: row.id, leaseToken: lease, leaseUntil: { gt: new Date() }, status: row.status, automation: true }, data });
    if (count.count !== 1) throw new Error('Settlement lease lost');
    if (action) await appendAuditLog(tx, { action, severity: 'CRITICAL', metadata: { transferId: row.id, network: row.network, requestId: row.signerRequestId, status: data.status, transactionHash: data.transactionHash } });
  });
}
async function confirmOutgoing(row: Row, lease: string) {
  const chain = getBlockchainNetwork(row.network)!;
  const hash = row.transactionHash!;
  if (chain.native || chain.tron || chain.ton) {
    const fee = await verifySpecialOutgoing(row,chain,rpc);
    if (!row.maxFeeAtomic || fee > BigInt(row.maxFeeAtomic)) {
      await change(row,lease,{status:'AUTO_REVIEW',lastFailure:'Verified transfer exceeded fee policy; reconcile without rebroadcast.',nextAttemptAt:null},'TREASURY_AUTO_FEE_EXCEPTION');
    } else await change(row,lease,{status:'VERIFIED',verifiedAt:new Date(),nextAttemptAt:null,lastFailure:null},'TREASURY_AUTO_VERIFIED');
    return;
  }
  const amount = Number(BigInt(row.amountAtomic)) / Number(BigInt(10) ** BigInt(chain.tokenDecimals));
  const proof = await blockchainTxVerifier.verifyTransaction({ network: row.network, txHash: hash,
    expectedSender: row.source, expectedRecipient: row.destination, expectedAmountUsd: amount, expectedAtomicAmount: row.amountAtomic,
    notBefore: new Date(Math.floor(row.dispatchStartedAt!.getTime() / 1000) * 1000), notAfter: new Date(),
    minConfirmations: Math.max(12, getMinBlockchainConfirmations()) });
  if (!proof.verified || proof.txHash.toLowerCase() !== hash || proof.sender?.toLowerCase() !== row.source) throw new Error('Outgoing proof mismatch');
  // Do not accept an allowance-based transferFrom, batched transaction or a
  // different calldata that happens to emit a matching log.
  const txRaw = await rpc(chain, 'eth_getTransactionByHash', [hash]);
  if (!txRaw || typeof txRaw !== 'object') throw new Error('Outgoing transaction unavailable');
  const outgoing = txRaw as Record<string, unknown>;
  const data = '0xa9059cbb' + row.destination.slice(2).padStart(64, '0') + BigInt(row.amountAtomic).toString(16).padStart(64, '0');
  if (String(outgoing.hash).toLowerCase() !== hash || String(outgoing.from).toLowerCase() !== row.source ||
      String(outgoing.to).toLowerCase() !== chain.tokenContract || String(outgoing.input).toLowerCase() !== data ||
      hex(outgoing.value) !== BigInt(0) || String(outgoing.blockHash).toLowerCase() !== proof.blockHash?.toLowerCase()) {
    await change(row, lease, { status: 'AUTO_REVIEW', nextAttemptAt: null, lastFailure: 'Outgoing transaction differs from authorized direct transfer; do not rebroadcast.' }, 'TREASURY_AUTO_REVIEW');
    return;
  }
  const raw = await rpc(chain, 'eth_getTransactionReceipt', [hash]);
  if (!raw || typeof raw !== 'object') throw new Error('Outgoing receipt unavailable');
  const receipt = raw as Record<string, unknown>;
  if (String(receipt.transactionHash).toLowerCase() !== hash || String(receipt.blockHash).toLowerCase() !== proof.blockHash?.toLowerCase() || receipt.status !== '0x1') throw new Error('Outgoing receipt changed');
  let fee = hex(receipt.gasUsed) * hex(receipt.effectiveGasPrice);
  if (row.network === 'usdc-base') {
    fee += hex(receipt.l1Fee);
    if (receipt.operatorFee !== undefined && receipt.operatorFee !== null) fee += hex(receipt.operatorFee);
    else if (receipt.operatorFeeScalar != null && receipt.operatorFeeConstant != null) fee += hex(receipt.operatorFeeConstant) + hex(receipt.gasUsed) * hex(receipt.operatorFeeScalar) / BigInt(1000000);
  }
  if (!row.maxFeeAtomic || fee > BigInt(row.maxFeeAtomic)) {
    await change(row, lease, { status: 'AUTO_REVIEW', lastFailure: 'Verified transfer exceeded fee policy; reconcile without rebroadcast.', nextAttemptAt: null }, 'TREASURY_AUTO_FEE_EXCEPTION');
    return;
  }
  await change(row, lease, { status: 'VERIFIED', verifiedAt: new Date(), nextAttemptAt: null, lastFailure: null }, 'TREASURY_AUTO_VERIFIED');
}
async function applyResult(row: Row, lease: string, result: Awaited<ReturnType<typeof requestCustody>>) {
  if (result.status === 'broadcast' && result.transactionHash) {
    await change(row, lease, { status: 'AUTO_CONFIRMING', transactionHash: result.transactionHash, submittedAt: new Date(), nextAttemptAt: delay(30000), lastFailure: null }, 'TREASURY_AUTO_BROADCAST_RECORDED');
  } else if (result.status === 'rejected') {
    await change(row, lease, { status: 'AUTO_REVIEW', nextAttemptAt: null, lastFailure: 'Custodian rejected the immutable instruction; review before any external action.' }, 'TREASURY_AUTO_REVIEW');
  } else {
    // A timeout or not_found does NOT authorize another PUT. Only status lookup.
    await change(row, lease, { nextAttemptAt: delay(60000), lastFailure: result.status === 'not_found' ? 'Custody status unknown; no automatic resubmission.' : null });
  }
}
export async function processTreasurySettlement(id: string, config: SignerConfig) {
  const lease = randomUUID();
  const now = new Date();
  const locked = await prisma.shopTreasuryTransfer.updateMany({ where: {
    id, automation: true, status: { in: WORK_STATES }, nextAttemptAt: { lte: now },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
  }, data: { leaseToken: lease, leaseUntil: delay(180000) } });
  if (locked.count !== 1) return;
  let row = await prisma.shopTreasuryTransfer.findUnique({ where: { id }, include: { invoice: true } });
  try {
    if (!row || row.leaseToken !== lease) return;
    const active = automaticTreasuryConfig();
    if (!active || active.policyId !== config.policyId) return;
    if (row.status === 'AUTO_CONFIRMING') { await confirmOutgoing(row, lease); return; }
    if (row.status === 'AUTO_QUEUED') {
      // Set the immutable deadline before external submission; persist the
      // dispatch state BEFORE calling the signer. A crash cannot create a second PUT.
      const pending = { ...row, dispatchDeadline: delay(5 * 60000) };
      const intent = buildSettlementIntent(pending, active);
      await preflight(row, intent);
      const again = automaticTreasuryConfig();
      if (!again || again.policyId !== active.policyId) return;
      buildSettlementIntent(pending, again);
      const day = new Date(); day.setUTCHours(0, 0, 0, 0);
      // Enforce a second daily cap on dispatch, not just queue creation.
      const dispatchAt = new Date();
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(8675310)) AS treasury_lock`;
        const sum = await tx.shopTreasuryTransfer.aggregate({ where: { automation: true, dispatchStartedAt: { gte: day } }, _sum: { orderAmountCents: true } });
        if (!row!.orderAmountCents || row!.orderAmountCents > again.maxOrderCents || (sum._sum.orderAmountCents || 0) + row!.orderAmountCents > again.dailyCapCents) throw new Error('Daily treasury dispatch limit');
        const count = await tx.shopTreasuryTransfer.updateMany({ where: { id, leaseToken: lease, status: 'AUTO_QUEUED', dispatchStartedAt: null, leaseUntil: { gt: new Date() } }, data: { status: 'AUTO_DISPATCHING', dispatchStartedAt: dispatchAt, dispatchDeadline: pending.dispatchDeadline, nextAttemptAt: delay(60000) } });
        if (count.count !== 1) throw new Error('Settlement lease lost');
        // Recheck eligibility inside the transaction that persists the dispatch.
        // Lock the original purchase against concurrent refund/status changes.
        const invoice = row!.invoice;
        if (invoice.product === 'coins') await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${invoice.orderId} FOR UPDATE`;
        else if (invoice.product === 'badge') await tx.$queryRaw`SELECT "id" FROM "VerificationPurchase" WHERE "id" = ${invoice.orderId} FOR UPDATE`;
        else throw new Error('Unknown invoice product');
        const currentInvoice = await tx.shopCryptoInvoice.findUnique({ where: { id: invoice.id } });
        if (!currentInvoice || currentInvoice.transactionHash !== invoice.transactionHash || currentInvoice.address !== row!.source || currentInvoice.amountAtomic !== row!.amountAtomic || currentInvoice.network !== row!.network) throw new Error('Invoice changed before dispatch');
        const currentOrder = await assertVerifiedInvoice(tx, currentInvoice);
        if (cents(currentOrder.amount) !== row!.orderAmountCents) throw new Error('Order amount changed before dispatch');
        await appendAuditLog(tx, { action: 'TREASURY_AUTO_DISPATCH_STARTED', severity: 'CRITICAL', metadata: { transferId: id, requestId: row!.signerRequestId, intent } });
      });
      row = { ...pending, status: 'AUTO_DISPATCHING', dispatchStartedAt: dispatchAt };
      // Re-read configuration before the only submission. Any uncertainty is
      // recovered by GET, never by automatically creating another transaction.
      const final = automaticTreasuryConfig();
      if (!final || final.policyId !== active.policyId || Date.now() >= pending.dispatchDeadline.getTime()) return;
      buildSettlementIntent(row, final);
      const current = await prisma.shopTreasuryTransfer.findFirst({ where: { id, status: 'AUTO_DISPATCHING', leaseToken: lease, leaseUntil: { gt: new Date() } }, select: { id: true } });
      if (!current) return;
      // Last gate before contacting custody. A refund after submission still
      // requires separate reconciliation; the signer enforces its own policy.
      await assertVerifiedInvoice(prisma, row.invoice);
      await applyResult(row, lease, await requestCustody(final, intent, 'submit'));
      return;
    }
    if (row.status === 'AUTO_DISPATCHING') {
      const intent = buildSettlementIntent(row, active);
      const result = await requestCustody(active, intent, 'status');
      if (result.status === 'not_found' && row.dispatchDeadline && Date.now() > row.dispatchDeadline.getTime() + 10 * 60000) {
        await change(row, lease, { status: 'AUTO_REVIEW', nextAttemptAt: null, lastFailure: 'No custody record after deadline. Reconcile externally; never resubmit blindly.' }, 'TREASURY_AUTO_REVIEW');
        return;
      }
      await applyResult(row, lease, result);
    }
  } catch (error) {
    if (row && row.leaseToken === lease) {
      const permanent = row.status === 'AUTO_CONFIRMING' && error instanceof BlockchainTxVerificationError && !error.transient && !['TRANSACTION_PENDING', 'TRANSACTION_NOT_FOUND', 'LOW_CONFIRMATIONS'].includes(error.code);
      try { await change(row, lease, permanent ? { status: 'AUTO_REVIEW', nextAttemptAt: null, lastFailure: 'Outgoing transaction rejected by chain verifier. Do not rebroadcast.' } : { nextAttemptAt: delay(120000), lastFailure: row.status === 'AUTO_QUEUED' ? 'Preflight unavailable, balance or limit check failed; will retry.' : 'Custody or chain confirmation unavailable; status-only recovery.' }, permanent ? 'TREASURY_AUTO_REVIEW' : undefined); } catch { /* Lease may have expired; next worker recovers persisted state. */ }
    }
  } finally {
    await prisma.shopTreasuryTransfer.updateMany({ where: { id, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null } });
  }
}
let running = false;
export function startTreasurySettlementWorker() {
  if (running) return;
  running = true;
  const tick = async () => {
    try {
      const config = automaticTreasuryConfig();
      if (config) {
        await enqueue(config);
        const rows = await prisma.shopTreasuryTransfer.findMany({ where: { automation: true, status: { in: WORK_STATES }, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: 'asc' }, take: 4, select: { id: true } });
        await Promise.allSettled(rows.map(row => processTreasurySettlement(row.id, config)));
      }
    } catch { console.warn('[TREASURY] Settlement worker unavailable; no manual fallback broadcast'); }
    finally { setTimeout(tick, 30000).unref(); }
  };
  void tick();
}
