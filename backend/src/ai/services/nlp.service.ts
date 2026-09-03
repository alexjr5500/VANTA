// =============================================================================
// VANTA AI NLP Service
// Natural Language Processing: captions, hashtags, summarization, translation,
// sentiment analysis, spell checking, keyword extraction
// =============================================================================

import { aiClient } from '../ai.client';
import { AI_CONFIG } from '../ai.config';
import { cacheService } from '../../services/cache.service';
import { prisma } from '../../prisma';
import { metricsCollector } from '../../services/monitoring.service';

const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', ru: 'Russian', ja: 'Japanese',
  ko: 'Korean', zh: 'Chinese', ar: 'Arabic', hi: 'Hindi',
  bn: 'Bengali', pa: 'Punjabi', yo: 'Yoruba', ha: 'Hausa',
  ig: 'Igbo', sw: 'Swahili', af: 'Afrikaans', nl: 'Dutch',
  tr: 'Turkish', vi: 'Vietnamese', th: 'Thai',
};

const TEXT_MAX_LENGTH = 50000;

class NLPService {
  /**
   * Generate captions/titles for content
   */
  async generateCaption(
    context: { title?: string; description?: string; keywords?: string[]; audience?: string; tone?: string },
    contentType: string
  ): Promise<{ captions: string[]; selected?: string }> {
    try {
      const aiResponse = await aiClient.generateCaption({
        context,
        contentType,
      });

      if (aiResponse.success && aiResponse.data?.captions) {
        return aiResponse.data;
      }

      // Fallback: smart basic caption generation
      return this.getFallbackCaptions(context, contentType);
    } catch (error) {
      console.error('[NLPService] generateCaption error:', error);
      return this.getFallbackCaptions(context, contentType);
    }
  }

  /**
   * Generate hashtag suggestions
   */
  async generateHashtags(content: string, limit: number = 10): Promise<string[]> {
    if (!content || content.length === 0) return [];

    try {
      const aiResponse = await aiClient.extractKeywords({
        text: content.slice(0, TEXT_MAX_LENGTH),
        type: 'hashtags',
        limit,
      });

      if (aiResponse.success && aiResponse.data?.keywords) {
        return this.normalizeHashtags(aiResponse.data.keywords, limit);
      }

      // Fallback: extract hashtags from content
      return this.extractHashtags(content, limit);
    } catch (error) {
      console.error('[NLPService] generateHashtags error:', error);
      return this.extractHashtags(content, limit);
    }
  }

  /**
   * Suggest content ideas for creators
   */
  async suggestContentIdeas(creatorId: string, niche?: string): Promise<Array<{ title: string; description: string; contentType: string }>> {
    try {
      const aiResponse = await aiClient.generateCaption({
        context: { audience: niche, keywords: [niche || 'general'] },
        contentType: 'content_ideas',
      });

      if (aiResponse.success && aiResponse.data?.ideas) {
        return aiResponse.data.ideas;
      }

      return this.getFallbackContentIdeas(niche);
    } catch (error) {
      console.error('[NLPService] suggestContentIdeas error:', error);
      return this.getFallbackContentIdeas(niche);
    }
  }

  /**
   * Summarize text
   */
  async summarizeText(text: string, maxLength: number = 200): Promise<string> {
    if (!text || text.length < 50) return text;

    try {
      const aiResponse = await aiClient.summarizeText({
        text: text.slice(0, TEXT_MAX_LENGTH),
        maxLength,
      });

      if (aiResponse.success && aiResponse.data?.summary) {
        return aiResponse.data.summary;
      }

      return this.basicSummarize(text, maxLength);
    } catch (error) {
      console.error('[NLPService] summarizeText error:', error);
      return this.basicSummarize(text, maxLength);
    }
  }

  /**
   * Extract keywords from text
   */
  async extractKeywords(text: string, limit: number = 10): Promise<string[]> {
    if (!text) return [];

    try {
      const aiResponse = await aiClient.extractKeywords({
        text: text.slice(0, TEXT_MAX_LENGTH),
        limit,
      });

      if (aiResponse.success && aiResponse.data?.keywords) {
        return aiResponse.data.keywords;
      }

      return this.basicKeywords(text, limit);
    } catch (error) {
      console.error('[NLPService] extractKeywords error:', error);
      return this.basicKeywords(text, limit);
    }
  }

  /**
   * Check spelling with suggestions
   */
  async checkSpelling(text: string): Promise<{ corrections: Array<{ original: string; suggestion: string; start: number; end: number }>; corrected: string }> {
    if (!text) return { corrections: [], corrected: '' };

    try {
      const aiResponse = await aiClient.checkSpelling({ text });

      if (aiResponse.success && aiResponse.data) {
        return aiResponse.data;
      }

      return { corrections: [], corrected: text };
    } catch (error) {
      console.error('[NLPService] checkSpelling error:', error);
      return { corrections: [], corrected: text };
    }
  }

