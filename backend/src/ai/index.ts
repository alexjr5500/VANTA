// =============================================================================
// VANTA AI Module - Central Exports
// =============================================================================

// Config
export { AI_CONFIG } from './ai.config';

// HTTP Client (bridges to Python AI microservice)
export { aiClient } from './ai.client';
export type { AIResponse, AIRequestOptions } from './ai.client';

// Services
export { recommendationService } from './services/recommendation.service';
export type { FeedOptions, DiscoveryOptions, FeedItem, RecommendationItem } from './services/recommendation.service';

export { moderationService } from './services/moderation.service';
export type { ModerationContext, ModerationResult, QueueFilters, FraudDetectionContext } from './services/moderation.service';

export { nlpService } from './services/nlp.service';
export { analyticsService } from './services/analytics.service';
export { translationService } from './services/translation.service';
export { videoService } from './services/video.service';
export { liveService } from './services/live.service';
export { communityService } from './services/community.service';
export { accessibilityService } from './services/accessibility.service';
export { fraudService } from './services/fraud.service';

// Routes
export { aiRouter } from './ai.routes';

// Socket Handlers
export { registerAISocketHandlers } from './ai.sockets';

// Middleware
export {
  privacyMiddleware,
  injectAIHeaders,
  requireAIConsent,
  validateConsent,
  anonymizeForAI,
  aiRateLimit,
} from './middleware/privacy.middleware';