import { Request, Response } from 'express';
import { giftService } from '../services';
import { AuthRequest } from '../middleware/auth.middleware';

export const getGifts = async (req: Request, res: Response): Promise<void> => {
  try {
    const gifts = await giftService.listGifts(req.query.search as string | undefined, req.query.category as string | undefined);
    res.status(200).json(gifts);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const sendGift = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const senderId = req.user?.userId;
    const { receiverId, giftId, streamId, quantity, message, isAnon, requestId } = req.body;

    if (!senderId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!receiverId || !giftId) {
      res.status(400).json({ error: 'receiverId and giftId are required' });
      return;
    }

    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)) {
      res.status(400).json({ error: 'quantity must be an integer between 1 and 99' });
      return;
    }
    if (message !== undefined && typeof message !== 'string') {
      res.status(400).json({ error: 'message must be a string' });
      return;
    }
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) {
      res.status(400).json({ error: 'A valid requestId is required' });
      return;
    }

    const transaction = await giftService.sendGift(senderId, receiverId, giftId, streamId, { quantity, message, isAnon: Boolean(isAnon), requestId });
    res.status(201).json({
      message: 'Gift sent successfully',
      transaction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getGiftHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const transactions = await giftService.getGiftHistory(userId, Math.min(100, Math.max(1, limit)));

    res.status(200).json(transactions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const validateGiftWallet = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const amount = Number(req.query.amount);
    if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
    if (!Number.isSafeInteger(amount) || amount < 1) return void res.status(400).json({ error: 'amount must be a positive integer' });

    res.json(await giftService.validateWallet(userId, amount));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};
