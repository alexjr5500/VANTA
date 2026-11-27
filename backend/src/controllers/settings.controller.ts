import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { authService, userService } from '../services';
import { prisma } from '../prisma';
import { auditLog } from '../security/auditLog';
import { activeAccountSessions, revokeOtherAccountSessions } from '../services/account-access.service';

const handleUnauthorized = (res: Response): void => {
  res.status(401).json({ error: 'Unauthorized' });
};
const handleError = (res: Response, error: unknown, status = 400): void => {
  const message = error instanceof Error ? error.message : 'Internal server error';
  res.status(status).json({ error: message });
};

export const getPrivacySettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const settings = await userService.getUserSettings(userId);
    res.status(200).json(settings);
  } catch (error) {
    handleError(res, error, 404);
  }
};

export const updatePrivacySettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const settings = await userService.updateUserSettings(userId, req.body);
    res.status(200).json({ message: 'Privacy settings updated', settings });
  } catch (error) {
    handleError(res, error);
  }
};

export const getNotificationPreferences = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const preferences = await userService.getNotificationPreferences(userId);
    res.status(200).json(preferences);
  } catch (error) {
    handleError(res, error, 404);
  }
};

export const updateNotificationPreferences = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const preferences = await userService.updateNotificationPreferences(userId, req.body);
    res.status(200).json({ message: 'Notification preferences updated', preferences });
  } catch (error) {
    handleError(res, error);
  }
};

export const getActiveSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const sessions = await activeAccountSessions(userId, req.user!.sessionId);
    res.set('Cache-Control', 'private, no-store');
    res.status(200).json({ sessions });
  } catch (error) {
    handleError(res, error);
  }
};

export const revokeSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!userId) return handleUnauthorized(res);
    if (!sessionId) {
      res.status(400).json({ error: 'Session id is required' });
      return;
    }
    if (sessionId === req.user!.sessionId) { res.status(400).json({ error: 'Use Log out to end your current session' }); return; }
    await authService.revokeSession(userId, sessionId);
    await auditLog.log({ userId, action: 'SESSION_REVOKED', metadata: { sessionId } });
    res.status(200).json({ message: 'Session revoked successfully' });
  } catch (error) {
    handleError(res, error);
  }
};

export const revokeAllSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const count = await revokeOtherAccountSessions(userId, req.user!.sessionId);
    await auditLog.log({ userId, action: 'SESSION_REVOKED_OTHERS', metadata: { count } });
    res.status(200).json({ message: 'Other sessions revoked', count });
  } catch (error) {
    handleError(res, error);
  }
};

export const requestEmailChange = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const { email, currentPassword } = req.body || {};
    const result = await userService.requestEmailChange(userId, email, currentPassword);
    res.status(200).json({ message: 'Verification code sent to your new email address', ...result });
  } catch (error) {
    handleError(res, error);
  }
};

export const verifyEmailChange = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const { code } = req.body || {};
    const result = await userService.verifyEmailChange(userId, code);
    res.status(200).json({ message: 'Email address verified and updated', ...result });
  } catch (error) {
    handleError(res, error);
  }
};

export const updateAccountSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const { email, currentPassword, newPassword } = req.body;
    const result: any = {};

    if (email) {
      res.status(400).json({ error: 'Email changes must use the verification flow in Password & Security.' });
      return;
    }

    if (currentPassword || newPassword) {
      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'Both current and new password are required to change password' });
        return;
      }
      result.password = await userService.changePassword(userId, currentPassword, newPassword);
    }

    res.status(200).json({ message: 'Account settings updated', result });
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    await userService.deleteAccount(userId);
    await authService.revokeAllSessions(userId);
    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    handleError(res, error);
  }
};

export const getBlockedUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const blocked = await userService.getBlockedUsers(userId);
    res.status(200).json({ blocked: blocked.map((item: any) => ({ id: item.target.id, username: item.target.username })) });
  } catch (error) {
    handleError(res, error);
  }
};

export const blockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { targetUsername, targetId } = req.body || {};
    if (!userId) return handleUnauthorized(res);

    // Chat actions identify the other participant by immutable user ID,
    // while the Privacy settings form uses a username. Accept both contracts.
    let resolvedUsername = typeof targetUsername === 'string' ? targetUsername.trim().replace(/^@/, '') : '';
    if (!resolvedUsername && typeof targetId === 'string' && targetId.trim()) {
      const target = await prisma.user.findUnique({
        where: { id: targetId.trim() },
        select: { username: true },
      });
      resolvedUsername = target?.username || '';
    }
    if (!resolvedUsername) {
      res.status(400).json({ error: 'A valid target account is required' });
      return;
    }
    const blocked = await userService.blockUser(userId, resolvedUsername);
    res.status(200).json({ message: 'User blocked', blocked });
  } catch (error) {
    handleError(res, error);
  }
};

export const unblockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const targetId = Array.isArray(req.params.targetId) ? req.params.targetId[0] : req.params.targetId;
    if (!userId) return handleUnauthorized(res);
    if (!targetId) {
      res.status(400).json({ error: 'Target user id is required' });
      return;
    }
    await userService.unblockUser(userId, targetId);
    res.status(200).json({ message: 'User unblocked' });
  } catch (error) {
    handleError(res, error);
  }
};

export const getMutedUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const muted = await userService.getMutedUsers(userId);
    res.status(200).json({ muted: muted.map((item: any) => ({ id: item.target.id, username: item.target.username })) });
  } catch (error) {
    handleError(res, error);
  }
};

export const muteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { targetUsername } = req.body;
    if (!userId) return handleUnauthorized(res);
    if (!targetUsername) {
      res.status(400).json({ error: 'Target username is required' });
      return;
    }
    const muted = await userService.muteUser(userId, targetUsername);
    res.status(200).json({ message: 'User muted', muted });
  } catch (error) {
    handleError(res, error);
  }
};

export const unmuteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const targetId = Array.isArray(req.params.targetId) ? req.params.targetId[0] : req.params.targetId;
    if (!userId) return handleUnauthorized(res);
    if (!targetId) {
      res.status(400).json({ error: 'Target user id is required' });
      return;
    }
    await userService.unmuteUser(userId, targetId);
    res.status(200).json({ message: 'User unmuted' });
  } catch (error) {
    handleError(res, error);
  }
};

export const getSecurityLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) return handleUnauthorized(res);
    const logs = await userService.getSecurityLogs(userId);
    res.status(200).json({ logs });
  } catch (error) {
    handleError(res, error);
  }
};
