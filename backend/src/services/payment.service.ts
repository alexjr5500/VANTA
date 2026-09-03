import { prisma } from "../prisma";

export class PaymentService {
  async initializePayment(userId: string, amount: number, type: "TOPUP" | "PREMIUM") {
    const transaction = await prisma.walletTransaction.create({
      data: {
        userId,
        type,
        amount,
        status: "PENDING",
      },
    });

    return {
      transactionId: transaction.id,
      amount,
      status: "PENDING",
      // In production, integrate with payment gateway (Stripe, Paypal, etc.)
    };
  }

  async verifyPayment(transactionId: string, paymentDetails: any) {
    const transaction = await prisma.walletTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    // In production, verify with payment gateway
    // Mock verification
    const verified = true;

    if (verified) {
      const updated = await prisma.walletTransaction.update({
        where: { id: transactionId },
        data: { status: "SUCCESS" },
      });

      // Add coins to wallet
      if (transaction.type === "TOPUP") {
        await prisma.wallet.update({
          where: { userId: transaction.userId },
          data: { coinBalance: { increment: transaction.amount } },
        });
      }

      return updated;
    } else {
      await prisma.walletTransaction.update({
        where: { id: transactionId },
        data: { status: "FAILED" },
      });

      throw new Error("Payment verification failed");
    }
  }

  async refundPayment(transactionId: string) {
    const transaction = await prisma.walletTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    if (transaction.status !== "SUCCESS") {
      throw new Error("Only successful transactions can be refunded");
    }

    const refund = await prisma.walletTransaction.create({
      data: {
        userId: transaction.userId,
        type: "REFUND",
        amount: -transaction.amount,
        status: "SUCCESS",
      },
    });

    // Deduct coins from wallet if it was a topup
    if (transaction.type === "TOPUP") {
      await prisma.wallet.update({
        where: { userId: transaction.userId },
        data: { coinBalance: { decrement: transaction.amount } },
      });
    }

    return refund;
  }

  async getPaymentHistory(userId: string, limit: number = 50) {
    const transactions = await prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return transactions;
  }

  async createPaymentLink(userId: string, amount: number, type: 'TOPUP' | 'PREMIUM') {
    if (type !== 'TOPUP' && type !== 'PREMIUM') {
      throw new Error('Invalid payment type');
    }

    // In production, integrate with payment gateway to create payment link.
    // The hosted payment URL is owned by the payment gateway and configured
    // externally via PAYMENT_LINK_BASE_URL (no hardcoded brand domain).
    const transaction = await this.initializePayment(userId, amount, type);

    const paymentBaseUrl = (process.env.PAYMENT_LINK_BASE_URL || 'https://payments.example.com').replace(/\/+$/, '');

    return {
      paymentLink: `${paymentBaseUrl}/pay/${transaction.transactionId}`,
      transactionId: transaction.transactionId,
    };
  }

  async webhookHandler(event: any) {
    // Handle payment gateway webhooks (Stripe, Paypal, etc.)
    // Verify webhook signature
    // Update transaction status based on event
    
    switch (event.type) {
      case "payment.succeeded":
        await this.verifyPayment(event.transactionId, event);
        break;
      case "payment.failed":
        await prisma.walletTransaction.update({
          where: { id: event.transactionId },
          data: { status: "FAILED" },
        });
        break;
      case "payment.refunded":
        await this.refundPayment(event.transactionId);
        break;
    }

    return { received: true };
  }
}

export const paymentService = new PaymentService();
