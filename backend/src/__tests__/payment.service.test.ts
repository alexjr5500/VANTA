import { PaymentService } from '../services/payment.service';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    walletTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    wallet: {
      update: jest.fn(),
    },
  },
}));

const paymentService = new PaymentService();

describe('PaymentService', () => {
  const mockTransaction = {
    id: 'tx1',
    userId: 'user1',
    type: 'TOPUP',
    amount: 100,
    status: 'PENDING',
    createdAt: new Date(),
  };

  beforeEach(() => jest.clearAllMocks());

  describe('initializePayment', () => {
    test('should create pending transaction', async () => {
      (prisma.walletTransaction.create as jest.Mock).mockResolvedValue(mockTransaction);
      const result = await paymentService.initializePayment('user1', 100, 'TOPUP');
      expect(result.transactionId).toBe('tx1');
      expect(result.status).toBe('PENDING');
    });
  });

  describe('verifyPayment', () => {
    test('should verify and process payment', async () => {
      (prisma.walletTransaction.findUnique as jest.Mock).mockResolvedValue(mockTransaction);
      (prisma.walletTransaction.update as jest.Mock).mockResolvedValue({ ...mockTransaction, status: 'SUCCESS' });
      (prisma.wallet.update as jest.Mock).mockResolvedValue({});

      const result = await paymentService.verifyPayment('tx1', {});
      expect(result.status).toBe('SUCCESS');
    });

    test('should throw for non-existent transaction', async () => {
      (prisma.walletTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(paymentService.verifyPayment('nonexistent', {})).rejects.toThrow('Transaction not found');
    });
  });

  describe('refundPayment', () => {
    test('should refund successful transaction', async () => {
      const completedTx = { ...mockTransaction, status: 'SUCCESS' };
      (prisma.walletTransaction.findUnique as jest.Mock).mockResolvedValue(completedTx);
      (prisma.walletTransaction.create as jest.Mock).mockResolvedValue({ ...mockTransaction, type: 'REFUND', amount: -100 });
      (prisma.wallet.update as jest.Mock).mockResolvedValue({});

      const result = await paymentService.refundPayment('tx1');
      expect(result.type).toBe('REFUND');
    });

    test('should throw for non-successful transaction', async () => {
      (prisma.walletTransaction.findUnique as jest.Mock).mockResolvedValue(mockTransaction);
      await expect(paymentService.refundPayment('tx1')).rejects.toThrow('Only successful transactions can be refunded');
    });
  });

  describe('createPaymentLink', () => {
    afterEach(() => {
      delete process.env.PAYMENT_LINK_BASE_URL;
    });

    test('should create payment link using configured gateway base URL', async () => {
      (prisma.walletTransaction.create as jest.Mock).mockResolvedValue(mockTransaction);
      process.env.PAYMENT_LINK_BASE_URL = 'https://checkout.example.test/';
      const result = await paymentService.createPaymentLink('user1', 100, 'TOPUP');
      expect(result.paymentLink).toBe('https://checkout.example.test/pay/tx1');
      expect(result.transactionId).toBe('tx1');
    });

    test('should fall back to non-branded placeholder when PAYMENT_LINK_BASE_URL is unset', async () => {
      (prisma.walletTransaction.create as jest.Mock).mockResolvedValue(mockTransaction);
      const result = await paymentService.createPaymentLink('user1', 100, 'TOPUP');
      expect(result.paymentLink).toBe('https://payments.example.com/pay/tx1');
    });

    test('should throw for invalid type', async () => {
      await expect(paymentService.createPaymentLink('user1', 100, 'INVALID' as any)).rejects.toThrow('Invalid payment type');
    });
  });

  describe('getPaymentHistory', () => {
    test('should return transaction history', async () => {
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([mockTransaction]);
      const result = await paymentService.getPaymentHistory('user1');
      expect(result).toHaveLength(1);
    });
  });

  describe('webhookHandler', () => {
    test('should handle payment.succeeded event', async () => {
      (prisma.walletTransaction.findUnique as jest.Mock).mockResolvedValue(mockTransaction);
      (prisma.walletTransaction.update as jest.Mock).mockResolvedValue({ ...mockTransaction, status: 'SUCCESS' });
      (prisma.wallet.update as jest.Mock).mockResolvedValue({});

      const result = await paymentService.webhookHandler({ type: 'payment.succeeded', transactionId: 'tx1' });
      expect(result.received).toBe(true);
    });

    test('should handle payment.failed event', async () => {
      (prisma.walletTransaction.update as jest.Mock).mockResolvedValue({ ...mockTransaction, status: 'FAILED' });

      const result = await paymentService.webhookHandler({ type: 'payment.failed', transactionId: 'tx1' });
      expect(result.received).toBe(true);
    });
  });
});
