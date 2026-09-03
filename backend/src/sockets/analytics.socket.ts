import { Server, Socket } from 'socket.io';
import { analyticsService } from '../services/analytics.service';

const INTERVALS = {
  ACTIVE_USERS: 10000,      // Every 10 seconds
  PLATFORM_OVERVIEW: 15000,  // Every 15 seconds
  REVENUE: 30000,            // Every 30 seconds
  STREAMS: 10000,            // Every 10 seconds
  PERFORMANCE: 20000,        // Every 20 seconds
};

export function handleAnalyticsSocket(io: Server) {
  const namespace = io.of('/analytics');
  
  namespace.on('connection', async (socket: Socket) => {
    console.log('[AnalyticsSocket] Client connected:', socket.id);

    // Join rooms based on user role/permissions
    socket.on('subscribe', (rooms: string | string[]) => {
      const roomList = Array.isArray(rooms) ? rooms : [rooms];
      roomList.forEach(room => {
        socket.join(room);
        console.log(`[AnalyticsSocket] ${socket.id} joined room: ${room}`);
      });
    });

    socket.on('unsubscribe', (rooms: string | string[]) => {
      const roomList = Array.isArray(rooms) ? rooms : [rooms];
      roomList.forEach(room => {
        socket.leave(room);
      });
    });

    // Client requests real-time data snapshot
    socket.on('get:live-overview', async () => {
      try {
        const data = await getLiveOverview();
        socket.emit('live:overview', data);
      } catch (error) {
        socket.emit('error', { message: 'Failed to get live overview' });
      }
    });

    socket.on('get:active-users', async () => {
      try {
        const [dau, online] = await Promise.all([
          analyticsService.getCurrentDAU(),
          analyticsService.getOnlineUsers(),
        ]);
        socket.emit('live:active-users', { dau, online, timestamp: new Date() });
      } catch (error) {
        socket.emit('error', { message: 'Failed to get active users' });
      }
    });

    socket.on('get:revenue', async () => {
      try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const revenue = await analyticsService.getRevenueAnalytics({
          period: 'DAILY',
          startDate: todayStart,
          endDate: now,
        });
        socket.emit('live:revenue', { ...revenue, timestamp: new Date() });
      } catch (error) {
        socket.emit('error', { message: 'Failed to get revenue' });
      }
    });

    socket.on('disconnect', () => {
      console.log('[AnalyticsSocket] Client disconnected:', socket.id);
    });
  });

  // ============================================================
  // Real-time broadcast intervals
  // ============================================================

  // Broadcast active users to all listeners
  setInterval(async () => {
    try {
      const [dau, online] = await Promise.all([
        analyticsService.getCurrentDAU(),
        analyticsService.getOnlineUsers(),
      ]);
      namespace.emit('live:active-users', { dau, online, timestamp: new Date() });
    } catch (error) {
      // Silently handle errors in broadcast
    }
  }, INTERVALS.ACTIVE_USERS);

  // Broadcast platform overview
  setInterval(async () => {
    try {
      const overview = await analyticsService.getPlatformOverview();
      namespace.emit('live:overview', { ...overview, timestamp: new Date() });
    } catch (error) {
      // Silently handle
    }
  }, INTERVALS.PLATFORM_OVERVIEW);

  // Broadcast active streams
  setInterval(async () => {
    try {
      const streams = await analyticsService.getActiveStreamsAnalytics();
      namespace.emit('live:streams', {
        streams,
        totalViewers: streams.reduce((sum, s) => sum + s.viewerCount, 0),
        totalStreams: streams.length,
        timestamp: new Date(),
      });
    } catch (error) {
      // Silently handle
    }
  }, INTERVALS.STREAMS);
}

/**
 * Get a live snapshot of all real-time metrics
 */
async function getLiveOverview() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    dau,
    online,
    activeStreams,
    newUsersToday,
    overview,
  ] = await Promise.all([
    analyticsService.getCurrentDAU(),
    analyticsService.getOnlineUsers(),
    analyticsService.getActiveStreamsAnalytics(),
    analyticsService.getNewRegistrations(todayStart, now),
    analyticsService.getPlatformOverview(),
  ]);

  return {
    dau,
    online,
    activeStreams: activeStreams.length,
    totalViewers: activeStreams.reduce((sum, s) => sum + s.viewerCount, 0),
    newUsersToday,
    ...overview,
    timestamp: now,
  };
}

export { getLiveOverview };