  /**
   * Analyze sentiment of text
   */
  async analyzeSentiment(text: string): Promise<{ sentiment: 'positive' | 'negative' | 'neutral'; score: number; breakdown?: any }> {
    if (!text) return { sentiment: 'neutral', score: 0 };

    try {
      const aiResponse = await aiClient.analyzeSentiment({
        text: text.slice(0, TEXT_MAX_LENGTH),
      });

      if (aiResponse.success && aiResponse.data) {
        return {
          sentiment: aiResponse.data.sentiment || 'neutral',
          score: aiResponse.data.score || 0,
          breakdown: aiResponse.data.breakdown,
        };
      }

      return this.basicSentiment(text);
    } catch (error) {
      console.error('[NLPService] analyzeSentiment error:', error);
      return this.basicSentiment(text);
    }
  }

  /**
   * Translate text with caching
   */
  async translateText(text: string, sourceLang: string, targetLang: string): Promise<{ translated: string; sourceLang: string; targetLang: string; cached: boolean }> {
    if (!text || sourceLang === targetLang) {
      return { translated: text, sourceLang, targetLang, cached: false };
    }

    const cacheKey = `trans:${sourceLang}:${targetLang}:${Buffer.from(text).toString('base64').slice(0, 64)}`;

    try {
      // Check memory cache
      const cached = await cacheService.get<{ translated: string }>(cacheKey);
      if (cached) {
        return { ...cached, sourceLang, targetLang, cached: true };
      }

      // Check database cache
      const dbCached = await prisma.aITranslation.findFirst({
        where: {
          originalText: text.slice(0, 500),
          sourceLang,
          targetLang,
          expiresAt: { gt: new Date() },
        },
      });

      if (dbCached) {
        await cacheService.set(cacheKey, { translated: dbCached.translatedText }, AI_CONFIG.cache.translation);
        return { translated: dbCached.translatedText, sourceLang, targetLang, cached: true };
      }

      // Call AI translation
      const aiResponse = await aiClient.translateText({
        text: text.slice(0, TEXT_MAX_LENGTH),
        sourceLang,
        targetLang,
      });

      if (aiResponse.success && aiResponse.data?.translated) {
        const translated = aiResponse.data.translated;

        // Cache in memory
        await cacheService.set(cacheKey, { translated }, AI_CONFIG.cache.translation);

        // Cache in database
        await prisma.aITranslation.create({
          data: {
            contentId: `inline:${cacheKey.slice(0, 32)}`,
            contentType: 'TEXT',
            sourceLang,
            targetLang,
            originalText: text.slice(0, 500),
            translatedText: translated,
            modelVersion: AI_CONFIG.models.translation,
            expiresAt: new Date(Date.now() + AI_CONFIG.cache.translation),
          },
        }).catch(() => {});

        return { translated, sourceLang, targetLang, cached: false };
      }

      return { translated: text, sourceLang, targetLang, cached: false };
    } catch (error) {
      console.error('[NLPService] translateText error:', error);
      return { translated: text, sourceLang, targetLang, cached: false };
    }
  }

  /**
   * Detect language of text
   */
  async detectLanguage(text: string): Promise<string> {
    if (!text) return 'en';

    try {
      const aiResponse = await aiClient.detectLanguage({
        text: text.slice(0, 1000),
      });

      if (aiResponse.success && aiResponse.data?.language) {
        return aiResponse.data.language;
      }

      return 'en';
    } catch (error) {
      console.error('[NLPService] detectLanguage error:', error);
      return 'en';
    }
  }

  /**
   * Generate suggested replies for chat
   */
  async generateSuggestedReplies(context: string, count: number = 3): Promise<string[]> {
    try {
      const aiResponse = await aiClient.generateCaption({
        context: { description: context, keywords: ['reply', 'suggestion'] },
        contentType: 'chat_replies',
      });

      if (aiResponse.success && aiResponse.data?.replies) {
        return aiResponse.data.replies.slice(0, count);
      }

      return this.getDefaultReplies();
    } catch (error) {
      console.error('[NLPService] generateSuggestedReplies error:', error);
      return this.getDefaultReplies();
    }
  }

  /**
   * Rewrite message with specified tone
   */
  async rewriteMessage(message: string, tone: string = 'professional'): Promise<string> {
    try {
      const aiResponse = await aiClient.generateCaption({
        context: { description: message, keywords: ['rewrite'], tone },
        contentType: 'rewrite',
      });

      if (aiResponse.success && aiResponse.data?.rewritten) {
        return aiResponse.data.rewritten;
      }

      return message;
    } catch (error) {
      console.error('[NLPService] rewriteMessage error:', error);
      return message;
    }
  }

  /**
   * Correct grammar
   */
  async correctGrammar(text: string): Promise<string> {
    try {
      const spellResult = await this.checkSpelling(text);
      return spellResult.corrected || text;
    } catch (error) {
      console.error('[NLPService] correctGrammar error:', error);
      return text;
    }
  }

