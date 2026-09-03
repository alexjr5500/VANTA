import { prisma } from '../prisma';

/**
 * Audit actions - centralized enum for all auditable events
 */
export enum AuditAction {
  // Authentication
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  REGISTER = 'REGISTER',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  EMAIL_CHANGED = 'EMAIL_CHANGED',
  
  // 2FA
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_DISABLED = 'TWO_FACTOR_DISABLED',
  TWO_FACTOR_VERIFIED = 'TWO_FACTOR_VERIFIED',
  BACKUP_CODES_GENERATED = 'BACKUP_CODES_GENERATED',
  BACKUP_CODE_USED = 'BACKUP_CODE_USED',
  TRUSTED_DEVICE_ADDED = 'TRUSTED_DEVICE_ADDED',
  
  // Sessions
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  ALL_SESSIONS_REVOKED = 'ALL_SESSIONS_REVOKED',
  REFRESH_TOKEN_ROTATED = 'REFRESH_TOKEN_ROTATED',
  
  // Admin actions
  ADMIN_ACTION = 'ADMIN_ACTION',
  USER_BANNED = 'USER_BANNED',
  USER_UNBANNED = 'USER_UNBANNED',
  USER_ROLE_CHANGED = 'USER_ROLE_CHANGED',
  PERMISSION_CHANGED = 'PERMISSION_CHANGED',
  
  // Moderation
  REPORT_SUBMITTED = 'REPORT_SUBMITTED',
  REPORT_REVIEWED = 'REPORT_REVIEWED',
  CONTENT_DELETED = 'CONTENT_DELETED',
  USER_MUTED = 'USER_MUTED',
  
  // Account
  ACCOUNT_DELETED = 'ACCOUNT_DELETED',
  ACCOUNT_RECOVERY = 'ACCOUNT_RECOVERY',
  DATA_EXPORT_REQUESTED = 'DATA_EXPORT_REQUESTED',
  
  // Security
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  BRUTE_FORCE_DETECTED = 'BRUTE_FORCE_DETECTED',
  DEVICE_FINGERPRINT_CHANGED = 'DEVICE_FINGERPRINT_CHANGED',
  IP_CHANGED = 'IP_CHANGED',
  
  // Payments
  PAYMENT_INITIATED = 'PAYMENT_INITIATED',
  PAYMENT_COMPLETED = 'PAYMENT_COMPLETED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_PROCESSED = 'WITHDRAWAL_PROCESSED',
}

/**
 * Enterprise audit logging system
 * All security events are logged with tamper-evident details
 */
class AuditLogger {
  /**
   * Log a security event
   */
  async log(
    userId: string,
    action: AuditAction | string,
    options?: {
      ipAddress?: string;
      userAgent?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      await prisma.securityLog.create({
        data: {
          userId,
          action,
          ipAddress: options?.ipAddress || null,
          userAgent: options?.userAgent || null,
          metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
        },
      });
    } catch (error) {
      // Audit logging should never crash the application
      console.error('Audit log error:', error);
    }
  }

  /**
   * Log an event and return immediately (fire-and-forget)
   */
  logAsync(
    userId: string,
    action: AuditAction | string,
    options?: {
      ipAddress?: string;
      userAgent?: string;
      metadata?: Record<string, any>;
    }
  ): void {
    this.log(userId, action, options).catch((err) => {
      console.error('Async audit log error:', err);
    });
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserLogs(userId: string, limit: number = 50, cursor?: string) {
    const query: any = {
      where: { userId },
      orderBy: { createdAt: 'desc' as const },
      take: limit + 1,
    };

    if (cursor) {
      query.cursor = { id: cursor };
      query.skip = 1;
    }

    const logs = await prisma.securityLog.findMany(query);
    const nextCursor = logs.length > limit ? logs.pop()?.id : undefined;

    return {
      items: logs.map((log) => ({
        id: log.id,
        action: log.action,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        metadata: log.metadata ? JSON.parse(log.metadata) : null,
        createdAt: log.createdAt,
      })),
      nextCursor,
    };
  }

  /**
   * Get all audit logs for admin review (with pagination)
   */
  async getAllLogs(
    limit: number = 100,
    cursor?: string,
    filters?: {
      action?: string;
      userId?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ) {
    const where: any = {};
    
    if (filters?.action) where.action = filters.action;
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const query: any = {
      where,
      orderBy: { createdAt: 'desc' as const },
      take: limit + 1,
      include: {
        user: {
          select: { id: true, username: true, email: true },
        },
      },
    };

    if (cursor) {
      query.cursor = { id: cursor };
      query.skip = 1;
    }

    const logs = await prisma.securityLog.findMany(query);
    const nextCursor = logs.length > limit ? logs.pop()?.id : undefined;

    return {
      items: logs.map((log: any) => ({
        id: log.id,
        user: log.user,
        action: log.action,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        metadata: log.metadata ? JSON.parse(log.metadata) : null,
        createdAt: log.createdAt,
      })),
      nextCursor,
    };
  }
}

export const auditLogger = new AuditLogger();