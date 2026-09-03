// =============================================================================
// VANTA AI Moderation Service
// Orchestrates content moderation, fraud detection, and reporting
// =============================================================================

import { aiClient } from '../ai.client';
import { AI_CONFIG } from '../ai.config';
import { cacheService } from '../../services/cache.service';
import { prisma } from '../../prisma';
import { metricsCollector } from '../../services/monitoring.service';

export interface ModerationContext {
  userId?: string;
  targetType: string;
  targetId?: string;
  mediaUrl?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ModerationResult {
  safe: boolean;
  score: number;
  categories: string[];
  summary: string;
  needsReview: boolean;
  queueId?: string;
}

export interface QueueFilters {
  status?: string;
  targetType?: string;
  minScore?: number;
  maxScore?: number;
  limit?: number;
  offset?: number;
  escalated?: boolean;
}

export interface FraudDetectionContext {
  ipAddress?: string;
  deviceFingerprint?: string;
  userAgent?: string;
  actionType: string;
  metadata?: any;
}

// Cache recent moderation results to reduce AI calls
const RECENT_CHECK_CACHE_TTL = 300000; // 5 minutes
const AUTO_MODERATE_THRESHOLD = 0.85;
const ESCALATION_THRESHOLD = 0.6;
const HIGH_PRIORITY_SCORE = 0.9;

class ModerationService {
  /**
   * Check content via AI moderation
   */
  async checkContent(content: string, context: ModerationContext): Promise<ModerationResult> {
    const cacheKey = `mod:${Buffer.from(content).toString('base64').slice(0, 64)}`;

    try {
      // Check cache for recent moderation of same content
      const cached = await cacheService.get<ModerationResult>(cacheKey);
      if (cached) return cached;

      // Call AI moderation service
      const aiResponse = await aiClient.checkModeration({
        content,
        context: {
          userId: context.userId,
          targetType: context.targetType,
          targetId: context.targetId,
          mediaUrl: context.mediaUrl,
        },
      });

      let result: ModerationResult;

      if (aiResponse.success && aiResponse.data) {
        result = {
          safe: aiResponse.data.safe !== false,
          score: aiResponse.data.score || 0,
          categories: aiResponse.data.categories || [],
          summary: aiResponse.data.summary || '',
          needsReview: (aiResponse.data.score || 0) >= ESCALATION_THRESHOLD,
        };

        // Create moderation queue entry for flagged content
        if (!result.safe || result.score >= ESCALATION_THRESHOLD) {
          const queueEntry = await prisma.moderationQueue.create({
            data: {
              targetType: context.targetType,
              targetId: context.targetId || '',
              reportedBy: context.userId,
              reason: result.summary,
              aiScore: result.score,
              aiCategories: JSON.stringify(result.categories),
              aiSummary: result.summary,
              priority: result.score >= HIGH_PRIORITY_SCORE ? 1 : 0,
              status: result.score >= AUTO_MODERATE_THRESHOLD && AI_CONFIG.features.moderation.autoModerate
                ? 'FLAGGED'
                : 'PENDING',
            },
          });

          result.queueId = queueEntry.id;

          // Auto-moderate if threshold exceeded and enabled
          if (result.score >= AUTO_MODERATE_THRESHOLD && AI_CONFIG.features.moderation.autoModerate) {
            await this.handleAutoModeration(queueEntry.id);
          }
        }
      } else {
        // Safe fallback when AI is unavailable
        result = {
          safe: true,
          score: 0,
          categories: [],
          summary: 'Moderation service unavailable - content passed by default',
          needsReview: false,
        };
      }

      // Cache result
      await cacheService.set(cacheKey, result, RECENT_CHECK_CACHE_TTL);

      // Track metrics
      metricsCollector.record('moderation_check', 1, {
        targetType: context.targetType,
        safe: result.safe,
        score: result.score,
      });

      return result;
    } catch (error) {
      console.error('[ModerationService] checkContent error:', error);
      return {
        safe: true,
        score: 0,
        categories: [],
        summary: 'Moderation check failed - content passed by default',
        needsReview: false,
      };
    }
  }

  /**
   * Batch check multiple content items
   */
  async batchCheck(
    contents: Array<{ content: string; context: ModerationContext }>
  ): Promise<ModerationResult[]> {
    try {
      const aiResponse = await aiClient.batchModeration({
        items: contents.map(c => ({
          content: c.content,
          context: {
            userId: c.context.userId,
            targetType: c.context.targetType,
            targetId: c.context.targetId,
            mediaUrl: c.context.mediaUrl,
          },
        })),
      });

      if (aiResponse.success && aiResponse.data?.results) {
        return aiResponse.data.results.map((r: any) => ({
          safe: r.safe !== false,
          score: r.score || 0,
          categories: r.categories || [],
          summary: r.summary || '',
          needsReview: (r.score || 0) >= ESCALATION_THRESHOLD,
        }));
      }

      // Fallback: check each individually
      const results: ModerationResult[] = [];
      for (const item of contents) {
        const result = await this.checkContent(item.content, item.context);
        results.push(result);
      }
      return results;
    } catch (error) {
      console.error('[ModerationService] batchCheck error:', error);
      return contents.map(() => ({
        safe: true,
        score: 0,
        categories: [],
        summary: 'Batch moderation failed - all passed by default',
        needsReview: false,
      }));
    }
  }

