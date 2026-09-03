// ============================================================================
// VANTA Analytics - WebSocket Real-Time Updates
// Provides real-time analytics data streaming to connected clients
// ============================================================================

import { Server, Socket } from 'socket.io';
import { analyticsEngine } from './analytics.service';
import { AnalyticsEvent, METRIC_DEFINITIONS } from './analytics.types';

// Track which clients are subscribed to which analytics events
interface AnalyticsSubscription {
  socketId: string;
  userId: string;
  role: string;
  channels: Set<string>;
  interval?: NodeJS.Timeout;
}

const subscriptions = new Map<string, AnalyticsSubscription>();

// Broadcast intervals (ms)
const REALTIME_BROADCAST_INTERVAL = 2000; // 2 seconds for live metrics
const DASHBOARD_BROADCAST_INTERVAL = 5000; // 5 seconds for dashboard data

export function registerAnalyticsSocketHandlers(io: Server): void {
  const analyticsNamespace = io.of('/analytics');

  analyticsNamespace.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    const role = (socket as any).role || 'USER';

    // Create subscription entry
    subscriptions.set(socket.id, {
      socketId: socket.id,
      userId,
      role,
      channels: new Set(),
    });

    console.info(`[AnalyticsSocket] Client connected: userId=${userId}, role=${role}`);

    // Join analytics room based on role
    socket.join('analytics');
    if (['ADMIN', 'SUPER_ADMIN'].includes(role)) {
      socket.join('analytics:admin');
    }
    if (['CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      socket.join('analytics:creator');
    }
    if (['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      socket.join('analytics:moderator');
    }

    // === CLIENT SUBSCRIPTIONS ===

    // Subscribe to real-time metrics
    socket.on('analytics:subscribe:realtime', () => {
      const sub = subscriptions.get(socket.id);
      if (!sub) return;
      sub.channels.add('realtime');
      socket.join('analytics:realtime');
      
      // Send initial data
      socket.emit('analytics:realtime', analyticsEngine.getRealtimeMetrics());
    });

    // Unsubscribe from real-time
    socket.on('analytics:unsubscribe:realtime', () => {
      const sub = subscriptions.get(socket.id);
      if (!sub) return;
      sub.channels.delete('realtime');
      socket.leave('analytics:realtime');
    });

    // Subscribe to a specific metric stream
    socket.on('analytics:subscribe:metric', (data: { metric: string; period?: string }) => {
      const sub = subscriptions.get(socket.id);
      if (!sub) return;
      
      const channel = `analytics:metric:${data.metric}`;
      sub.channels.add(channel);
      
      // Send initial data
      analyticsEngine.getMetric(data.metric, {
        metric: data.metric,
        period: (data.period as any) || 'daily',
      }).then(result => {
        socket.emit('analytics:metric:update', { metric: data.metric, data: result });
      }).catch(err => {
        socket.emit('analytics:error', { message: err.message });
      });
    });

    // Unsubscribe from metric
    socket.on('analytics:unsubscribe:metric', (data: { metric: string }) => {
      const sub = subscriptions.get(socket.id);
      if (!sub) return;
      
      const channel = `analytics:metric:${data.metric}`;
      sub.channels.delete(channel);
    });

    // Subscribe to stream analytics
    socket.on('analytics:subscribe:stream', (data: { streamId: string }) => {
      const sub = subscriptions.get(socket.id);
      if (!sub) return;
      
      const channel = `analytics:stream:${data.streamId}`;
      sub.channels.add(channel);
      socket.join(`stream:${data.streamId}:analytics`);
    });

    // Unsubscribe from stream
    socket.on('analytics:unsubscribe:stream', (data: { streamId: string }) => {
      const sub = subscriptions.get(socket.id);
      if (!sub) return;
      
      const channel = `analytics:stream:${data.streamId}`;
      sub.channels.delete(channel);
      socket.leave(`stream:${data.streamId}:analytics`);
    });

    // Subscribe to all creator analytics
    socket.on('analytics:subscribe:creator', () => {
      const sub = subscriptions.get(socket.id);
      if (!sub) return;
      sub.channels.add('creator');
      socket.join('analytics:creator');
    });

    // Manually trigger an analytics event
    socket.on('analytics:track', (data: AnalyticsEvent) => {
      analyticsEngine.track({
        ...data,
        userId: data.userId || userId,
        timestamp: new Date().toISOString(),
      });
    });

    // Request specific dashboard data
    socket.on('analytics:request:dashboard', async (data: { dashboard: string; period?: string }) => {
      try {
        let result: any;
        
        switch (data.dashboard) {
          case 'executive':
            // Simplified executive dashboard data via socket
            const [dau, mau, revenue] = await Promise.all([
              analyticsEngine.getMetric('dau', { metric: 'dau', period: 'daily' }),
              analyticsEngine.getMetric('mau', { metric: 'mau', period: 'monthly' }),
              analyticsEngine.getMetric('platform_revenue', { metric: 'platform_revenue', period: 'monthly' }),
            ]);
            result = {
              kpis: {
                dau: dau.total || 0,
                mau: mau.total || 0,
                revenue: revenue.value || 0,
              },
              realtime: analyticsEngine.getRealtimeMetrics(),
            };
            break;
          case 'realtime':
            result = analyticsEngine.getRealtimeMetrics();
            break;
          default:
            result = { error: 'Unknown dashboard' };
        }
        
        socket.emit('analytics:dashboard:data', { dashboard: data.dashboard, data: result });
      } catch (err: any) {
        socket.emit('analytics:error', { message: err.message });
      }
    });

    // Disconnect handler
    socket.on('disconnect', () => {
      const sub = subscriptions.get(socket.id);
      if (sub) {
        if (sub.interval) clearInterval(sub.interval);
        subscriptions.delete(socket.id);
      }
      console.info(`[AnalyticsSocket] Client disconnected: userId=${userId}`);
    });
  });

  // ============================================================================
  // GLOBAL BROADCASTERS - Push updates to subscribed clients
  // ============================================================================

  // Broadcast real-time metrics every 2 seconds
  setInterval(() => {
    const metrics = analyticsEngine.getRealtimeMetrics();
    analyticsNamespace.to('analytics:realtime').emit('analytics:realtime', metrics);
  }, REALTIME_BROADCAST_INTERVAL);

  // Broadcast key metrics to admin dashboard every 5 seconds
  setInterval(async () => {
    try {
      const [dau, activeStreams, messages] = await Promise.all([
        analyticsEngine.getMetric('dau', { metric: 'dau', period: 'daily' }),
        Promise.resolve(analyticsEngine.getRealtimeMetrics().activeStreams),
        Promise.resolve(analyticsEngine.getRealtimeMetrics().messagesPerSecond),
      ]);

      const dashboardUpdate = {
        dau: dau.total || 0,
        activeStreams,
        messagesPerSecond: messages,
        realtime: analyticsEngine.getRealtimeMetrics(),
        timestamp: new Date().toISOString(),
      };

      analyticsNamespace.to('analytics:admin').emit('analytics:dashboard:executive', dashboardUpdate);
    } catch {
      // Silent fail for broadcast
    }
  }, DASHBOARD_BROADCAST_INTERVAL);

  // Listen for events from the analytics engine and broadcast
  analyticsEngine.onEvent((event: AnalyticsEvent) => {
    // Broadcast specific event types to relevant rooms
    switch (event.eventType) {
      case 'stream.start':
      case 'stream.end':
        analyticsNamespace.to('analytics:admin').emit('analytics:stream:update', {
          type: event.eventType,
          streamId: event.targetId,
          timestamp: event.timestamp,
        });
        break;

      case 'gift.sent':
        if (event.targetId) {
          analyticsNamespace.to(`stream:${event.targetId}:analytics`).emit('analytics:gift', {
            streamId: event.targetId,
            value: event.value,
            senderId: event.userId,
            timestamp: event.timestamp,
          });
        }
        break;

      case 'coin.purchase':
        analyticsNamespace.to('analytics:admin').emit('analytics:revenue', {
          type: 'coin_purchase',
          value: event.value,
          userId: event.userId,
          timestamp: event.timestamp,
        });
        break;

      case 'user.register':
        analyticsNamespace.to('analytics:admin').emit('analytics:user:registered', {
          userId: event.userId,
          source: event.source,
          timestamp: event.timestamp,
        });
        break;
    }
  });

  console.info('[AnalyticsSocket] Real-time analytics broadcasting initialized');
}