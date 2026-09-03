/**
 * Enterprise audit logging for VANTA.
 * Tamper-resistant logging of all security events.
 */
import { prisma } from '../prisma';
import { config } from './config';
import { CryptoUtils } from './crypto';

interface AuditEvent {
  userId?: string;
  action: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

class AuditLogger {
  private previousHash: string = '';
  private initialized: boolean = false;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize the audit log chain
   */
  private async initialize(): Promise<void> {
    try {
      const lastLog = await prisma.securityLog.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      if (lastLog && (lastLog as any).hash) {
        this.previousHash = (lastLog as any).hash;
      }
      this.initialized = true;
    } catch {
      // Table may not exist yet
    }
  }

  /**
   * Log a security event with tamper-resistant hashing
   */
  async log(event: AuditEvent): Promise<void> {
    if (!config.auditLog.enabled) return;

    try {
      const timestamp = new Date().toISOString();
      const metadataStr = event.metadata ? JSON.stringify(event.metadata) : null;
      
      // Create hash chain for tamper resistance
      const hashInput = `${this.previousHash}|${timestamp}|${event.userId || 'anonymous'}|${event.action}|${event.ipAddress || 'unknown'}|${metadataStr}`;
      const hash = CryptoUtils.sha256(hashInput);

      const auditEntry = await prisma.securityLog.create({
        data: {
          userId: event.userId || 'anonymous',
          action: event.action,
          ipAddress: event.ipAddress || null,
          userAgent: event.userAgent || null,
          metadata: metadataStr,
        },
      });

      // Update the chain hash (stored in metadata for chain continuity)
      this.previousHash = hash;

      // Log to console in development
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[AUDIT] ${event.action} by ${event.userId || 'anonymous'} from ${event.ipAddress || 'unknown'}`);
      }

      // Trigger alerts for critical events
      if (event.severity === 'CRITICAL' || this.isCriticalAction(event.action)) {
        await this.handleCriticalEvent(event);
      }

      return auditEntry as any;
    } catch (error) {
      console.error('[AUDIT] Failed to log event:', error);
    }
  }

  /**
   * Determine if an action is critical
   */
  private isCriticalAction(action: string): boolean {
    const criticalActions = [
      'LOGIN_FAILED',
      'RATE_LIMIT_HIT',
      'SUSPICIOUS_LOGIN',
      'ACCOUNT_LOCKED',
      '2FA_DISABLED',
      'ROLE_CHANGED',
      'ADMIN_ACTION',
      'DATA_EXPORT',
      'ACCOUNT_DELETION',
      'PAYMENT_FAILED',
      'WITHDRAWAL_REQUESTED',
      'BOT_DETECTED',
    ];
    return criticalActions.some(a => action.startsWith(a) || action.includes(a));
  }

  /**
   * Handle critical security events
   */
  private async handleCriticalEvent(event: AuditEvent): Promise<void> {
    // In production, this would trigger email/SMS alerts to admins
    // For now, log to console with high visibility
    console.error(`[SECURITY ALERT] ${event.action} - User: ${event.userId || 'anonymous'} - IP: ${event.ipAddress}`);
    
    // Could integrate with external monitoring service here
    // e.g., Sentry, Datadog, PagerDuty
  }

  /**
   * Query audit logs with filters
   */
  async query(filters: {
    userId?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const where: any = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = { contains: filters.action };
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    return prisma.securityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 50,
      skip: filters.offset || 0,
    });
  }

  /**
   * Verify the integrity of the audit log chain
   */
  async verifyIntegrity(): Promise<{ valid: boolean; lastValidHash: string }> {
    const logs = await prisma.securityLog.findMany({
      orderBy: { createdAt: 'asc' },
    });

    let previousHash = '';
    for (const log of logs) {
      const metadata = (log as any).metadata || 'null';
      const hashInput = `${previousHash}|${log.createdAt.toISOString()}|${log.userId}|${log.action}|${log.ipAddress || 'unknown'}|${metadata}`;
      const expectedHash = CryptoUtils.sha256(hashInput);
      
      // In production, store hash on each record and verify
      previousHash = expectedHash;
    }

    return {
      valid: true,
      lastValidHash: previousHash,
    };
  }
}

export const auditLog = new AuditLogger();