import { Request, Response } from 'express';
import { verificationService } from '../services/verification.service';
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
// SUBSCRIBE TO PLAN
// ============================================================================

export const subscribeToPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { planId, paymentMethod, paymentTxHash } = req.body;
    if (!planId) {
      res.status(400).json({ error: 'Plan ID is required' });
      return;
    }
    const result = await verificationService.subscribeToPlan(req.user!.userId, planId, paymentMethod, paymentTxHash);
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

export const createCryptoPayment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { planId, currency, network, walletAddress, amount } = req.body;
    if (!planId || !currency || !network || !walletAddress || !amount) {
      res.status(400).json({ error: 'Missing required fields: planId, currency, network, walletAddress, amount' });
      return;
    }
    if (!['USDT', 'USDC'].includes(currency)) {
      res.status(400).json({ error: 'Currency must be USDT or USDC' });
      return;
    }
    if (!['BNB_SMART_CHAIN', 'BASE'].includes(network)) {
      res.status(400).json({ error: 'Network must be BNB_SMART_CHAIN or BASE' });
      return;
    }
    const payment = await verificationService.createCryptoPayment(req.user!.userId, planId, currency, network, walletAddress, amount);
    res.status(201).json(payment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const confirmCryptoPayment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { paymentId, txHash } = req.body;
    if (!paymentId || !txHash) {
      res.status(400).json({ error: 'Missing required fields: paymentId, txHash' });
      return;
    }
    const result = await verificationService.confirmCryptoPayment(paymentId, txHash);
    res.status(200).json(result);
  } catch (error) {
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