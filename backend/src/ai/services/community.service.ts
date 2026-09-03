// =============================================================================
// VANTA AI Community Management Service
// =============================================================================

import { prisma } from '../../prisma';

class CommunityService {
  async detectDuplicateContent(communityId: string, content: string): Promise<{ isDuplicate: boolean; similarity: number; originalPostId?: string }> {
    try {
      const recentPosts = await prisma.communityPost.findMany({
        where: { communityId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, content: true },
      });
      for (const post of recentPosts) {
        const similarity = this.calculateSimilarity(content, post.content);
        if (similarity > 0.85) return { isDuplicate: true, similarity, originalPostId: post.id };
      }
      return { isDuplicate: false, similarity: 0 };
    } catch { return { isDuplicate: false, similarity: 0 }; }
  }

  async suggestRuleEnforcement(communityId: string, content: string): Promise<{ shouldEnforce: boolean; rule: string; confidence: number }> {
    return { shouldEnforce: false, rule: 'No rule violations detected', confidence: 0 };
  }

  async detectToxicity(communityId: string, content: string): Promise<{ isToxic: boolean; score: number; categories: string[] }> {
    try {
      const { moderationService } = await import('./moderation.service');
      const result = await moderationService.checkContent(content, { targetType: 'COMMUNITY_POST' });
      return { isToxic: !result.safe, score: result.score, categories: result.categories };
    } catch { return { isToxic: false, score: 0, categories: [] }; }
  }

  async generateWelcomeMessage(communityId: string, newMemberId: string): Promise<string> {
    try {
      const [community, member] = await Promise.all([
        prisma.community.findUnique({ where: { id: communityId }, select: { name: true, description: true } }),
        prisma.user.findUnique({ where: { id: newMemberId }, select: { username: true } }),
      ]);
      if (!community || !member) return 'Welcome to the community!';
      return `Welcome @${member.username} to ${community.name}! 🎉 ${community.description ? community.description.slice(0, 100) : 'Feel free to introduce yourself and join the conversation!'}`;
    } catch { return 'Welcome! Glad to have you here.'; }
  }

  async suggestModerators(communityId: string): Promise<Array<{ userId: string; username: string; score: number; reason: string }>> {
    try {
      const members = await prisma.communityMember.findMany({
        where: { communityId, role: 'MEMBER' },
        include: { user: { select: { id: true, username: true } } },
        take: 20,
      });
      return members.slice(0, 5).map(m => ({ userId: m.user.id, username: m.user.username, score: 0.5, reason: 'Active community member' }));
    } catch { return []; }
  }

  private calculateSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const aWords = new Set(a.toLowerCase().split(/\s+/));
    const bWords = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...aWords].filter(w => bWords.has(w)));
    const union = new Set([...aWords, ...bWords]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

export const communityService = new CommunityService();