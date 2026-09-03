import { prisma } from '../prisma';
import { auditLog } from './auditLog';
import { config } from './config';

export class SecurityMonitoring {
  async checkSuspiciousActivity(): Promise<any[]> {
    const alerts: any[] = [];
    const timeframe = new Date(Date.now() - 3600000);

    // Check for multiple failed logins in short period
    const failedLogins = await prisma.securityLog.findMany({
      where: { action: 'LOGIN_FAILED', createdAt: { gte: timeframe } },
    });
    const failedPerUser = new Map<string, number>();
    for (const log of failedLogins) {
      failedPerUser.set(log.userId, (failedPerUser.get(log.userId) || 0) + 1);
    }
    for (const [userId, count] of failedPerUser) {
      if (count >= 5) {
        alerts.push({ type: 'BRUTE_FORCE', userId, count, timeframe: '1h' });
      }
    }

    // Check for rapid account creation from same IP
    const registrations = await prisma.securityLog.findMany({
      where: { action: 'REGISTER_SUCCESS', createdAt: { gte: timeframe } },
    });
    const regPerIP = new Map<string, string[]>();
    for (const log of registrations) {
      const ip = log.ipAddress || 'unknown';
      if (!regPerIP.has(ip)) regPerIP.set(ip, []);
      regPerIP.get(ip)!.push(log.userId);
    }
    for (const [ip, users] of regPerIP) {
      if (users.length >= 3) {
        alerts.push({ type: 'RAPID_REGISTRATION', ip, count: users.length, users });
      }
    }

    return alerts;
  }

  async notifyAdmins(type: string, data: any): Promise<void> {
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true, email: true },
    });
    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: 'SECURITY_ALERT',
          title: `Security Alert: ${type}`,
          body: JSON.stringify(data),
          metadata: JSON.stringify(data),
        },
      });
    }
  }

  async checkAccountHealth(userId: string): Promise<{ status: string; issues: string[] }> {
    const issues: string[] = [];
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { securityLogs: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    if (!user) return { status: 'UNKNOWN', issues: ['User not found'] };
    if (user.status !== 'ACTIVE') issues.push(`Account status: ${user.status}`);
    if (user.loginAttempts >= 3) issues.push(`Multiple failed login attempts: ${user.loginAttempts}`);
    const recentFailed = user.securityLogs.filter(l => l.action === 'LOGIN_FAILED').length;
    if (recentFailed >= 3) issues.push('Multiple recent login failures');
    return { status: issues.length === 0 ? 'HEALTHY' : 'WARNING', issues };
  }
}

export const securityMonitoring = new SecurityMonitoring();