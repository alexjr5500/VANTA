import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { getCoinPaymentMode, COIN_PAYMENT_MODE } from '../config/coin-payments.config';
import { verificationService } from '../services/verification.service';
import {
  verificationPaymentService,
  VerificationPaymentUnavailableError,
  VerificationPaymentWebhookError,
} from '../services/verification-payment.service';
import { AuthenticatedRequest } from '../security';

// ============================================================================
// VERIFICATION STATUS
// ============================================================================

export const getVerificationStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const status = await verificationService.getVerificationStatus(req.user!.userId);
    res.status(200).json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// SUBSCRIPTION PLANS
// ============================================================================

export const getSubscriptionPlans = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const plans = await verificationService.getSubscriptionPlans();
    res.status(200).json(plans);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// VERIFICATION REQUEST
// ============================================================================

export const submitVerificationRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { requestType, documents, notes } = req.body;
    if (!requestType) {
      res.status(400).json({ error: 'Request type is required' });
      return;
    }
    if (!['CREATOR', 'BUSINESS', 'INDIVIDUAL'].includes(requestType)) {
      res.status(400).json({ error: 'Invalid request type' });
      return;
    }
    const result = await verificationService.createVerificationRequest(req.user!.userId, requestType, documents, notes);
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// SUBSCRIBE TO PLAN (activated ONLY from a server-verified completed purchase)
// ============================================================================

