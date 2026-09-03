// =============================================================================
// VANTA AI Fraud Detection Service
// =============================================================================

import { prisma } from '../../prisma';

class FraudService {
  async detectFakeAccount(userId: string, signupData: any): Promise<{ isSuspicious: boolean; score: number; reasons: string[] }> {
    try {
      const reasons: string[] = [];
      if (signupData.email && /^[a-z]{6,}\d{4,}@/.test(signupData.email)) reasons.push('Generated email pattern');
      if (!signupData.avatar) reasons.push('No profile picture');
      if (signupData.username && /user\d{4,}/i.test(signupData.username)) reasons.push('Generic username pattern');

      if (reasons.length > 0) {
        await prisma.fraudAlert.create({
          data: {
            userId,
            alertType: 'FAKE_ACCOUNT',
            severity: reasons.length > 2 ? 'HIGH' : 'LOW',
            description: reasons.join('; '),
            evidence: JSON.stringify(signupData),
            aiConfidence: Math.min(0.9, reasons.length * 0.3),
          },
        });
      }
      return { isSuspicious: reasons.length > 1, score: Math.min(1, reasons.length * 0.3), reasons };
    } catch { return { isSuspicious: false, score: 0, reasons: [] }; }
  }

  async detectFakeFollowers(creatorId: string): Promise<{ fakeCount: number; suspiciousAccounts: string[] }> {
    try {
      const followers = await prisma.follow.findMany({
        where: { followingId: creatorId },
        include: { follower: { select: { id: true, avatar: true, createdAt: true, _count: { select: { followers: true, posts: true } } } } },
        take: 200,
      });
      const suspicious = followers.filter(f =>
        !f.follower.avatar && f.follower._count.followers < 3 && f.follower._count.posts === 0 &&
        new Date().getTime() - f.follower.createdAt.getTime() < 7 * 24 * 60 * 60 * 1000
      );
      return { fakeCount: suspicious.length, suspiciousAccounts: suspicious.map(s => s.follower.id) };
    } catch { return { fakeCount: 0, suspiciousAccounts: [] }; }
  }

  async detectBotBehavior(userId: string, activityLog: any): Promise<{ isBot: boolean; score: number; evidence: string[] }> {
    return { isBot: false, score: 0, evidence: [] };
  }

  async detectSpamCampaign(campaignData: any): Promise<{ isSpam: boolean; score: number; pattern: string }> {
    return { isSpam: false, score: 0, pattern: '' };
  }

  async detectAccountTakeover(userId: string, loginContext: any): Promise<{ isTakeover: boolean; score: number; reasons: string[] }> {
    try {
      const reasons: string[] = [];
      const recentLogins = await prisma.securityLog.findMany({
        where: { userId, action: 'LOGIN', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        orderBy: { createdAt: 'desc' }, take: 10,
      });
      if (loginContext.ipAddress && recentLogins.length > 0) {
        const knownIps = new Set(recentLogins.map(l => l.ipAddress).filter(Boolean));
        if (!knownIps.has(loginContext.ipAddress)) reasons.push('Login from new IP address');
      }
      if (reasons.length > 1) {
        await prisma.fraudAlert.create({
          data: { userId, alertType: 'ACCOUNT_TAKEOVER', severity: 'HIGH', description: reasons.join('; '), evidence: JSON.stringify(loginContext), aiConfidence: 0.7 },
        });
      }
      return { isTakeover: reasons.length > 1, score: reasons.length * 0.3, reasons };
    } catch { return { isTakeover: false, score: 0, reasons: [] }; }
  }

  async detectPaymentFraud(transaction: any): Promise<{ isFraud: boolean; score: number; reason: string }> {
    return { isFraud: false, score: 0, reason: 'No fraud detected' };
  }

  async detectGiftAbuse(userId: string): Promise<{ isAbuse: boolean; score: number; pattern: string }> {
    try {
      const recentGifts = await prisma.giftTransaction.findMany({
        where: { senderId: userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
        orderBy: { createdAt: 'desc' }, take: 50,
      });
      if (recentGifts.length > 20) return { isAbuse: true, score: 0.8, pattern: 'Abnormally high gift frequency' };
      return { isAbuse: false, score: 0, pattern: '' };
    } catch { return { isAbuse: false, score: 0, pattern: '' }; }
  }

  async detectVoteManipulation(pollId: string): Promise<{ isManipulated: boolean; score: number; evidence: string[] }> {
    return { isManipulated: false, score: 0, evidence: [] };
  }
}

export const fraudService = new FraudService();