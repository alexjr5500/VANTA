import { io, Socket, ManagerOptions, SocketOptions } from 'socket.io-client';
import { SOCKET_BASE_URL } from './api';

// Socket connection pool for reusing connections
const socketPool = new Map<string, Socket>();

// Event batching configuration
const BATCH_INTERVAL = 100; // ms to batch events
const eventBuffer = new Map<string, Array<{ event: string; data: any }>>();
const batchTimers = new Map<string, NodeJS.Timeout>();

// Reconnection configuration with exponential backoff
const RECONNECTION_CONFIG: Partial<ManagerOptions & SocketOptions> = {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,        // Start with 1 second
  reconnectionDelayMax: 30000,     // Max 30 seconds
  randomizationFactor: 0.5,       // Add jitter to prevent thundering herd
  timeout: 20000,                  // Connection timeout
  autoConnect: false,
  transports: ['websocket', 'polling'],
  withCredentials: true,
  // Enable compression
  perMessageDeflate: { threshold: 1024 },
};

// Batched event emitter - reduces network traffic
export const emitBatched = (socket: Socket, event: string, data: any) => {
  const key = `${socket.id}-${event}`;
  
  if (!eventBuffer.has(key)) {
    eventBuffer.set(key, []);
  }
  
  eventBuffer.get(key)!.push({ event, data });
  
  // Clear existing timer
  if (batchTimers.has(key)) {
    clearTimeout(batchTimers.get(key)!);
  }
  
  // Set new timer to flush batch
  batchTimers.set(key, setTimeout(() => {
    const batch = eventBuffer.get(key);
    if (batch && batch.length > 0) {
      // If single event, emit normally
      if (batch.length === 1) {
        socket.emit(event, batch[0].data);
      } else {
        // Batch multiple events
        socket.emit(`batch:${event}`, batch.map(b => b.data));
      }
      eventBuffer.delete(key);
    }
    batchTimers.delete(key);
  }, BATCH_INTERVAL));
};

// Create optimized socket connection with reconnection management.
// `namespace` selects the Socket.IO namespace/path (e.g. '/calls'). When it is
// omitted the connection uses the DEFAULT namespace, which is where the VANTA
// backend mounts chat + private-call signaling. `poolKey` lets callers get a
// SEPARATE pooled connection even when they share the same namespace path, so
// one consumer (e.g. the Chat page) can never tear down another consumer's
// (e.g. the global call provider's) socket by unmounting.
export const createSocket = (token?: string, namespace?: string, poolKey?: string): Socket => {
  const key = poolKey || namespace || 'default';

  // Reuse existing socket connection from pool
  const existing = socketPool.get(key);
  if (existing?.connected) {
    return existing;
  }
  
  const socket: Socket = io(namespace && namespace.startsWith('/') ? SOCKET_BASE_URL + namespace : SOCKET_BASE_URL, {
    ...RECONNECTION_CONFIG,
    auth: {
      token,
    },
  });
  
  // Connection event handlers with performance monitoring
  socket.on('connect', () => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Socket] Connected: ${socket.id}`, {
        transport: socket.io.engine.transport.name,
        reconnectionAttempts: socket.io.reconnectionAttempts(),
      });
    }
  });
  
  socket.on('disconnect', (reason) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Socket] Disconnected: ${reason}`);
    }
  });
  
  socket.on('connect_error', (error) => {
    console.error(`[Socket] Connection error:`, error.message);
  });
  
  // Store in pool for reuse
  socketPool.set(key, socket);
  
  // Clean up on disconnect
  socket.on('disconnect', () => {
    // Don't remove from pool immediately - allow reconnection
    setTimeout(() => {
      if (!socket.connected) {
        socketPool.delete(key);
      }
    }, 5000);
  });
  
  return socket;
};

// Disconnect and cleanup all sockets
export const disconnectAllSockets = () => {
  for (const [key, socket] of socketPool) {
    socket.disconnect();
    socketPool.delete(key);
  }
  // Clear event buffers
  for (const [key, timer] of batchTimers) {
    clearTimeout(timer);
  }
  eventBuffer.clear();
  batchTimers.clear();
};

// Get socket health stats
export const getSocketStats = () => {
  const stats: Record<string, any> = {};
  for (const [key, socket] of socketPool) {
    stats[key] = {
      connected: socket.connected,
      disconnected: socket.disconnected,
      id: socket.id,
      transport: socket.io.engine?.transport?.name || 'unknown',
      reconnectionAttempts: socket.io?.reconnectionAttempts?.() || 0,
      bufferedAmount: (socket as any).bufferedAmount || 0,
    };
  }
  return stats;
};

export type { Socket } from 'socket.io-client';