export const subscribeToPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { purchaseId } = req.body;
    if (!purchaseId) {
      res
        .status(400)
        .json({
          error: 'purchaseId is required. A badge may only be activated from a server-verified payment.',
        });
      return;
    }
    const result = await verificationService.subscribeToPlan(req.user!.userId, purchaseId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// CANCEL MEMBERSHIP
// ============================================================================

export const cancelMembership = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await verificationService.cancelMembership(req.user!.userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// VERIFICATION HISTORY
// ============================================================================

export const getVerificationHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const history = await verificationService.getVerificationHistory(req.user!.userId);
    res.status(200).json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// CREATOR STUDIO ACCESS CHECK
// ============================================================================

export const checkStudioAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const access = await verificationService.checkCreatorStudioAccess(req.user!.userId);
    res.status(200).json(access);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// CRYPTO PAYMENT
// ============================================================================

// ============================================================================
// CRYPTO PAYMENT (legacy aliases — both now delegate to the SECURE purchase
// flow: server-authoritative pricing + server-side payment verification).
// ============================================================================

/**
 * Legacy alias of initVerificationPurchase. The server resolves the plan,
 * price, network and deposit address; the client can never submit them.
 */
export const createCryptoPayment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { planId, network } = req.body;
    // Map legacy currency/network names onto the supported network ids.
    const net =
      (typeof network === 'string' && (network.toLowerCase().includes('base') ? 'usdc-base' : 'usdt-bep20')) ||
      'usdt-bep20';
    const payload = await verificationPaymentService.initializeVerificationPurchase(
      req.user!.userId,
      planId,
      net,
      req.ip
    );
    res.status(201).json(payload);
  } catch (error) {
    if (error instanceof VerificationPaymentUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

/**
 * Legacy alias of verifyVerificationPurchase. A client txHash is NEVER proof
 * of payment: in test mode the backend-issued simulate token is required, in
 * live mode the response is "pending" until the provider webhook verifies.
 */
export const confirmCryptoPayment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { paymentId, simulateToken } = req.body;
    if (!paymentId) {
      res.status(400).json({ error: 'Missing required field: purchaseId' });
      return;
    }
    const result = await verificationPaymentService.completeTestPurchase(req.user!.userId, paymentId, {
      simulateToken,
      ipAddress: req.ip,
    });
    res.status(200).json({
      success: true,
      message: 'Simulated payment verified. Your Verified Badge is now active.',
      ...(result || {}),
    });
  } catch (error) {
    if (error instanceof VerificationPaymentUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// EXPIRATION CRON
// ============================================================================

export const expireOverdue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const count = await verificationService.expireOverdueMemberships();
    res.status(200).json({ expired: count, message: `${count} memberships expired` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
// ============================================================================
// VERIFIED BADGE PURCHASE FLOW (secure: server-authoritative pricing + server
// side payment verification — the client can only reference a plan id).
// ============================================================================

/** Catalog of the purchasable Verified Badge plans (server-authoritative). */
export const getBadgePurchasePlans = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const plans = await verificationPaymentService.getBadgePlans();
    res.status(200).json(plans);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

/** Start a Verified Badge purchase order (PENDING — never activates anything). */
export const initializeVerificationPurchase = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { planId, network } = req.body;
    const payload = await verificationPaymentService.initializeVerificationPurchase(
      req.user!.userId,
      planId,
      network,
      req.ip
    );
    res.status(201).json(payload);
  } catch (error) {
    if (error instanceof VerificationPaymentUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
/**
 * Complete / confirm a Verified Badge purchase payment.
 *  - test mode: requires the backend-issued simulate token (HMAC binding);
 *  - live mode: a client tx hash is never proof — returns pending until the
 *    provider webhook verifies the payment server-side.
 */
export const verifyVerificationPurchase = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { orderId, testConfirmation, simulateToken } = req.body;
    if (!orderId || typeof orderId !== 'string') {
      res.status(400).json({ error: 'orderId is required' });
      return;
    }

    const order = await prisma.verificationPurchase.findFirst({ where: { id: orderId, userId: req.user!.userId } });
    if (!order) {
      res.status(404).json({ error: 'Purchase order not found.' });
      return;
    }
    if (order.status === 'COMPLETED') {
      res.status(200).json({ success: true, message: 'Purchase already confirmed. Your badge is active.', alreadyCompleted: true });
      return;
    }
    if (order.status === 'REFUNDED') {
      res.status(400).json({ error: 'This purchase was refunded and cannot be completed.' });
      return;
    }
    if (order.status === 'EXPIRED' || order.status === 'FAILED' || order.status === 'CANCELLED') {
      res
        .status(400)
        .json({ error: `This purchase is ${order.status.toLowerCase()} and cannot be completed. Please start a new purchase.` });
      return;
    }

    const mode = getCoinPaymentMode();
    if (mode === COIN_PAYMENT_MODE.TEST) {
      if (testConfirmation !== true) {
        res.status(400).json({ error: 'A test payment confirmation is required to complete this simulated payment.' });
        return;
      }
      const result = await verificationPaymentService.completeTestPurchase(req.user!.userId, order.id, {
        simulateToken,
        ipAddress: req.ip,
      });
      res.status(200).json({
        success: true,
        message: 'Simulated payment verified. Your Verified Badge is now active.',
        mode,
        testSandbox: true,
        ...(result || {}),
      });
      return;
    }

    // LIVE mode — activation belongs exclusively to the provider webhook.
    res.status(202).json({
      success: false,
      pending: true,
      orderId: order.id,
      status: order.status,
      message: 'Payment is awaiting provider verification.',
    });
  } catch (error) {
    if (error instanceof VerificationPaymentUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
/** The authenticated user's Verified Badge purchase history. */
export const getVerificationPurchases = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await verificationPaymentService.getUserPurchases(req.user!.userId, limit, offset);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

/**
 * Provider payment webhook for LIVE Verified Badge purchases. NO user session
 * is required — the provider authenticates via HMAC signature. This is the
 * ONLY path that can activate a badge for a live payment.
 */
export const verificationPurchaseWebhook = async (req: Request, res: Response): Promise<void> => {
  const rawBody = typeof (req as any).rawBody === 'string' ? (req as any).rawBody : JSON.stringify(req.body || {});
  try {
    const result = await verificationPaymentService.processPaymentWebhook({
      rawBody,
      signature: req.headers['x-vanta-signature'] || req.headers['x-signature'],
      eventId: req.body?.eventId,
      orderId: req.body?.orderId,
      txHash: req.body?.txHash,
      network: req.body?.network,
      asset: req.body?.asset,
      amount: req.body?.amount,
      status: req.body?.status,
      confirmations: req.body?.confirmations,
      confirmedAt: req.body?.confirmedAt,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof VerificationPaymentWebhookError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[VERIFICATION-PAYMENTS] Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};

// ============================================================================
// ADMIN: GET ALL BADGES
// ============================================================================

export const adminGetAllBadges = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const badges = await verificationService.getAllBadges();
    res.status(200).json(badges);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// ADMIN: GET ALL MEMBERSHIPS
// ============================================================================

export const adminGetAllMemberships = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const memberships = await verificationService.getAllMemberships();
    res.status(200).json(memberships);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// ADMIN: GET PENDING REQUESTS
// ============================================================================

export const adminGetPendingRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const requests = await verificationService.getPendingVerificationRequests();
    res.status(200).json(requests);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// ADMIN: APPROVE/REJECT VERIFICATION
// ============================================================================

export const adminApproveVerification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }
    const result = await verificationService.approveVerificationRequest(userId, req.user!.userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const adminRejectVerification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, reason } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }
    const result = await verificationService.rejectVerificationRequest(userId, req.user!.userId, reason);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// ADMIN: GRANT/REVOKE BADGES
// ============================================================================

export const adminGrantBadge = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, badgeType } = req.body;
    if (!userId || !badgeType) {
      res.status(400).json({ error: 'User ID and badge type are required' });
      return;
    }
    if (!['BLUE', 'GOLD'].includes(badgeType)) {
      res.status(400).json({ error: 'Badge type must be BLUE or GOLD' });
      return;
    }

    let result;
    if (badgeType === 'BLUE') {
      result = await verificationService.adminGrantBlueBadge(userId, req.user!.userId);
    } else {
      result = await verificationService.adminGrantGoldBadge(userId, req.user!.userId);
    }
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const adminRevokeBadge = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, reason } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }
    const result = await verificationService.adminRevokeBadge(userId, req.user!.userId, reason);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// ADMIN: SUSPEND SUBSCRIPTION
// ============================================================================

export const adminSuspendSubscription = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, reason } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }
    const result = await verificationService.suspendSubscription(userId, reason);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// ADMIN: MANAGE PLANS
// ============================================================================

export const adminUpsertPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const planData = req.body;
    if (!planData.name || !planData.durationMonths || !planData.price) {
      res.status(400).json({ error: 'Name, durationMonths, and price are required' });
      return;
    }
    const result = await verificationService.upsertPlan(planData);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// ADMIN: GET VERIFICATION HISTORY FOR USER
// ============================================================================

export const adminGetUserVerificationHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }
    const history = await verificationService.getVerificationHistory(userId);
    res.status(200).json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
// ============================================================================
// ADMIN: VERIFIED BADGE PURCHASES
// ============================================================================

export const adminGetVerificationPurchases = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;
    const result = await verificationPaymentService.listPurchases({ limit, offset, status });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const adminVerificationPurchaseDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await verificationPaymentService.getDashboard();
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const adminRefundVerificationPurchase = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { purchaseId } = req.params;
    const { reason } = req.body || {};
    if (!purchaseId) {
      res.status(400).json({ error: 'purchaseId is required' });
      return;
    }
    const result = await verificationPaymentService.refundPurchase(req.user!.userId, purchaseId, reason, req.ip);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};