import { prisma } from '../prisma';
import { automaticTreasuryPublicStatus } from '../config/shop-treasury-auto.config';
import type { Prisma, ShopCryptoInvoice } from '@prisma/client';
import { appendAuditLog } from '../security/auditLog';
import { twoFactorAuth } from '../security/twoFactorAuth';
import { treasuryAddress, treasuryInstructionsEnabled, TREASURY_NETWORKS } from '../config/shop-treasury.config';
import { getBlockchainNetwork, getMinBlockchainConfirmations } from '../config/blockchain-networks.config';
import { blockchainTxVerifier } from './blockchain-verifier.service';
import { tonHashHex } from './shop-ton.service';

function reference(network: string, hash: string) {
  return network === 'gram-ton' ? 'ton:' + hash : network === 'usdt-trc20' ? 'tron:' + hash : hash;
}
export async function assertVerifiedInvoice(tx: Prisma.TransactionClient, invoice: ShopCryptoInvoice) {
  if (!invoice.settledAt || !invoice.transactionHash || !/^[1-9][0-9]*$/.test(invoice.amountAtomic)) throw new Error('Invoice is not verified and fulfilled');
  const hold=await tx.shopCryptoCase.findUnique({where:{invoiceId:invoice.id}});
  if(hold&&!['REJECTED','RESOLVED'].includes(hold.status))throw new Error('Invoice under payment review');
  const expected = 'live:' + reference(invoice.network, invoice.transactionHash);
  const where = { id: invoice.orderId, userId: invoice.payerId, status: 'COMPLETED', paymentMode: 'live', providerOrderId: expected };
  const order = invoice.product === 'coins' ? await tx.purchaseOrder.findFirst({ where: { ...where, paymentMethod: invoice.network } }) : invoice.product === 'badge' ? await tx.verificationPurchase.findFirst({ where: { ...where, network: invoice.network } }) : null;
  if (!order) throw new Error('Invoice order is not eligible for treasury transfer');
  return order;
}
export async function treasuryDashboard(cursor?: string) {
  const networks = TREASURY_NETWORKS.map(network => ({
    network, asset: getBlockchainNetwork(network)?.tokenName, decimals: getBlockchainNetwork(network)?.tokenDecimals,
    destination: treasuryAddress(network),
  }));
  // Exact atomic-unit sums, only for verified fulfilled orders. Not an on-chain
  // balance or a statement of realized profit; refunds require reconciliation.
  const totals = await prisma.$queryRaw<Array<{ network: string; amountAtomic: string; count: number; status: string }>>`
    SELECT i."network", SUM(CAST(i."amountAtomic" AS numeric))::text AS "amountAtomic",
      COUNT(*)::int AS "count", COALESCE(t."status", 'AWAITING_AUTHORIZATION') AS "status"
    FROM "ShopCryptoInvoice" i
    LEFT JOIN "ShopTreasuryTransfer" t ON t."invoiceId" = i."id"
    WHERE i."settledAt" IS NOT NULL AND i."transactionHash" IS NOT NULL AND i."amountAtomic" ~ '^[1-9][0-9]*$'
      AND (
        (i."product" = 'coins' AND EXISTS (SELECT 1 FROM "PurchaseOrder" p WHERE p."id" = i."orderId" AND p."userId" = i."payerId" AND p."status" = 'COMPLETED' AND p."paymentMode" = 'live' AND p."paymentMethod" = i."network" AND p."providerOrderId" = 'live:' || CASE WHEN i."network" = 'gram-ton' THEN 'ton:' WHEN i."network" = 'usdt-trc20' THEN 'tron:' ELSE '' END || i."transactionHash"))
        OR (i."product" = 'badge' AND EXISTS (SELECT 1 FROM "VerificationPurchase" p WHERE p."id" = i."orderId" AND p."userId" = i."payerId" AND p."status" = 'COMPLETED' AND p."paymentMode" = 'live' AND p."network" = i."network" AND p."providerOrderId" = 'live:' || CASE WHEN i."network" = 'gram-ton' THEN 'ton:' WHEN i."network" = 'usdt-trc20' THEN 'tron:' ELSE '' END || i."transactionHash"))
      )
    GROUP BY i."network", COALESCE(t."status", 'AWAITING_AUTHORIZATION')
  `;
  const rows = await prisma.shopCryptoInvoice.findMany({
    where: { settledAt: { not: null }, transactionHash: { not: null } },
    orderBy: { id: 'asc' }, take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, orderId: true, network: true, address: true, amountAtomic: true, transactionHash: true, settledAt: true, treasuryTransfer: { select: { id: true, network: true, source: true, destination: true, amountAtomic: true, status: true, authorizedAt: true, transactionHash: true, verifiedAt: true, automation: true, lastFailure: true, maxFeeAtomic: true } } },
  });
  return { networks, totals, instructionsEnabled: treasuryInstructionsEnabled(), automatic: automaticTreasuryPublicStatus(), automaticBroadcast: automaticTreasuryPublicStatus().automaticBroadcast, invoices: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
}
async function stepUp(actorId: string, code: unknown) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('Fresh authenticator code required');
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true, status: true, twoFactorEnabled: true } });
  if (!actor?.twoFactorEnabled || actor.status !== 'ACTIVE' || !['CEO', 'SUPER_ADMIN'].includes(actor.role)) throw new Error('Treasury authorization unavailable');
  const result = await twoFactorAuth.verifyLogin(actorId, code);
  if (!result.valid || result.isBackupCode) throw new Error('Invalid or previously used authenticator code');
}
export async function authorizeTreasuryTransfer(actorId: string, input: Record<string, unknown>) {
  if (!treasuryInstructionsEnabled()) throw new Error('Treasury transfer instructions disabled');
  if (typeof input.invoiceId !== 'string' || typeof input.destination !== 'string') throw new Error('Select invoice and confirm destination');
  const invoice = await prisma.shopCryptoInvoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice) throw new Error('Invoice not found');
  const destination = treasuryAddress(invoice.network);
  if (!destination || destination !== input.destination || destination === invoice.address) throw new Error('Treasury destination not configured or changed');
  await stepUp(actorId, input.code);
  return prisma.$transaction(async tx => {
    const current = await tx.shopCryptoInvoice.findUnique({ where: { id: invoice.id } });
    if (!current || current.transactionHash !== invoice.transactionHash || current.address !== invoice.address || current.amountAtomic !== invoice.amountAtomic || treasuryAddress(current.network) !== destination) throw new Error('Invoice or destination changed');
    if (await tx.shopCryptoInvoice.findUnique({ where: { address: destination }, select: { id: true } })) throw new Error('Treasury destination cannot be a historical invoice address');
    await assertVerifiedInvoice(tx, current);
    const record = await tx.shopTreasuryTransfer.create({ data: {
      invoiceId: current.id, network: current.network, source: current.address, destination,
      amountAtomic: current.amountAtomic, authorizedBy: actorId,
    } });
    await appendAuditLog(tx, { userId: actorId, action: 'TREASURY_TRANSFER_AUTHORIZED', severity: 'CRITICAL', metadata: { transferId: record.id, invoiceId: current.id, network: record.network, source: record.source, destination, amountAtomic: record.amountAtomic } });
    return record;
  }, { isolationLevel: 'Serializable' });
}
export function treasuryHash(network: string, input: unknown): string | null {
  if (network === 'gram-ton') return tonHashHex(input);
  if (typeof input !== 'string') return null;
  return (network === 'usdt-trc20' ? /^[0-9a-f]{64}$/i : /^0x[0-9a-f]{64}$/i).test(input) ? input.toLowerCase() : null;
}
export async function recordTreasuryBroadcast(actorId: string, id: string, input: Record<string, unknown>) {
  const row = await prisma.shopTreasuryTransfer.findUnique({ where: { id }, include: { invoice: true } });
  if (!row || row.automation || row.status !== 'AUTHORIZED') throw new Error('Transfer is not awaiting broadcast record');
  const hash = treasuryHash(row.network, input.transactionHash);
  if (!hash || hash === row.invoice.transactionHash) throw new Error('Invalid outgoing transaction hash');
  await stepUp(actorId, input.code);
  return prisma.$transaction(async tx => {
    const claim = await tx.shopTreasuryTransfer.updateMany({ where: { id, automation: false, status: 'AUTHORIZED', transactionHash: null }, data: { status: 'SUBMITTED_UNVERIFIED', transactionHash: hash, submittedAt: new Date() } });
    if (claim.count !== 1) throw new Error('Transfer already recorded');
    await appendAuditLog(tx, { userId: actorId, action: 'TREASURY_BROADCAST_RECORDED', severity: 'CRITICAL', metadata: { transferId: id, network: row.network, hash } });
    return tx.shopTreasuryTransfer.findUniqueOrThrow({ where: { id } });
  });
}
export async function verifyTreasuryTransfer(actorId: string, id: string) {
  const row = await prisma.shopTreasuryTransfer.findUnique({ where: { id }, include: { invoice: true } });
  if (!row || row.automation || row.status !== 'SUBMITTED_UNVERIFIED' || !row.transactionHash) throw new Error('No submitted transaction to verify');
  const network = getBlockchainNetwork(row.network);
  // Only EVM stablecoins can currently be independently verified as outgoing
  // transfers. Never mark native ETH, TRON or TON complete from a claimed hash.
  if (!network || network.native || network.tron || network.ton) throw new Error('Outgoing verification for this network requires manual reconciliation');
  const scale = BigInt(10) ** BigInt(network.tokenDecimals);
  const atomic = BigInt(row.amountAtomic);
  const amount = Number(atomic) / Number(scale);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid recorded amount');
  const proof = await blockchainTxVerifier.verifyTransaction({
    network: row.network, txHash: row.transactionHash, expectedRecipient: row.destination,
    expectedSender: row.source, expectedAmountUsd: amount, expectedAtomicAmount: row.amountAtomic,
    notBefore: new Date(Math.floor(row.authorizedAt.getTime() / 1000) * 1000), notAfter: new Date(),
    minConfirmations: Math.max(12, getMinBlockchainConfirmations()),
  });
  if (!proof.verified || proof.txHash.toLowerCase() !== row.transactionHash) throw new Error('Outgoing transfer is not verified');
  return prisma.$transaction(async tx => {
    const claim = await tx.shopTreasuryTransfer.updateMany({ where: { id, status: 'SUBMITTED_UNVERIFIED', transactionHash: row.transactionHash }, data: { status: 'VERIFIED', verifiedAt: new Date() } });
    if (claim.count !== 1) throw new Error('Transfer already processed');
    await appendAuditLog(tx, { userId: actorId, action: 'TREASURY_TRANSFER_VERIFIED', metadata: { transferId: id, proof } });
    return tx.shopTreasuryTransfer.findUniqueOrThrow({ where: { id } });
  });
}
