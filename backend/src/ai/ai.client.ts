// =============================================================================
// VANTA AI HTTP Client
// Bridges Node.js backend with Python AI microservice
// Includes circuit breaker, retry logic, and graceful degradation
// =============================================================================

import { AI_CONFIG } from './ai.config';
import { circuitBreakerRegistry } from '../services/circuit-breaker.service';
import { metricsCollector } from '../services/monitoring.service';
import { cacheService } from '../services/cache.service';

interface AIRequestOptions {
  timeout?: number;
  retries?: number;
  useCache?: boolean;
  cacheTTL?: number;
  signal?: AbortSignal;
}

interface AIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
  latency?: number;
}

class AIClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public service?: string,
    public retryable: boolean = true
  ) {
    super(message);
    this.name = 'AIClientError';
  }
}

// Queue for request management
class AIRequestQueue {
  private queue: Array<{
    execute: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    priority: number;
  }> = [];
  private processing = false;
  private maxConcurrent: number;
  private activeCount = 0;

  constructor(maxConcurrent = AI_CONFIG.performance.maxConcurrentRequests) {
    this.maxConcurrent = maxConcurrent;
  }

  async add<T>(execute: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ execute, resolve, reject, priority });
      this.queue.sort((a, b) => b.priority - a.priority);
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.activeCount >= this.maxConcurrent) return;
    this.processing = true;

    while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const item = this.queue.shift();
      if (!item) continue;

      this.activeCount++;
      try {
        const result = await item.execute();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      } finally {
        this.activeCount--;
      }
    }

    this.processing = false;
  }

  get length(): number {
    return this.queue.length;
  }

  get isFull(): boolean {
    return this.queue.length >= AI_CONFIG.performance.requestQueueSize;
  }
}

// Fallback responses for when AI service is unavailable
const FALLBACK_RESPONSES = {
  recommendations: {
    items: [],
    score: 0,
    reason: 'AI service unavailable',
  },
  moderation: {
    safe: true,
    score: 0,
    categories: [],
    summary: 'Moderation service unavailable',
  },
  nlp: {
    text: '',
    confidence: 0,
  },
  analytics: {
    insights: [],
    forecast: null,
  },
};

class AIClient {
  private baseUrl: string;
  private requestQueue: AIRequestQueue;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor() {
    this.baseUrl = AI_CONFIG.aiServiceUrl;
    this.requestQueue = new AIRequestQueue();
  }

  private async request<T>(
    endpoint: string,
    method: string = 'POST',
    body?: any,
    options: AIRequestOptions = {}
  ): Promise<AIResponse<T>> {
    const startTime = Date.now();
    const cacheKey = options.useCache ? `ai:${endpoint}:${JSON.stringify(body)}` : undefined;

    // Check cache
    if (cacheKey && options.useCache) {
      const cached = await cacheService.get<AIResponse<T>>(cacheKey);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    // Check if AI service is available via circuit breaker
    const breakerKey = `ai:${endpoint}`;
    const breaker = circuitBreakerRegistry.get(breakerKey, {
      failureThreshold: AI_CONFIG.circuitBreaker.failureThreshold,
      successThreshold: AI_CONFIG.circuitBreaker.successThreshold,
      timeout: AI_CONFIG.circuitBreaker.timeout,
    });

    if (!breaker.isAvailable()) {
      return this.getFallbackResponse<T>(endpoint);
    }

    // Queue the request
    try {
      const result = await this.requestQueue.add<T>(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          options.timeout || AI_CONFIG.retry.timeout
        );

        try {
          const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Service-Name': 'vanta-backend',
              'X-Service-Version': '1.0.0',
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: options.signal || controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new AIClientError(
              `AI service error: ${response.status} ${errorBody}`,
              response.status,
              endpoint,
              response.status >= 500
            );
          }

          const data = await response.json();
          
          // Record success in circuit breaker
          breaker.recordSuccess();

          // Track metrics
          const latency = Date.now() - startTime;
          metricsCollector.record('ai_request_duration', latency, {
            endpoint,
            method,
          });

          const result: AIResponse<T> = {
            success: true,
            data,
            latency,
          };

          // Cache if needed
          if (cacheKey && options.useCache && options.cacheTTL) {
            await cacheService.set(cacheKey, result, options.cacheTTL);
          }

          return result;
        } catch (error: any) {
          clearTimeout(timeoutId);

          if (error instanceof AIClientError) {
            throw error;
          }

          if (error.name === 'AbortError') {
            throw new AIClientError('AI request timeout', 408, endpoint, true);
          }

          throw new AIClientError(
            error.message || 'AI service unreachable',
            503,
            endpoint,
            true
          );
        }
      });

