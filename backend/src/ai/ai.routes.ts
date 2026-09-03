// =============================================================================
// VANTA AI Routes
// All AI feature endpoints mounted under /api/ai
// =============================================================================

import { Router, Request, Response } from 'express';
import { AI_CONFIG } from './ai.config';
import { privacyMiddleware, aiRateLimit, validateConsent, requireAIConsent } from './middleware/privacy.middleware';
import { prisma } from '../prisma';

const aiRouter = Router();

// Apply privacy middleware to all AI routes
aiRouter.use(privacyMiddleware);

// ============================================================================
// RECOMMENDATION ENDPOINTS
// ============================================================================
const recommendationRouter = Router();

recommendationRouter.post('/feed', aiRateLimit('recommendations'), async (req: Request, res: Response) => {
  try {
    const { recommendationService } = await import('./services/recommendation.service');
    const { userId, options } = req.body;
    const feed = await recommendationService.getPersonalizedFeed(userId || req.userId, options);
    res.json({ success: true, data: feed });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

recommendationRouter.post('/discover', aiRateLimit('recommendations'), async (req: Request, res: Response) => {
  try {
    const { recommendationService } = await import('./services/recommendation.service');
    const items = await recommendationService.getDiscoveryItems(req.body.userId || req.userId, req.body.options);
    res.json({ success: true, data: items });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

recommendationRouter.get('/trending', aiRateLimit('recommendations'), async (req: Request, res: Response) => {
  try {
    const { recommendationService } = await import('./services/recommendation.service');
    const category = req.query.category as string;
    const period = (req.query.period as string) || 'day';
    const limit = parseInt(req.query.limit as string) || 20;
    const items = await recommendationService.getTrending(category, period, limit);
    res.json({ success: true, data: items });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

recommendationRouter.get('/hashtags/trending', async (req: Request, res: Response) => {
  try {
    const { recommendationService } = await import('./services/recommendation.service');
    const limit = parseInt(req.query.limit as string) || 20;
    const hashtags = await recommendationService.getTrendingHashtags(limit);
    res.json({ success: true, data: hashtags });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

recommendationRouter.get('/topics', async (req: Request, res: Response) => {
  try {
    const { recommendationService } = await import('./services/recommendation.service');
    const limit = parseInt(req.query.limit as string) || 10;
    const topics = await recommendationService.getTrendingTopics(limit);
    res.json({ success: true, data: topics });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

recommendationRouter.post('/interaction', async (req: Request, res: Response) => {
  try {
    const { recommendationService } = await import('./services/recommendation.service');
    const { eventType, targetType, targetId, metadata } = req.body;
    await recommendationService.recordUserInteraction(req.body.userId || req.userId, eventType, targetType, targetId, metadata);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

recommendationRouter.post('/similar', async (req: Request, res: Response) => {
  try {
    const { recommendationService } = await import('./services/recommendation.service');
    const { contentId, contentType, limit } = req.body;
    const items = await recommendationService.getSimilarContent(contentId, contentType, limit);
    res.json({ success: true, data: items });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/recommendations', recommendationRouter);

// ============================================================================
// MODERATION ENDPOINTS
// ============================================================================
const moderationRouter = Router();

moderationRouter.post('/check', aiRateLimit('moderation'), async (req: Request, res: Response) => {
  try {
    const { moderationService } = await import('./services/moderation.service');
    const { content, context } = req.body;
    const result = await moderationService.checkContent(content, context);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

moderationRouter.post('/batch', aiRateLimit('moderation'), async (req: Request, res: Response) => {
  try {
    const { moderationService } = await import('./services/moderation.service');
    const results = await moderationService.batchCheck(req.body.contents);
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

moderationRouter.post('/report', async (req: Request, res: Response) => {
  try {
    const { moderationService } = await import('./services/moderation.service');
    const { reporterId, targetId, type, reason, description } = req.body;
    const report = await moderationService.submitReport(reporterId, targetId, type, reason, description);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

moderationRouter.get('/queue', async (req: Request, res: Response) => {
  try {
    const { moderationService } = await import('./services/moderation.service');
    const filters = {
      status: req.query.status as string,
      targetType: req.query.targetType as string,
      minScore: req.query.minScore ? parseFloat(req.query.minScore as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };
    const queue = await moderationService.getModerationQueue(filters);
    res.json({ success: true, data: queue });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

moderationRouter.post('/review', async (req: Request, res: Response) => {
  try {
    const { moderationService } = await import('./services/moderation.service');
    const { queueId, moderatorId, action, reason } = req.body;
    const result = await moderationService.reviewContent(queueId, moderatorId, action, reason);
    res.json({ success: true, data: { reviewed: result } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

moderationRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const { moderationService } = await import('./services/moderation.service');
    const stats = await moderationService.getStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/moderation', moderationRouter);

// ============================================================================
// NLP ENDPOINTS
// ============================================================================
const nlpRouter = Router();

nlpRouter.post('/caption', aiRateLimit('nlp'), async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const result = await nlpService.generateCaption(req.body.context, req.body.contentType);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/hashtags', aiRateLimit('nlp'), async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const hashtags = await nlpService.generateHashtags(req.body.content, req.body.limit);
    res.json({ success: true, data: hashtags });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/summarize', aiRateLimit('nlp'), async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const summary = await nlpService.summarizeText(req.body.text, req.body.maxLength);
    res.json({ success: true, data: { summary } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/keywords', aiRateLimit('nlp'), async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const keywords = await nlpService.extractKeywords(req.body.text, req.body.limit);
    res.json({ success: true, data: { keywords } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/sentiment', aiRateLimit('nlp'), async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const sentiment = await nlpService.analyzeSentiment(req.body.text);
    res.json({ success: true, data: sentiment });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/translate', aiRateLimit('nlp'), async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const result = await nlpService.translateText(req.body.text, req.body.sourceLang, req.body.targetLang);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/detect-language', aiRateLimit('nlp'), async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const language = await nlpService.detectLanguage(req.body.text);
    res.json({ success: true, data: { language } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/spelling', aiRateLimit('nlp'), async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const result = await nlpService.checkSpelling(req.body.text);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/rewrite', aiRateLimit('nlp'), async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const rewritten = await nlpService.rewriteMessage(req.body.message, req.body.tone);
    res.json({ success: true, data: { rewritten } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/smart-replies', async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const replies = await nlpService.generateSuggestedReplies(req.body.context, req.body.count);
    res.json({ success: true, data: { replies } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/content-ideas', async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const ideas = await nlpService.suggestContentIdeas(req.body.creatorId, req.body.niche);
    res.json({ success: true, data: { ideas } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.post('/polls', async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const polls = await nlpService.generatePollIdeas(req.body.topic, req.body.count);
    res.json({ success: true, data: { polls } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

nlpRouter.get('/languages', async (req: Request, res: Response) => {
  try {
    const { nlpService } = await import('./services/nlp.service');
    const languages = nlpService.getLanguageNames();
    res.json({ success: true, data: languages });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/nlp', nlpRouter);

// ============================================================================
// ANALYTICS ENDPOINTS
// ============================================================================
const analyticsRouter = Router();

analyticsRouter.post('/insights', aiRateLimit('analytics'), async (req: Request, res: Response) => {
  try {
    const { analyticsService } = await import('./services/analytics.service');
    const { userId, periodStart, periodEnd } = req.body;
    const insights = await analyticsService.getCreatorInsights(userId, periodStart ? { start: new Date(periodStart), end: new Date(periodEnd || periodStart) } : undefined);
    res.json({ success: true, data: insights });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

analyticsRouter.post('/engagement', aiRateLimit('analytics'), async (req: Request, res: Response) => {
  try {
    const { analyticsService } = await import('./services/analytics.service');
    const trends = await analyticsService.getEngagementTrends(req.body.channelId, req.body.period);
    res.json({ success: true, data: trends });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

analyticsRouter.post('/audience', aiRateLimit('analytics'), async (req: Request, res: Response) => {
  try {
    const { analyticsService } = await import('./services/analytics.service');
    const insights = await analyticsService.getAudienceInsights(req.body.userId);
    res.json({ success: true, data: insights });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

analyticsRouter.post('/optimal-times', aiRateLimit('analytics'), async (req: Request, res: Response) => {
  try {
    const { analyticsService } = await import('./services/analytics.service');
    const times = await analyticsService.getOptimalPostingTimes(req.body.userId);
    res.json({ success: true, data: times });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

analyticsRouter.post('/revenue-forecast', aiRateLimit('analytics'), async (req: Request, res: Response) => {
  try {
    const { analyticsService } = await import('./services/analytics.service');
    const forecast = await analyticsService.getRevenueForecasts(req.body.userId, req.body.period);
    res.json({ success: true, data: forecast });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

analyticsRouter.post('/content-performance', aiRateLimit('analytics'), async (req: Request, res: Response) => {
  try {
    const { analyticsService } = await import('./services/analytics.service');
    const summary = await analyticsService.getContentPerformanceSummary(req.body.userId, req.body.period);
    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

analyticsRouter.get('/notifications', async (req: Request, res: Response) => {
  try {
    const { analyticsService } = await import('./services/analytics.service');
    const notifications = await analyticsService.generateSmartNotifications(req.query.userId as string || req.userId);
    res.json({ success: true, data: notifications });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/analytics', analyticsRouter);

// ============================================================================
// TRANSLATION ENDPOINTS
// ============================================================================
const translationRouter = Router();

translationRouter.post('/translate', aiRateLimit('translation'), async (req: Request, res: Response) => {
  try {
    const { translationService } = await import('./services/translation.service');
    const { contentId, contentType, targetLang } = req.body;
    const result = await translationService.translateContent(contentId, contentType, targetLang);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

translationRouter.post('/live', aiRateLimit('translation'), async (req: Request, res: Response) => {
  try {
    const { translationService } = await import('./services/translation.service');
    const result = await translationService.translateLiveMessage(req.body.message, req.body.sourceLang, req.body.targetLang);
    res.json({ success: true, data: { translated: result } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

translationRouter.post('/batch', aiRateLimit('translation'), async (req: Request, res: Response) => {
  try {
    const { translationService } = await import('./services/translation.service');
    const results = await translationService.batchTranslate(req.body.items);
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

translationRouter.get('/languages', async (req: Request, res: Response) => {
  try {
    const { translationService } = await import('./services/translation.service');
    const languages = translationService.getSupportedLanguages();
    res.json({ success: true, data: languages });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

translationRouter.post('/post', async (req: Request, res: Response) => {
  try {
    const { translationService } = await import('./services/translation.service');
    const result = await translationService.translatePost(req.body.postId, req.body.targetLang);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

translationRouter.post('/comment', async (req: Request, res: Response) => {
  try {
    const { translationService } = await import('./services/translation.service');
    const result = await translationService.translateComment(req.body.commentId, req.body.targetLang);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

translationRouter.post('/video', async (req: Request, res: Response) => {
  try {
    const { translationService } = await import('./services/translation.service');
    const result = await translationService.translateVideoContent(req.body.videoId, req.body.targetLang);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

translationRouter.post('/stream', async (req: Request, res: Response) => {
  try {
    const { translationService } = await import('./services/translation.service');
    const result = await translationService.translateStreamContent(req.body.streamId, req.body.targetLang);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/translation', translationRouter);

// ============================================================================
// VIDEO AI ENDPOINTS
// ============================================================================
const videoRouter = Router();

videoRouter.post('/captions', async (req: Request, res: Response) => {
  try {
    const { videoService } = await import('./services/video.service');
    const result = await videoService.generateCaptions(req.body.videoId, req.body.language);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

videoRouter.post('/chapters', async (req: Request, res: Response) => {
  try {
    const { videoService } = await import('./services/video.service');
    const chapters = await videoService.generateChapterMarkers(req.body.videoId);
    res.json({ success: true, data: chapters });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

videoRouter.post('/summary', async (req: Request, res: Response) => {
  try {
    const { videoService } = await import('./services/video.service');
    const summary = await videoService.generateVideoSummary(req.body.videoId);
    res.json({ success: true, data: { summary } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

videoRouter.post('/keywords', async (req: Request, res: Response) => {
  try {
    const { videoService } = await import('./services/video.service');
    const keywords = await videoService.extractVideoKeywords(req.body.videoId);
    res.json({ success: true, data: { keywords } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

videoRouter.post('/thumbnails', async (req: Request, res: Response) => {
  try {
    const { videoService } = await import('./services/video.service');
    const suggestions = await videoService.generateThumbnailSuggestions(req.body.videoId);
    res.json({ success: true, data: { suggestions } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/video', videoRouter);

// ============================================================================
// LIVE STREAMING AI ENDPOINTS
// ============================================================================
const liveRouter = Router();

liveRouter.post('/subtitles', async (req: Request, res: Response) => {
  try {
    const { liveService } = await import('./services/live.service');
    const result = await liveService.generateLiveSubtitles(req.body.streamId, req.body.language);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

liveRouter.post('/translate-chat', async (req: Request, res: Response) => {
  try {
    const { liveService } = await import('./services/live.service');
    const translated = await liveService.translateLiveChat(req.body.message, req.body.targetLang);
    res.json({ success: true, data: { translated } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

liveRouter.post('/summary', async (req: Request, res: Response) => {
  try {
    const { liveService } = await import('./services/live.service');
    const summary = await liveService.generateStreamSummary(req.body.streamId);
    res.json({ success: true, data: { summary } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

liveRouter.post('/highlights', async (req: Request, res: Response) => {
  try {
    const { liveService } = await import('./services/live.service');
    const highlights = await liveService.detectHighlights(req.body.streamId);
    res.json({ success: true, data: { highlights } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

liveRouter.post('/sentiment', async (req: Request, res: Response) => {
  try {
    const { liveService } = await import('./services/live.service');
    const sentiment = await liveService.analyzeAudienceSentiment(req.body.streamId);
    res.json({ success: true, data: sentiment });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

liveRouter.post('/faqs', async (req: Request, res: Response) => {
  try {
    const { liveService } = await import('./services/live.service');
    const faqs = await liveService.extractFAQs(req.body.streamId);
    res.json({ success: true, data: { faqs } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

liveRouter.post('/quality', async (req: Request, res: Response) => {
  try {
    const { liveService } = await import('./services/live.service');
    const quality = await liveService.monitorStreamQuality(req.body.streamId);
    res.json({ success: true, data: quality });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/live', liveRouter);

// ============================================================================
// COMMUNITY AI ENDPOINTS
// ============================================================================
const communityRouter = Router();

communityRouter.post('/duplicate-check', async (req: Request, res: Response) => {
  try {
    const { communityService } = await import('./services/community.service');
    const result = await communityService.detectDuplicateContent(req.body.communityId, req.body.content);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

communityRouter.post('/toxicity', async (req: Request, res: Response) => {
  try {
    const { communityService } = await import('./services/community.service');
    const result = await communityService.detectToxicity(req.body.communityId, req.body.content);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

communityRouter.post('/welcome', async (req: Request, res: Response) => {
  try {
    const { communityService } = await import('./services/community.service');
    const message = await communityService.generateWelcomeMessage(req.body.communityId, req.body.newMemberId);
    res.json({ success: true, data: { message } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

communityRouter.post('/suggest-moderators', async (req: Request, res: Response) => {
  try {
    const { communityService } = await import('./services/community.service');
    const moderators = await communityService.suggestModerators(req.body.communityId);
    res.json({ success: true, data: { moderators } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/community', communityRouter);

// ============================================================================
// ACCESSIBILITY AI ENDPOINTS
// ============================================================================
const accessibilityRouter = Router();

accessibilityRouter.post('/image-description', async (req: Request, res: Response) => {
  try {
    const { accessibilityService } = await import('./services/accessibility.service');
    const description = await accessibilityService.generateImageDescription(req.body.imageUrl);
    res.json({ success: true, data: { description } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

accessibilityRouter.post('/simplify-language', async (req: Request, res: Response) => {
  try {
    const { accessibilityService } = await import('./services/accessibility.service');
    const simplified = await accessibilityService.simplifyLanguage(req.body.text, req.body.targetLevel);
    res.json({ success: true, data: { simplified } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/accessibility', accessibilityRouter);

// ============================================================================
// FRAUD DETECTION ENDPOINTS
// ============================================================================
const fraudRouter = Router();

fraudRouter.post('/detect-fake-account', aiRateLimit('fraud'), async (req: Request, res: Response) => {
  try {
    const { fraudService } = await import('./services/fraud.service');
    const result = await fraudService.detectFakeAccount(req.body.userId, req.body.signupData);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

fraudRouter.post('/detect-fake-followers', aiRateLimit('fraud'), async (req: Request, res: Response) => {
  try {
    const { fraudService } = await import('./services/fraud.service');
    const result = await fraudService.detectFakeFollowers(req.body.creatorId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

fraudRouter.post('/detect-takeover', aiRateLimit('fraud'), async (req: Request, res: Response) => {
  try {
    const { fraudService } = await import('./services/fraud.service');
    const result = await fraudService.detectAccountTakeover(req.body.userId, req.body.loginContext);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

fraudRouter.post('/detect-gift-abuse', aiRateLimit('fraud'), async (req: Request, res: Response) => {
  try {
    const { fraudService } = await import('./services/fraud.service');
    const result = await fraudService.detectGiftAbuse(req.body.userId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/fraud', fraudRouter);

// ============================================================================
// SEARCH AI ENDPOINTS
// ============================================================================
const searchRouter = Router();

searchRouter.post('/semantic', async (req: Request, res: Response) => {
  try {
    const { aiClient } = await import('./ai.client');
    const result = await aiClient.semanticSearch(req.body.query, req.body.filters, req.body.limit);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

searchRouter.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const { recommendationService } = await import('./services/recommendation.service');
    const query = req.query.q as string || '';
    const hashtags = await recommendationService.getTrendingHashtags(5);
    const suggestions = [
      ...hashtags.filter(h => h.toLowerCase().includes(query.toLowerCase())),
      `${query} videos`,
      `${query} creators`,
      `${query} communities`,
      `${query} live streams`,
    ].slice(0, 5);
    res.json({ success: true, data: suggestions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/search', searchRouter);

// ============================================================================
// ADMIN AI CONTROLS
// ============================================================================
const adminRouter = Router();

// Enable/disable AI modules
adminRouter.post('/modules/:module/toggle', async (req: Request, res: Response) => {
  try {
    const { module } = req.params;
    const { enabled } = req.body;

    const featureKey = `${module}_enabled`;
    await prisma.aIFeatureFlag.upsert({
      where: { featureKey },
      update: { enabled },
      create: { featureKey, featureName: `${module} AI`, enabled },
    });

    // Update in-memory config
    const moduleConfig = (AI_CONFIG.features as any)[module];
    if (moduleConfig) {
      moduleConfig.enabled = enabled;
    }

    res.json({ success: true, data: { module, enabled } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update moderation thresholds
adminRouter.post('/moderation/thresholds', async (req: Request, res: Response) => {
  try {
    const { autoModerateThreshold, escalationThreshold } = req.body;
    await prisma.aIFeatureFlag.upsert({
      where: { featureKey: 'moderation_thresholds' },
      update: { config: JSON.stringify({ autoModerateThreshold, escalationThreshold }) },
      create: { featureKey: 'moderation_thresholds', featureName: 'Moderation Thresholds', config: JSON.stringify({ autoModerateThreshold, escalationThreshold }) },
    });
    res.json({ success: true, data: { autoModerateThreshold, escalationThreshold } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all feature flags
adminRouter.get('/modules', async (req: Request, res: Response) => {
  try {
    const flags = await prisma.aIFeatureFlag.findMany();
    res.json({ success: true, data: flags });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Review flagged content
adminRouter.get('/flagged-content', async (req: Request, res: Response) => {
  try {
    const { moderationService } = await import('./services/moderation.service');
    const queue = await moderationService.getModerationQueue({ status: 'PENDING', limit: 50 });
    res.json({ success: true, data: queue });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get fraud alerts
adminRouter.get('/fraud-alerts', async (req: Request, res: Response) => {
  try {
    const { moderationService } = await import('./services/moderation.service');
    const alerts = await moderationService.getFraudAlerts({
      severity: req.query.severity as string,
      reviewed: req.query.reviewed === 'true',
    });
    res.json({ success: true, data: alerts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Resolve fraud alert
adminRouter.post('/fraud-alerts/:alertId/resolve', async (req: Request, res: Response) => {
  try {
    const { moderationService } = await import('./services/moderation.service');
    const result = await moderationService.resolveFraudAlert(req.params.alertId, req.body.resolvedBy);
    res.json({ success: true, data: { resolved: result } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// AI performance metrics
adminRouter.get('/performance', async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'operational',
      modules: Object.entries(AI_CONFIG.features).map(([key, config]) => ({
        name: key,
        enabled: (config as any).enabled !== false,
      })),
      modelVersions: AI_CONFIG.models,
      cacheTTLs: AI_CONFIG.cache,
      timestamp: new Date().toISOString(),
    },
  });
});

aiRouter.use('/admin', adminRouter);

// ============================================================================
// PRIVACY CONTROLS
// ============================================================================
const privacyRouter = Router();

privacyRouter.post('/opt-out', async (req: Request, res: Response) => {
  try {
    const { userId, optOut } = req.body;
    const featureKey = `opt_out:${userId || req.userId}`;
    await prisma.aIFeatureFlag.upsert({
      where: { featureKey },
      update: { enabled: !optOut, userOverride: true },
      create: { featureKey, featureName: `AI Opt-Out: ${userId || req.userId}`, enabled: !optOut, userOverride: true },
    });
    res.json({ success: true, data: { optedOut: optOut } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

privacyRouter.post('/consent', async (req: Request, res: Response) => {
  try {
    const { userId, consentType, granted } = req.body;
    await prisma.consentRecord.create({
      data: {
        userId: userId || req.userId,
        type: `ai_${consentType}`,
        granted,
      },
    });
    res.json({ success: true, data: { consentType, granted } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

privacyRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string || req.userId;
    const [optOutFlag, consentRecords] = await Promise.all([
      prisma.aIFeatureFlag.findUnique({ where: { featureKey: `opt_out:${userId}` } }),
      prisma.consentRecord.findMany({ where: { userId } }),
    ]);
    res.json({
      success: true,
      data: {
        optedOut: optOutFlag ? !optOutFlag.enabled : false,
        consents: consentRecords.map(r => ({ type: r.type, granted: r.granted, createdAt: r.createdAt })),
        features: Object.entries(AI_CONFIG.features).map(([key, config]) => ({
          name: key,
          enabled: (config as any).enabled !== false,
        })),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

aiRouter.use('/privacy', privacyRouter);

// ============================================================================
// AI HEALTH
// ============================================================================
aiRouter.get('/health', async (req: Request, res: Response) => {
  const { aiClient } = await import('./ai.client');
  const health = await aiClient.healthCheck();
  res.json({
    success: true,
    data: {
      service: health.success ? 'connected' : 'disconnected',
      features: Object.keys(AI_CONFIG.features).length,
      models: AI_CONFIG.models,
      timestamp: new Date().toISOString(),
    },
  });
});

export { aiRouter };