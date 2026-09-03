// =============================================================================
// VANTA AI Privacy Middleware
// AI usage indicators, opt-out, consent validation, data anonymization
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { AI_CONFIG } from '../ai.config';
import { prisma } from '../../prisma';

// Active AI features being used in current request
const AI_FEATURES_HEADER = 'X-AI-Enabled';

/**
 * Inject AI usage indicator headers into all responses
 */
export function injectAIHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader(AI_FEATURES_HEADER, 'true');
  res.setHeader('X-AI-Privacy', 'transparent');
  res.setHeader('X-AI-Opt-Out', '/api/ai/privacy/opt-out');
  next();
}

/**
 * Check if user has opted out of AI features
 */
export async function requireAIConsent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      next();
      return;
    }

    // Check AIFeatureFlag for user override
    const featureFlag = await prisma.aIFeatureFlag.findFirst({
      where: {
        OR: [
          { featureKey: `opt_out:${userId}` },
          { featureKey: 'global_ai_disabled' },
        ],
      },
    });

    if (featureFlag && !featureFlag.enabled) {
      res.status(403).json({
        error: 'AI features disabled',
        message: 'You have opted out of AI features. Enable them in privacy settings.',
        code: 'AI_OPTED_OUT',
      });
      return;
    }

    next();
  } catch {
    next();
  }
}

/**
 * Validate user consent for specific AI processing types
 */
export function validateConsent(consentType: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).userId;
      if (!userId || !AI_CONFIG.privacy.consentRequired.includes(consentType)) {
        next();
        return;
      }

      const consent = await prisma.consentRecord.findFirst({
        where: {
          userId,
          type: `ai_${consentType}`,
          granted: true,
        },
      });

      if (!consent) {
        res.status(403).json({
          error: 'Consent required',
          message: `This action requires consent for ${consentType}. Update your privacy settings.`,
          code: 'CONSENT_REQUIRED',
          consentType,
        });
        return;
      }

      next();
    } catch {
      next();
    }
  };
}

/**
 * Anonymize personal data before sending to AI services
 */
export function anonymizeForAI(data: any): any {
  if (!data || typeof data !== 'object') return data;

  const anonymized = Array.isArray(data) ? [...data] : { ...data };
  const sensitiveFields = ['email', 'phone', 'phoneNumber', 'passwordHash', 'ipAddress', 'deviceFingerprint', 'fullName'];

  for (const key of Object.keys(anonymized)) {
    if (sensitiveFields.includes(key)) {
      anonymized[key] = undefined;
    } else if (typeof anonymized[key] === 'object' && anonymized[key] !== null) {
      anonymized[key] = anonymizeForAI(anonymized[key]);
    }
  }

  return anonymized;
}

/**
 * Rate limiting for AI endpoints
 */
const aiRequestCounts: Map<string, { count: number; resetAt: number }> = new Map();

export function aiRateLimit(feature: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = (req as any).userId || req.ip || 'anonymous';
    const key = `${feature}:${userId}`;
    const maxRequests = (AI_CONFIG.rateLimit.maxRequests as any)[feature] || 30;
    const now = Date.now();

    let record = aiRequestCounts.get(key);
    if (!record || record.resetAt < now) {
      record = { count: 0, resetAt: now + AI_CONFIG.rateLimit.windowMs };
      aiRequestCounts.set(key, record);
    }

    record.count++;
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > maxRequests) {
      res.status(429).json({
        error: 'Too many AI requests',
        message: `Rate limit exceeded for ${feature}. Try again in ${Math.ceil((record.resetAt - now) / 1000)} seconds.`,
        code: 'AI_RATE_LIMITED',
      });
      return;
    }

    next();
  };
}

/**
 * Log AI interactions for audit
 */
export async function logAIInteraction(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (AI_CONFIG.privacy.logAIInteractions) {
    const userId = (req as any).userId;
    const feature = req.path.split('/').pop() || 'unknown';

    console.log(`[AI Audit] User: ${userId || 'anonymous'} | Feature: ${feature} | Path: ${req.path} | Time: ${new Date().toISOString()}`);
  }
  next();
}

/**
 * Combined privacy middleware
 */
export const privacyMiddleware = [
  injectAIHeaders,
  requireAIConsent,
  logAIInteraction,
];