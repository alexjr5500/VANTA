import { Response } from 'express';
import { welcomeRewardService } from '../services/welcome-reward.service';
import { AuthRequest } from '../middleware/auth.middleware';

export const getWelcomeReward = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const status = await welcomeRewardService.getWelcomeRewardStatus(userId);
    res.status(200).json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const claimWelcomeReward = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const reward = await welcomeRewardService.claimWelcomeReward(userId);
    res.status(201).json({
      message: '🎉 Welcome to VANTA! As a thank you for joining, we\'ve added 100 VANTA Coins to your account. Use them to send gifts and support creators.',
      reward,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message === 'Welcome reward already claimed') {
      res.status(409).json({ error: message });
    } else {
      res.status(400).json({ error: message });
    }
  }
};