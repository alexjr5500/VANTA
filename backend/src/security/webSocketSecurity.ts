/**
 * Enterprise WebSocket security for VANTA.
 * Secures real-time communication with authentication,
 * authorization, rate limiting, and event validation.
 */
import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { config } from './config';
import { auditLog } from './auditLog';
import { Role, hasPermission, Permission, parseRole } from './rbac';
import { rateLimiter } from './rateLimiter';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  role?: Role;
  sessionId?: string;
}

/**
 * WebSocket authentication middleware
 */
export async function authenticateSocket(
  socket: AuthenticatedSocket,
  next: (err?: Error) => void
): Promise<void> {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const jwtSecret = config.jwt.accessToken.secret();
    const decoded = jwt.verify(token as string, jwtSecret) as {
      userId?: string;
      role?: string;
      sessionId?: string;
    };

    if (!decoded || !decoded.userId) {
      return next(new Error('Invalid token'));
    }

    // Verify session
    const session = await prisma.session.findFirst({
      where: {
        userId: decoded.userId,
        expiresAt: { gt: new Date() },
      },
      include: { user: { select: { status: true, role: true } } },
    });

    if (!session || session.user.status !== 'ACTIVE') {
      return next(new Error('Session invalid or account restricted'));
    }

    // Update session activity
    await prisma.session.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date() },
    });

    socket.userId = decoded.userId;
    socket.role = parseRole(session.user.role);
    socket.sessionId = session.id;

    // Join user-specific room
    socket.join(`user:${decoded.userId}`);

    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
}

/**
 * WebSocket event rate limiter
 */
const eventCounts = new Map<string, { count: number; resetAt: number }>();

function checkEventRate(socketId: string, maxEvents: number = 60, windowMs: number = 60000): boolean {
  const now = Date.now();
  const key = socketId;
  const current = eventCounts.get(key);

  if (!current || current.resetAt < now) {
    eventCounts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= maxEvents) {
    return false;
  }

  current.count++;
  return true;
}

/**
 * Validate WebSocket event payload against injection attacks
 */
