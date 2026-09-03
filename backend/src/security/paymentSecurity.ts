import { prisma } from '../prisma';
import { auditLog } from './auditLog';
import { CryptoUtils } from './crypto';

export class PaymentSecurity {
  async verifyWebhookSignature(payload: string, signature: string, secret: string): Promise<boolean> {
    const expectedSig = CryptoUtils.sha256(`${payload}${secret}`);
    return CryptoUtils.constantTimeCompare(expectedSig, signature);
  }

  async processPayment(userId: string, amount: number, provider: string, providerOrderId: string): Promise<void> {
    const existing = await prisma.purchaseOrder.findUnique({
      where: { providerOrderId },
    });
    if (existing) throw new Error('Duplicate payment detected');

    await prisma.purchaseOrder.create({
      data: { userId, amount, provider, providerOrderId, status: 'COMPLETED', coins: Math.floor(amount) },
    });

    await prisma.wallet.upsert({
      where: { userId },
      update: { coinBalance: { increment: Math.floor(amount) } },
      create: { userId, coinBalance: Math.floor(amount) },
    });

    await prisma.walletTransaction.create({
      data: { userId, type: 'PURCHASE', amount, status: 'COMPLETED', description: `Purchase via ${provider}` },
    });
  }

  async processWithdrawal(userId: string, amount: number, method: string): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error('Wallet not found');
    if (wallet.earningsBalance < amount) throw new Error('Insufficient earnings');

    const fee = amount * 0.05;
    const netAmount = amount - fee;

    await prisma.withdrawal.create({
      data: { userId, amount, fee, netAmount, method, status: 'PENDING' },
    });

    await prisma.wallet.update({
      where: { userId },
      data: { earningsBalance: { decrement: amount } },
    });

    auditLog.log({
      userId, action: 'WITHDRAWAL_REQUESTED',
      metadata: { amount, method, fee },
      severity: 'INFO',
    });
  }

  async handleSubscription(userId: string, tier: string, price: number, provider: string): Promise<void> {
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    await prisma.creatorSubscription.upsert({
      where: { subscriberId_creatorId: { subscriberId: userId, creatorId: userId } },
      update: { tier, price, status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end },
      create: { subscriberId: userId, creatorId: userId, tier, price, status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end },
    });
  }

  async validateRefund(transactionId: string): Promise<{ valid: boolean; reason?: string }> {
    const tx = await prisma.purchaseOrder.findUnique({ where: { id: transactionId } });
    if (!tx) return { valid: false, reason: 'Transaction not found' };
    if (tx.status !== 'COMPLETED') return { valid: false, reason: 'Transaction not completed' };
    const daysSince = (Date.now() - new Date(tx.createdAt).getTime()) / 86400000;
    if (daysSince > 30) return { valid: false, reason: 'Refund window expired (30 days)' };
    return { valid: true };
  }
}

export const paymentSecurity = new PaymentSecurity();