  /**
   * Generate poll ideas for creators
   */
  async generatePollIdeas(topic: string, count: number = 5): Promise<Array<{ question: string; options: string[] }>> {
    const defaultPolls = [
      { question: 'What type of content would you like to see more?', options: ['Tutorials', 'Live streams', 'Behind the scenes', 'Q&A'] },
      { question: 'Which platform do you use most?', options: ['VANTA', 'YouTube', 'TikTok', 'Instagram'] },
      { question: 'What time do you prefer watching content?', options: ['Morning', 'Afternoon', 'Evening', 'Late night'] },
    ];

    try {
      const aiResponse = await aiClient.generateCaption({
        context: { description: topic, keywords: ['poll', 'ideas'] },
        contentType: 'poll_ideas',
      });

      if (aiResponse.success && aiResponse.data?.polls) {
        return aiResponse.data.polls.slice(0, count);
      }

      return defaultPolls.slice(0, count);
    } catch {
      return defaultPolls.slice(0, count);
    }
  }

  /**
   * Get supported language names
   */
  getLanguageNames(): Record<string, string> {
    return { ...SUPPORTED_LANGUAGES };
  }

  // ============================================================================
  // FALLBACK METHODS
  // ============================================================================

  private getFallbackCaptions(context: any, contentType: string): { captions: string[]; selected?: string } {
    const keywords = context.keywords || [];
    const tone = context.tone || 'engaging';
    const prefix = tone === 'professional' ? 'Discover' : tone === 'fun' ? 'Check out' : 'Explore';

    const captions = [
      `${prefix} ${context.title || 'amazing content'} #${keywords[0] || 'vanta'}`,
      `${context.title || 'New content'} is here! 🎉 ${keywords.slice(0, 3).map(k => `#${k}`).join(' ')}`,
      `You won't believe this! ${context.title || 'Incredible'} content awaits ✨`,
    ];

    return { captions, selected: captions[0] };
  }

  private extractHashtags(text: string, limit: number): string[] {
    const matches = text.match(/#[\w]+/g);
    if (!matches) return ['#vanta', '#trending', '#viral'].slice(0, limit);

    const unique = [...new Set(matches.map(t => t.toLowerCase()))];
    return unique.slice(0, limit);
  }

  private normalizeHashtags(tags: string[], limit: number): string[] {
    return tags
      .map(t => t.startsWith('#') ? t : `#${t.toLowerCase().replace(/\s+/g, '')}`)
      .slice(0, limit);
  }

  private getFallbackContentIdeas(niche?: string): Array<{ title: string; description: string; contentType: string }> {
    const baseIdeas = [
      { title: 'Behind the Scenes', description: 'Show your audience what goes into creating your content', contentType: 'VIDEO' },
      { title: 'Tips and Tricks', description: `Share your expertise on ${niche || 'your favorite topics'}`, contentType: 'POST' },
      { title: 'Q&A Session', description: 'Answer your followers\' most burning questions', contentType: 'STREAM' },
      { title: 'Day in the Life', description: 'Take your audience through a typical day', contentType: 'STORY' },
      { title: 'Tutorial', description: `Teach something new about ${niche || 'your niche'}`, contentType: 'VIDEO' },
      { title: 'Collaboration', description: 'Partner with another creator for fresh content', contentType: 'VIDEO' },
      { title: 'Challenge', description: 'Start a fun challenge and invite others to join', contentType: 'SHORT' },
      { title: 'Review', description: `Review products or services related to ${niche || 'your interests'}`, contentType: 'VIDEO' },
    ];
    return baseIdeas;
  }

  private basicSummarize(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).split(' ').slice(0, -1).join(' ') + '...';
  }

  private basicKeywords(text: string, limit: number): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'may', 'might', 'shall', 'should', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them', 'their']);
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
    const freq = new Map<string, number>();
    words.forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word]) => word);
  }

  private basicSentiment(text: string): { sentiment: 'positive' | 'negative' | 'neutral'; score: number } {
    const positiveWords = new Set(['good', 'great', 'amazing', 'excellent', 'wonderful', 'fantastic', 'love', 'beautiful', 'awesome', 'incredible', 'happy', 'best', 'perfect', 'nice', 'super', 'fun', 'enjoy', 'cool', 'amazing']);
    const negativeWords = new Set(['bad', 'terrible', 'awful', 'horrible', 'hate', 'ugly', 'worst', 'poor', 'sucks', 'disgusting', 'angry', 'sad', 'boring', 'annoying', 'stupid', 'dumb', 'hateful', 'toxic', 'dreadful']);

    const words = text.toLowerCase().split(/\s+/);
    let positive = 0, negative = 0;
    words.forEach(w => { if (positiveWords.has(w)) positive++; if (negativeWords.has(w)) negative++; });

    if (positive > negative) return { sentiment: 'positive', score: Math.min(1, positive / words.length * 2) };
    if (negative > positive) return { sentiment: 'negative', score: Math.min(1, negative / words.length * 2) };
    return { sentiment: 'neutral', score: 0.5 };
  }

  private getDefaultReplies(): string[] {
    return [
      'That\'s awesome! Thanks for sharing 🙌',
      'I completely agree with you!',
      'Great point! Tell me more about that.',
      'Haha, that\'s hilarious! 😂',
      'Thanks so much! I really appreciate it.',
    ];
  }
}

export const nlpService = new NLPService();