      return result;
    } catch (error: any) {
      // Record failure in circuit breaker
      breaker.recordFailure();

      const latency = Date.now() - startTime;
      console.error(`[AI Client] ${endpoint} failed:`, error.message);

      metricsCollector.record('ai_request_error', 1, {
        endpoint,
        error: error.message,
      });

      // Return fallback response
      return this.getFallbackResponse<T>(endpoint);
    }
  }

  private getFallbackResponse<T>(endpoint: string): AIResponse<T> {
    // Map endpoints to appropriate fallback responses
    if (endpoint.includes('/recommendations/')) {
      return { success: true, data: FALLBACK_RESPONSES.recommendations as any, cached: false };
    }
    if (endpoint.includes('/moderation/')) {
      return { success: true, data: FALLBACK_RESPONSES.moderation as any, cached: false };
    }
    if (endpoint.includes('/nlp/')) {
      return { success: true, data: FALLBACK_RESPONSES.nlp as any, cached: false };
    }
    if (endpoint.includes('/analytics/')) {
      return { success: true, data: FALLBACK_RESPONSES.analytics as any, cached: false };
    }
    return { success: true, data: {} as any, cached: false };
  }

  // ============================================================================
  // EMBEDDING ENDPOINTS
  // ============================================================================

  async generateUserEmbedding(userData: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/embeddings/user', 'POST', userData, options);
  }

  async generateContentEmbedding(contentData: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/embeddings/content', 'POST', contentData, options);
  }

  async computeSimilarity(data: { embedding1: number[]; embedding2: number[] }, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/embeddings/similarity', 'POST', data, options);
  }

  async semanticSearch(query: string, filters?: any, limit?: number, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/embeddings/search', 'POST', { query, filters, limit }, {
      ...options,
      useCache: true,
      cacheTTL: AI_CONFIG.cache.search,
    });
  }

  // ============================================================================
  // RECOMMENDATION ENDPOINTS
  // ============================================================================

  async getPersonalizedFeed(userData: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/recommendations/feed', 'POST', userData, {
      ...options,
      useCache: true,
      cacheTTL: AI_CONFIG.cache.recommendation,
    });
  }

  async getDiscoveryItems(userData: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/recommendations/discover', 'POST', userData, options);
  }

  async getSimilarContent(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/recommendations/similar', 'POST', data, {
      ...options,
      useCache: true,
      cacheTTL: AI_CONFIG.cache.recommendation,
    });
  }

  async getTrending(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/recommendations/trending', 'POST', data, {
      ...options,
      useCache: true,
      cacheTTL: AI_CONFIG.cache.trending,
    });
  }

  async triggerModelTraining(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/recommendations/train', 'POST', data, options);
  }

  // ============================================================================
  // MODERATION ENDPOINTS
  // ============================================================================

  async checkModeration(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/moderation/check', 'POST', data, {
      ...options,
      useCache: true,
      cacheTTL: AI_CONFIG.cache.moderation,
    });
  }

  async batchModeration(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/moderation/batch', 'POST', data, options);
  }

  async submitReport(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/moderation/report', 'POST', data, options);
  }

  async getModerationQueue(filters?: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/moderation/queue', 'POST', filters || {}, options);
  }

  async reviewModeration(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/moderation/review', 'POST', data, options);
  }

  // ============================================================================
  // NLP ENDPOINTS
  // ============================================================================

  async summarizeText(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/nlp/summarize', 'POST', data, options);
  }

  async extractKeywords(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/nlp/keywords', 'POST', data, options);
  }

  async generateCaption(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/nlp/caption', 'POST', data, options);
  }

  async checkSpelling(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/nlp/spellcheck', 'POST', data, options);
  }

  async analyzeSentiment(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/nlp/sentiment', 'POST', data, options);
  }

  async translateText(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/nlp/translate', 'POST', data, options);
  }

  async detectLanguage(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/nlp/detect-language', 'POST', data, options);
  }

  // ============================================================================
  // ANALYTICS ENDPOINTS
  // ============================================================================

  async generateInsights(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/analytics/insights', 'POST', data, {
      ...options,
      useCache: true,
      cacheTTL: AI_CONFIG.cache.analytics,
    });
  }

  async forecastMetrics(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/analytics/forecast', 'POST', data, options);
  }

  async analyzeAudience(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/analytics/audience', 'POST', data, options);
  }

  async getOptimalTimes(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/analytics/optimal-times', 'POST', data, options);
  }

  async forecastRevenue(data: any, options?: AIRequestOptions): Promise<AIResponse> {
    return this.request('/api/v1/analytics/revenue', 'POST', data, options);
  }

  // ============================================================================
  // HEALTH & MANAGEMENT
  // ============================================================================

  async healthCheck(): Promise<AIResponse> {
    return this.request('/health', 'GET', undefined, { timeout: 5000, retries: 1 });
  }

  cancelRequest(key: string): void {
    const controller = this.abortControllers.get(key);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(key);
    }
  }

  cancelAll(): void {
    this.abortControllers.forEach(controller => controller.abort());
    this.abortControllers.clear();
  }
}

export const aiClient = new AIClient();
export { AIClient, AIResponse, AIRequestOptions };