  /**
   * Get moderation queue with filters
   */
  async getModerationQueue(filters: QueueFilters = {}): Promise<{
    items: any[];
    total: number;
    stats: { pending: number; flagged: number; resolved: number };
  }> {
    try {
      const where: any = {};

      if (filters.status) where.status = filters.status;
      if (filters.targetType) where.targetType = filters.targetType;
      if (filters.escalated !== undefined) where.escalated = filters.escalated;
      if (filters.minScore !== undefined) where.aiScore = { gte: filters.minScore };
      if (filters.maxScore !== undefined) {
        where.aiScore = { ...where.aiScore, lte: filters.maxScore };
      }

      const [items, total, stats] = await Promise.all([
        prisma.moderationQueue.findMany({
          where,
          orderBy: [
            { priority: 'desc' },
            { aiScore: 'desc' },
            { createdAt: 'asc' },
          ],
          take: filters.limit || 50,
          skip: filters.offset || 0,
          include: {
            actions: {
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
        }),
        prisma.moderationQueue.count({ where }),
        this.getStats(),
      ]);

      return { items, total, stats };
    } catch (error) {
      console.error('[ModerationService] getModerationQueue error:', error);
      return { items: [], total: 0, stats: { pending: 0, flagged: 0, resolved: 0 } };
    }
  }

  /**
   * Review flagged content (human review)
   */
  async reviewContent(
    queueId: string,
    moderatorId: string,
    action: string,
    reason?: string
  ): Promise<boolean> {
    try {
      const queueEntry = await prisma.moderationQueue.findUnique({
        where: { id: queueId },
      });

      if (!queueEntry) {
        throw new Error('Moderation queue entry not found');
      }

      // Update queue entry
      await prisma.moderationQueue.update({
        where: { id: queueId },
        data: {
          status: action === 'APPROVE' ? 'APPROVED'
            : action === 'REJECT' ? 'REJECTED'
            : action === 'FLAG' ? 'FLAGGED'
            : action === 'BAN' ? 'FLAGGED'
            : action === 'DELETE' ? 'FLAGGED'
            : 'PENDING',
          reviewedBy: moderatorId,
          reviewedAt: new Date(),
          humanReview: true,
        },
      });

      // Log moderation action
      await prisma.moderationAction.create({
        data: {
          queueId,
          moderatorId,
          action,
          reason,
          automated: false,
        },
      });

      // Take action based on review
      if (action === 'BAN' || action === 'DELETE') {
        await this.executeModerationAction(queueEntry.targetType, queueEntry.targetId, action);
      }

      // Track metrics
      metricsCollector.record('moderation_review', 1, {
        action,
        targetType: queueEntry.targetType,
      });

      return true;
    } catch (error) {
      console.error('[ModerationService] reviewContent error:', error);
      return false;
    }
  }

  /**
   * Submit a content report
   */
  async submitReport(
    reporterId: string,
    targetId: string,
    type: string,
    reason: string,
    description?: string
  ): Promise<any> {
    try {
      // Create report in database
      const report = await prisma.report.create({
        data: {
          reporterId,
          targetId,
          type,
          reason,
          description,
          status: 'PENDING',
        },
      });

      // If the target is content, also run AI moderation
      if (type !== 'USER') {
        const content = await this.getReportableContent(type, targetId);
        if (content) {
          await this.checkContent(content, {
            userId: reporterId,
            targetType: type,
            targetId,
          });
        }
      }

      // Track metrics
      metricsCollector.record('report_submitted', 1, { type });

      return report;
    } catch (error) {
      console.error('[ModerationService] submitReport error:', error);
      throw error;
    }
  }

  /**
   * Detect fraud from user activity
   */
  async detectFraud(userId: string, activity: FraudDetectionContext): Promise<{
    isFraud: boolean;
    score: number;
    alertType?: string;
  }> {
    try {
      const aiResponse = await aiClient.checkModeration({
        type: 'fraud',
        userId,
        activity: {
          ipAddress: activity.ipAddress,
          deviceFingerprint: activity.deviceFingerprint,
          userAgent: activity.userAgent,
          actionType: activity.actionType,
          metadata: activity.metadata,
        },
      });

      if (aiResponse.success && aiResponse.data) {
        const fraudScore = aiResponse.data.score || 0;

        if (fraudScore > 0.5) {
          // Create fraud alert
          await prisma.fraudAlert.create({
            data: {
              userId,
              alertType: aiResponse.data.alertType || 'SUSPICIOUS_ACTIVITY',
              severity: fraudScore > 0.8 ? 'HIGH' : fraudScore > 0.6 ? 'MEDIUM' : 'LOW',
              description: aiResponse.data.summary || 'Suspicious activity detected',
              evidence: JSON.stringify(activity),
              aiConfidence: fraudScore,
            },
          });
        }

        return {
          isFraud: fraudScore > 0.7,
          score: fraudScore,
          alertType: aiResponse.data.alertType,
        };
      }

      return { isFraud: false, score: 0 };
    } catch (error) {
      console.error('[ModerationService] detectFraud error:', error);
      return { isFraud: false, score: 0 };
    }
  }

  /**
   * Auto-moderate a queue entry based on score thresholds
   */
  private async handleAutoModeration(queueId: string): Promise<void> {
    try {
      const entry = await prisma.moderationQueue.findUnique({
        where: { id: queueId },
      });

      if (!entry || entry.status !== 'PENDING') return;

      const action = entry.aiScore >= AUTO_MODERATE_THRESHOLD ? 'FLAG' : 'PENDING';

      await prisma.moderationQueue.update({
        where: { id: queueId },
        data: {
          status: action === 'FLAG' ? 'FLAGGED' : 'PENDING',
        },
      });

      await prisma.moderationAction.create({
        data: {
          queueId,
          moderatorId: 'AI_SYSTEM',
          action,
          reason: `Auto-moderated: AI confidence score ${(entry.aiScore * 100).toFixed(1)}%`,
          automated: true,
        },
      });

      // Execute action
      if (action === 'FLAG') {
        await this.executeModerationAction(entry.targetType, entry.targetId, 'FLAG');
      }
    } catch (error) {
      console.error('[ModerationService] handleAutoModeration error:', error);
    }
  }

  /**
   * Execute moderation action on content
   */
  private async executeModerationAction(
    targetType: string,
    targetId: string,
    action: string
  ): Promise<void> {
    try {
      switch (targetType) {
        case 'POST':
          if (action === 'DELETE') {
            await prisma.post.update({
              where: { id: targetId },
              data: { content: '[Content removed by moderation]' },
            }).catch(() => {});
          }
          break;
        case 'VIDEO':
          // Mark video as private/hidden
          break;
        case 'STREAM':
          if (action === 'BAN' || action === 'DELETE') {
            await prisma.liveStream.update({
              where: { id: targetId },
              data: { active: false },
            }).catch(() => {});
          }
          break;
        case 'MESSAGE':
          // Messages can be deleted
          break;
      }
    } catch (error) {
      console.error('[ModerationService] executeModerationAction error:', error);
    }
  }

  /**
   * Get moderation statistics
   */
  async getStats(): Promise<{ pending: number; flagged: number; resolved: number }> {
    try {
      const [pending, flagged, resolved] = await Promise.all([
        prisma.moderationQueue.count({ where: { status: 'PENDING' } }),
        prisma.moderationQueue.count({ where: { status: 'FLAGGED' } }),
        prisma.moderationQueue.count({
          where: { status: { in: ['APPROVED', 'REJECTED'] } },
        }),
      ]);

      return { pending, flagged, resolved };
    } catch {
      return { pending: 0, flagged: 0, resolved: 0 };
    }
  }

  /**
   * Get reportable content for moderation context
   */
  private async getReportableContent(type: string, targetId: string): Promise<string | null> {
    try {
      switch (type) {
        case 'POST': {
          const post = await prisma.post.findUnique({ where: { id: targetId } });
          return post?.content || null;
        }
        case 'VIDEO': {
          const video = await prisma.video.findUnique({ where: { id: targetId } });
          return video?.description || video?.title || null;
        }
        case 'COMMENT': {
          const comment = await prisma.videoComment.findUnique({ where: { id: targetId } });
          return comment?.content || null;
        }
        case 'MESSAGE': {
          const message = await prisma.message.findUnique({ where: { id: targetId } });
          return message?.content || null;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Get fraud alerts
   */
  async getFraudAlerts(filters: {
    severity?: string;
    reviewed?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: any[]; total: number }> {
    try {
      const where: any = {};
      if (filters.severity) where.severity = filters.severity;
      if (filters.reviewed !== undefined) where.reviewed = filters.reviewed;

      const [items, total] = await Promise.all([
        prisma.fraudAlert.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: filters.limit || 50,
          skip: filters.offset || 0,
          include: {
            user: {
              select: { id: true, username: true, avatar: true, email: true },
            },
          },
        }),
        prisma.fraudAlert.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      console.error('[ModerationService] getFraudAlerts error:', error);
      return { items: [], total: 0 };
    }
  }

  /**
   * Resolve a fraud alert
   */
  async resolveFraudAlert(alertId: string, resolvedBy: string): Promise<boolean> {
    try {
      await prisma.fraudAlert.update({
        where: { id: alertId },
        data: {
          reviewed: true,
          reviewedBy: resolvedBy,
          resolvedAt: new Date(),
        },
      });
      return true;
    } catch (error) {
      console.error('[ModerationService] resolveFraudAlert error:', error);
      return false;
    }
  }
}

export const moderationService = new ModerationService();