function isValidEventPayload(data: any): boolean {
  if (typeof data === 'string') {
    // Check for common injection patterns
    const dangerousPatterns = [
      /\$where/i,
      /\$ne/i,
      /\$gt/i,
      /\$regex/i,
      /\$\{/,
      /\0/,
      /\n/,
    ];

    return !dangerousPatterns.some(pattern => pattern.test(data));
  }

  if (typeof data === 'object' && data !== null) {
    return Object.values(data).every((value: any) => {
      if (typeof value === 'string') return isValidEventPayload(value);
      if (typeof value === 'object' && value !== null) return isValidEventPayload(value);
      return true;
    });
  }

  return true;
}

/**
 * Create a secured socket event handler with authorization checks
 */
export function createSecuredEventHandler(
  eventName: string,
  handler: (socket: AuthenticatedSocket, data: any) => Promise<void>,
  requiredPermission?: Permission
) {
  return async (socket: AuthenticatedSocket, data: any): Promise<void> => {
    try {
      // Check authentication
      if (!socket.userId) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      // Check rate limit
      if (!checkEventRate(socket.id)) {
        auditLog.log({
          userId: socket.userId,
          action: 'SOCKET_RATE_LIMIT',
          metadata: { event: eventName, socketId: socket.id },
          severity: 'WARNING',
        });

        socket.emit('error', { message: 'Rate limit exceeded. Please slow down.' });
        return;
      }

      // Check permission
      if (requiredPermission && !hasPermission(socket.role || Role.USER, requiredPermission)) {
        auditLog.log({
          userId: socket.userId,
          action: 'SOCKET_UNAUTHORIZED',
          metadata: { event: eventName, permission: requiredPermission },
          severity: 'WARNING',
        });

        socket.emit('error', { message: 'Insufficient permissions' });
        return;
      }

      // Validate payload
      if (!isValidEventPayload(data)) {
        auditLog.log({
          userId: socket.userId,
          action: 'SOCKET_INVALID_PAYLOAD',
          metadata: { event: eventName },
          severity: 'WARNING',
        });

        socket.emit('error', { message: 'Invalid event data' });
        return;
      }

      // Execute handler
      await handler(socket, data);
    } catch (error) {
      console.error(`[WS ERROR] Event ${eventName}:`, error);
      socket.emit('error', { message: 'Internal server error' });
    }
  };
}

/**
 * Secured Socket.IO namespace/room authorization
 */
export function authorizeRoom(
  socket: AuthenticatedSocket,
  roomName: string
): boolean {
  // Room naming convention: resource:type:id
  // e.g., stream:live:12345, chat:conversation:67890

  const parts = roomName.split(':');
  if (parts.length < 3) return false;

  const resource = parts[0];
  const type = parts[1];
  const resourceId = parts.slice(2).join(':');

  switch (resource) {
    case 'user':
      // Users can only join their own room
      return socket.userId === resourceId;

    case 'stream':
      // In production, check if user is allowed to view the stream
      return true;

    case 'chat':
      // In production, verify user is a participant of the conversation
      return true;

    case 'admin':
      // Only admins can join admin rooms
      return socket.role === Role.ADMIN || socket.role === Role.SUPER_ADMIN;

    default:
      return false;
  }
}

/**
 * WebSocket event subscription manager
 * Prevents unauthorized subscription to events
 */
export class EventSubscriptionManager {
  private subscriptions: Map<string, Set<string>> = new Map();
  private allowedEvents: Map<string, Permission[]> = new Map();

  /**
   * Register an event and its required permissions
   */
  registerEvent(eventName: string, requiredPermissions: Permission[] = []): void {
    this.allowedEvents.set(eventName, requiredPermissions);
  }

  /**
   * Subscribe a socket to specific events
   */
  subscribe(socket: AuthenticatedSocket, eventName: string): boolean {
    if (!socket.userId) return false;

    const requiredPerms = this.allowedEvents.get(eventName);
    
    // Check permission
    if (requiredPerms && requiredPerms.length > 0) {
      const hasPerms = requiredPerms.every(perm =>
        hasPermission(socket.role || Role.USER, perm)
      );
      if (!hasPerms) return false;
    }

    // Track subscription
    if (!this.subscriptions.has(eventName)) {
      this.subscriptions.set(eventName, new Set());
    }
    this.subscriptions.get(eventName)!.add(socket.id);

    // Auto-cleanup on disconnect
    socket.on('disconnect', () => {
      this.subscriptions.get(eventName)?.delete(socket.id);
    });

    return true;
  }

  /**
   * Get subscriber count for an event
   */
  getSubscriberCount(eventName: string): number {
    return this.subscriptions.get(eventName)?.size || 0;
  }

  /**
   * Clean up stale subscriptions
   */
  cleanup(): void {
    for (const [event, subscribers] of this.subscriptions) {
      if (subscribers.size === 0) {
        this.subscriptions.delete(event);
      }
    }
  }
}

export const eventSubscriptionManager = new EventSubscriptionManager();

/**
 * Socket disconnect handler - logs session end
 */
export function handleDisconnect(socket: AuthenticatedSocket): void {
  if (socket.userId) {
    auditLog.log({
      userId: socket.userId,
      action: 'SOCKET_DISCONNECT',
      metadata: { socketId: socket.id },
    });

    // Clean up user presence
    prisma.userPresence.updateMany({
      where: { userId: socket.userId },
      data: { isOnline: false, lastActive: new Date() },
    }).catch(() => {});
  }
}

/**
 * Socket connect handler - logs session start
 */
export function handleConnect(socket: AuthenticatedSocket): void {
  if (socket.userId) {
    auditLog.log({
      userId: socket.userId,
      action: 'SOCKET_CONNECT',
      metadata: { socketId: socket.id },
    });

    // Update user presence
    prisma.userPresence.upsert({
      where: { userId: socket.userId },
      update: { isOnline: true, lastActive: new Date() },
      create: { userId: socket.userId, isOnline: true },
    }).catch(() => {});
  }
}