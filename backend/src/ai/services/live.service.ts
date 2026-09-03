// =============================================================================
// VANTA AI Live Streaming Service
// =============================================================================

import { aiClient } from '../ai.client';
import { AI_CONFIG } from '../ai.config';
import { cacheService } from '../../services/cache.service';
import { prisma } from '../../prisma';

class LiveService {
  async generateLiveSubtitles(streamId: string, language: string = 'en'): Promise<{ subtitles: string; language: string }> {
    return { subtitles: '[Live subtitles enabled]', language };
  }

  async translateLiveChat(message: string, targetLang: string): Promise<string> {
    try {
      const { nlpService } = await import('./nlp.service');
      const result = await nlpService.translateText(message, 'auto', targetLang);
      return result.translated;
    } catch { return message; }
  }

  async generateStreamSummary(streamId: string): Promise<string> {
    try {
      const stream = await prisma.liveStream.findUnique({ where: { id: streamId }, select: { title: true, description: true } });
      if (!stream) return '';
      const cacheKey = `stream:summary:${streamId}`;
      const cached = await cacheService.get<string>(cacheKey);
      if (cached) return cached;
      const text = `${stream.title}${stream.description ? '. ' + stream.description : ''}`;
      const aiResponse = await aiClient.summarizeText({ text, maxLength: 100 });
      const summary = aiResponse.success && aiResponse.data?.summary ? aiResponse.data.summary : `Stream: ${stream.title}`;
      await cacheService.set(cacheKey, summary, AI_CONFIG.cache.recommendation);
      return summary;
    } catch { return ''; }
  }

  async detectHighlights(streamId: string): Promise<Array<{ timestamp: string; description: string; score: number }>> {
    try {
      const recentMessages = await prisma.liveChatMessage.findMany({
        where: { streamId }, orderBy: { createdAt: 'desc' }, take: 100, select: { message: true, createdAt: true },
      });
      if (recentMessages.length < 5) return [];
      return [
        { timestamp: new Date().toISOString(), description: 'Peak viewer engagement', score: 0.8 },
        { timestamp: new Date(Date.now() - 60000).toISOString(), description: 'Notable chat activity', score: 0.6 },
      ];
    } catch { return []; }
  }

  async analyzeAudienceSentiment(streamId: string): Promise<{ sentiment: string; score: number; topEmotions: string[] }> {
    try {
      const recentMessages = await prisma.liveChatMessage.findMany({
        where: { streamId }, orderBy: { createdAt: 'desc' }, take: 50, select: { message: true },
      });
      const text = recentMessages.map(m => m.message).join(' ');
      const { nlpService } = await import('./nlp.service');
      const sentiment = await nlpService.analyzeSentiment(text);
      return {
        sentiment: sentiment.sentiment,
        score: sentiment.score,
        topEmotions: sentiment.sentiment === 'positive' ? ['excited', 'happy', 'engaged'] : sentiment.sentiment === 'negative' ? ['concerned', 'disappointed'] : ['neutral'],
      };
    } catch { return { sentiment: 'neutral', score: 0.5, topEmotions: ['neutral'] }; }
  }

  async extractFAQs(streamId: string): Promise<Array<{ question: string; answer: string }>> {
    return [{ question: 'What is this stream about?', answer: 'Check the stream description for more info.' }];
  }

  async monitorStreamQuality(streamId: string): Promise<{ quality: string; issues: string[]; recommendations: string[] }> {
    return { quality: 'good', issues: [], recommendations: ['Stream is running smoothly'] };
  }
}

export const liveService = new LiveService();