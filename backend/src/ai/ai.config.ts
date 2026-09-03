// =============================================================================
// VANTA AI Configuration
// =============================================================================

export const AI_CONFIG = {
  // AI Microservice endpoints
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:5003',
  
  // Feature flags - centralized AI module control
  features: {
    recommendations: {
      enabled: true,
      personalizedFeed: true,
      discovery: true,
      trending: true,
      similarContent: true,
      userInteractions: true,
    },
    moderation: {
      enabled: true,
      contentCheck: true,
      batchCheck: true,
      toxicityDetection: true,
      spamDetection: true,
      fraudDetection: true,
      autoModerate: process.env.AI_AUTO_MODERATE === 'true',
    },
    nlp: {
      enabled: true,
      captionGeneration: true,
      hashtagSuggestion: true,
      summarization: true,
      keywordExtraction: true,
      sentimentAnalysis: true,
      spellingCorrection: true,
    },
    translation: {
      enabled: true,
      contentTranslation: true,
      liveTranslation: true,
      realtimeChat: true,
    },
    video: {
      enabled: true,
      captions: true,
      chapterMarkers: true,
      videoSummaries: true,
      thumbnailSuggestions: true,
    },
    live: {
      enabled: true,
      subtitles: true,
      streamSummaries: true,
      highlightDetection: true,
      sentimentAnalysis: true,
      qualityMonitoring: true,
    },
    analytics: {
      enabled: true,
      creatorInsights: true,
      audienceAnalysis: true,
      revenueForecasts: true,
      engagementTrends: true,
      optimalTimes: true,
    },
    community: {
      enabled: true,
      toxicityDetection: true,
      duplicateDetection: true,
      welcomeMessages: true,
      moderatorSuggestions: true,
    },
    accessibility: {
      enabled: true,
      imageDescriptions: true,
      textToSpeech: true,
      languageSimplification: true,
    },
    fraud: {
      enabled: true,
      fakeAccounts: true,
      fakeFollowers: true,
      botDetection: true,
      paymentFraud: true,
      accountTakeover: true,
      giftAbuse: true,
    },
    notifications: {
      enabled: true,
      smartNotifications: true,
      personalizedAlerts: true,
    },
    search: {
      enabled: true,
      semanticSearch: true,
      autoComplete: true,
      spellingCorrection: true,
      relatedSearches: true,
    },
  },

  // Circuit breaker configuration
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 30000,
    halfOpenMaxRequests: 3,
    monitoredEndpoints: [
      '/api/v1/recommendations/feed',
      '/api/v1/moderation/check',
      '/api/v1/nlp/caption',
      '/api/v1/embeddings/search',
      '/api/v1/analytics/insights',
    ],
  },

  // Retry configuration
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    timeout: 15000,
  },

  // Rate limiting for AI endpoints
  rateLimit: {
    windowMs: 60000,
    maxRequests: {
      recommendations: 30,
      moderation: 60,
      nlp: 40,
      translation: 50,
      analytics: 20,
      embeddings: 100,
      search: 60,
      fraud: 30,
    },
  },

  // Cache TTLs (in milliseconds)
  cache: {
    userEmbedding: 3600000,      // 1 hour
    contentEmbedding: 86400000,  // 24 hours
    recommendation: 300000,      // 5 minutes
    translation: 86400000,       // 24 hours
    analytics: 3600000,          // 1 hour
    moderation: 300000,          // 5 minutes
    search: 60000,               // 1 minute
    trending: 120000,            // 2 minutes
  },

  // Privacy settings
  privacy: {
    anonymizeData: true,
    logAIInteractions: true,
    consentRequired: ['training', 'profiling', 'analytics'],
    defaultOptOut: false,
    dataRetentionDays: 90,
  },

  // Performance
  performance: {
    maxConcurrentRequests: 10,
    requestQueueSize: 100,
    batchSize: 50,
    asyncProcessing: true,
  },

  // Model versions
  models: {
    embedding: 'sentence-transformers/all-MiniLM-L6-v2',
    moderation: 'vanta-moderation-v1',
    translation: 'vanta-translation-v1',
    recommendation: 'vanta-recommendation-v1',
    nlp: 'vanta-nlp-v1',
    analytics: 'vanta-analytics-v1',
    fraud: 'vanta-fraud-v1',
  },
} as const;

export type AIConfig = typeof AI_CONFIG;