import { createHash } from 'crypto';
import { prisma } from '../prisma';
import { BADGE_PLAN_BY_ID } from '../config/verification-badge.config';
import { badgeCoinCost, shopCoinBadgeEnabled } from '../config/shop-coin-badge.config';
import { resolveShopGiftRecipient } from './shop-gift.service';
import { walletService, resolveAvailableCoins, TX_TYPES } from './wallet.service';

function calendarEnd(start: Date, months: number): Date {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const last = new Date(end);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  end.setUTCDate(Math.min(day, last.getUTCDate()));
  return end;
}

export async function buyBadgeWithCoins(payerId: string, input: Record<string, unknown>) {
  if (!shopCoinBadgeEnabled()) throw new Error('Coin badge checkout is not enabled');
  if (input.renew === true) throw new Error('Automatic renewal is not enabled');
  const plan = typeof input.planId === 'string' ? BADGE_PLAN_BY_ID.get(input.planId) : undefined;
  if (!plan) throw new Error('Invalid verification plan');
  const requestKey = input.requestKey;
  if (typeof requestKey !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestKey)) throw new Error('Invalid purchase request');
  const recipientUserId = await resolveShopGiftRecipient(payerId, input.recipientId);
  const recipientId = recipientUserId || payerId;
  const coins = badgeCoinCost(plan.priceUSD);
  if (input.expectedCoins !== coins) throw new Error('Price changed. Review the current quote before confirming.');
  const orderId = 'coinbadge_' + createHash('sha256').update(payerId + ':' + requestKey).digest('hex');
  const replay = async () => {
    const order = await prisma.verificationPurchase.findUnique({ where: { id: orderId } });
    if (!order) return null;
    if (order.userId !== payerId || order.planId !== plan.id || (order.recipientUserId || null) !== recipientUserId || order.network !== 'vanta-coins' || order.amount !== plan.priceUSD) throw new Error('Purchase request already used');
    if (order.status !== 'COMPLETED') throw new Error('Purchase is no longer active');
    return { success: true, orderId, coinsSpent: coins, alreadyCompleted: true, mode: 'coin-test' };
  };
  const existing = await replay();
  if (existing) return existing;
  if (typeof input.pin !== 'string') throw new Error('Wallet PIN required');
  await walletService.verifyPin(payerId, input.pin);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const now = new Date();
        const row = await tx.subscriptionPlan.findUnique({ where: { id: plan.id } });
        if (!row?.isActive || row.price !== plan.priceUSD || row.durationMonths !== plan.durationMonths || row.badgeType !== plan.badgeType) throw new Error('Plan unavailable');
        // Serialize entitlement changes for the target. No badge stacking or
        // replacement of suspended/admin-granted badges in this test rail.
        const active = await tx.user.updateMany({ where: { id: recipientId, status: 'ACTIVE' }, data: { status: 'ACTIVE' } });
        if (active.count !== 1) throw new Error('Recipient unavailable');
        const badge = await tx.verificationBadge.findUnique({ where: { userId: recipientId } });
        if (badge && (badge.status === 'SUSPENDED' || (badge.status === 'ACTIVE' && (!badge.expiresAt || badge.expiresAt > now)))) throw new Error('Recipient already has an active or suspended badge');
        const member = await tx.creatorMembership.findUnique({ where: { userId: recipientId } });
        if (member && (member.status === 'SUSPENDED' || (member.status === 'ACTIVE' && member.endDate > now))) throw new Error('Recipient already has an active or suspended membership');
        const wallet = await tx.wallet.findUnique({ where: { userId: payerId } });
        if (!wallet || wallet.isFrozen || resolveAvailableCoins(wallet) < coins) throw new Error('Insufficient available coins or wallet frozen');
        const debit = await tx.wallet.updateMany({
          where: { id: wallet.id, isFrozen: false, lockedCoins: wallet.lockedCoins, coinBalance: { gte: wallet.lockedCoins + coins } },
          data: { coinBalance: { decrement: coins } },
        });
        if (debit.count !== 1) throw new Error('Wallet changed. Review balance and retry.');
        const after = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        const end = calendarEnd(now, plan.durationMonths);
        await tx.verificationPurchase.create({ data: {
          id: orderId, userId: payerId, recipientUserId, planId: plan.id, amount: plan.priceUSD, currency: 'USD',
          network: 'vanta-coins', paymentMode: 'test', status: 'COMPLETED', providerOrderId: 'coins:' + orderId,
          providerReference: orderId, confirmedAt: now, expiresAt: now,
          metadata: JSON.stringify({ coinsPaid: coins, requestKey }),
        } });
        const badgeData = { badgeType: plan.badgeType, status: 'ACTIVE', grantedBy: null, grantedAt: now, expiresAt: end,
          sourcePurchaseId: orderId, planId: plan.id, revokedAt: null, revokedBy: null, revokeReason: null };
        await tx.verificationBadge.upsert({ where: { userId: recipientId }, create: { userId: recipientId, ...badgeData }, update: badgeData });
        if (plan.badgeType === 'GOLD') {
          const membership = { planId: plan.id, status: 'ACTIVE', startDate: now, endDate: end, renewalDate: null, autoRenew: false, cancelledAt: null, paymentMethod: 'vanta-coins', paymentTxHash: orderId };
          await tx.creatorMembership.upsert({ where: { userId: recipientId }, create: { userId: recipientId, ...membership }, update: membership });
        }
        await tx.walletTransaction.create({ data: { walletId: wallet.id, userId: payerId, type: TX_TYPES.SUBSCRIPTION, currency: 'VANTA', amount: coins, fee: 0,
          balanceBefore: after.coinBalance + coins, balance: after.coinBalance, status: 'COMPLETED', reference: orderId,
          description: 'Verification badge purchase', metadata: JSON.stringify({ planId: plan.id, recipientId, mode: 'coin-test' }) } });
        await tx.walletAuditLog.create({ data: { userId: payerId, action: 'COIN_BADGE_PURCHASE', details: JSON.stringify({ orderId, coins, recipientId, planId: plan.id }) } });
        await tx.verificationHistory.create({ data: { userId: recipientId, action: 'BADGE_ACTIVATED', details: JSON.stringify({ purchaseId: orderId, payerId, planId: plan.id, coinsPaid: coins, endDate: end.toISOString() }) } });
        return { success: true, orderId, coinsSpent: coins, balance: after.coinBalance, availableCoins: resolveAvailableCoins(after), mode: 'coin-test', alreadyCompleted: false };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      const completed = await replay();
      if (completed) return completed;
      if ((error as { code?: string })?.code !== 'P2034' || attempt === 2) throw error;
    }
  }
  throw new Error('Purchase unavailable');
}
