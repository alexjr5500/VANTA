import { Request, Response } from 'express';
import { liveService } from '../services';
import { liveKitService } from '../services/livekit.service';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth.middleware';
import { getParamString } from '../utils/params';

export const getCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const categories = await liveService.getCategories();
    res.status(200).json(categories);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getActiveStreams = async (req: Request, res: Response): Promise<void> => {
  try {
    const cursor = req.query.cursor as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    const streams = await liveService.getActiveStreams(cursor, limit);
    res.status(200).json(streams);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getDiscoveryStreams = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const sort = req.query.sort as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = await liveService.getDiscoveryStreams(Math.min(Math.max(limit, 1), 50), category, search, sort, cursor);
    res.status(200).json({ streams: result.items, nextCursor: result.nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const updateStream = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    if (!hostId) return void res.status(401).json({ error: 'Unauthorized' });
    const stream = await liveService.updateStream(getParamString(req.params.streamId), hostId, req.body || {});
    res.status(200).json({ stream });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const deleteStream = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    if (!hostId) return void res.status(401).json({ error: 'Unauthorized' });
    await liveService.deleteStream(getParamString(req.params.streamId), hostId);
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const getFollowingStreams = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const streams = await liveService.getFollowingStreams(userId);
    res.status(200).json({ streams });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getStream = async (req: Request, res: Response): Promise<void> => {
  try {
    const streamId = getParamString(req.params.streamId);
    const stream = await liveService.getStream(streamId);
    res.status(200).json(stream);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(404).json({ error: message });
  }
};

export const getStreamChat = async (req: Request, res: Response): Promise<void> => {
  try {
    const streamId = getParamString(req.params.streamId);
    const messages = await liveService.getStreamChat(streamId);
    res.status(200).json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const startStream = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    const { title, category, description, thumbnailUrl, allowGifts, allowPK, language, country, recordingEnabled } = req.body;

    if (!hostId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!title || !category) {
      res.status(400).json({ error: 'Title and category are required' });
      return;
    }

    const stream = await liveService.startStream(
      hostId,
      String(title).trim().slice(0, 120),
      String(category).trim().slice(0, 60),
      description ? String(description).trim().slice(0, 2000) : undefined,
      thumbnailUrl,
      allowGifts,
      allowPK,
      language,
      country,
      recordingEnabled
    );
    res.status(201).json({ message: 'Live stream started', stream });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const joinStream = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const viewers = await liveService.joinStream(streamId, userId);
    res.status(200).json({ streamId, viewers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const leaveStream = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const viewers = await liveService.leaveStream(streamId, userId);
    res.status(200).json({ streamId, viewers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);
    const { message } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!message || !message.trim()) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const chatMessage = await liveService.postChatMessage(streamId, userId, message.trim());
    res.status(201).json({ chatMessage });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const followStreamer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const followerId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);

    if (!followerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const stream = await liveService.getStream(streamId);
    const follow = await liveService.followStreamer(stream.hostId, followerId);
    res.status(200).json({ follow });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const endStream = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);

    if (!hostId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const stream = await liveService.endStream(streamId, hostId);
    res.status(200).json({ message: 'Live stream ended', stream });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getStreamHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!hostId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const streams = await liveService.getStreamHistory(hostId, limit);
    res.status(200).json(streams);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getHostStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    if (!hostId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const stats = await liveService.getHostStats(hostId);
    res.status(200).json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getViewerToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = await liveService.getViewerToken(streamId, userId);
    res.status(200).json({ token });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getHostToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);

    if (!hostId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = await liveService.getHostToken(streamId, hostId);
    res.status(200).json({ token });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const likeStream = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const streamId = getParamString(req.params.streamId);
    const stream = await liveService.likeStream(streamId);
    res.status(200).json({ likes: stream.likes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getTrendingStreams = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const streams = await liveService.getTrendingStreams(Math.min(Math.max(limit, 1), 50));
    res.status(200).json({ streams });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getRecentlyEnded = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const streams = await liveService.getRecentlyEnded(Math.min(Math.max(limit, 1), 50));
    res.status(200).json({ streams });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getPopularCreators = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const creators = await liveService.getPopularCreators(Math.min(Math.max(limit, 1), 50));
    res.status(200).json({ creators });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getStreamAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);
    if (!hostId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const analytics = await liveService.getStreamAnalytics(streamId, hostId);
    res.status(200).json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const reportStream = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reporterId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);
    const { reason, description } = req.body;
    if (!reporterId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!reason || !reason.trim()) {
      res.status(400).json({ error: 'Reason is required' });
      return;
    }
    const report = await liveService.reportStream(streamId, reporterId, reason.trim(), description);
    res.status(201).json({ message: 'Stream reported', report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getStreamReplay = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);
    if (!hostId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const replay = await liveService.getStreamReplay(streamId, hostId);
    res.status(200).json(replay);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getStreamShare = async (req: Request, res: Response): Promise<void> => {
  try {
    const streamId = getParamString(req.params.streamId);
    const share = await liveService.getStreamShare(streamId);
    res.status(200).json(share);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getStreamModeration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hostId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);
    if (!hostId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const moderation = await liveService.getStreamModeration(streamId, hostId);
    res.status(200).json(moderation);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getStreamBlocked = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await liveService.getStreamBlocked(streamId, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getStreamFollowing = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await liveService.getStreamFollowing(streamId, userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getGuests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const streamId = getParamString(req.params.streamId);
    const state = await liveService.getGuestState(streamId);
    res.status(200).json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};

export const getGuestToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const streamId = getParamString(req.params.streamId);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const role = await liveService.isStageParticipant(streamId, userId);
    if (role !== 'guest') {
      res.status(403).json({ error: 'You are not an approved guest on this stage' });
      return;
    }
    const stream = await liveService.getStream(streamId);
    if (!stream?.liveKitRoom) {
      res.status(400).json({ error: 'Stream has no live room' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
    const token = await liveKitService.generateGuestToken(stream.liveKitRoom, userId, user?.username || userId);
    res.status(200).json({ token, roomName: stream.liveKitRoom });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(400).json({ error: message });
  }
};
