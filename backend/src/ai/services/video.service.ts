// =============================================================================
// VANTA AI Video Service - Captions, chapters, summaries, keywords
// =============================================================================

import { aiClient } from '../ai.client';
import { AI_CONFIG } from '../ai.config';
import { cacheService } from '../../services/cache.service';
import { prisma } from '../../prisma';

class VideoService {
  async generateCaptions(videoId: string, language: string = 'en'): Promise<{ captions: string; language: string }> {
    try {
      const video = await prisma.video.findUnique({ where: { id: videoId } });
      if (!video) throw new Error('Video not found');

      const cacheKey = `captions:${videoId}:${language}`;
      const cached = await cacheService.get<{ captions: string; language: string }>(cacheKey);
      if (cached) return cached;

      const aiResponse = await aiClient.generateCaption({
        context: { title: video.title, description: video.description || '' },
        contentType: 'captions',
      });

      if (aiResponse.success && aiResponse.data?.captions) {
        const result = { captions: aiResponse.data.captions[0] || '', language };
        await cacheService.set(cacheKey, result, AI_CONFIG.cache.recommendation);
        return result;
      }

      return { captions: `[Captions for: ${video.title}]`, language };
    } catch (error) {
      console.error('[VideoService] generateCaptions error:', error);
      return { captions: '', language };
    }
  }

  async generateChapterMarkers(videoId: string): Promise<Array<{ title: string; timestamp: number }>> {
    try {
      const video = await prisma.video.findUnique({ where: { id: videoId } });
      if (!video) throw new Error('Video not found');

      const cacheKey = `chapters:${videoId}`;
      const cached = await cacheService.get<Array<{ title: string; timestamp: number }>>(cacheKey);
      if (cached) return cached;

      const aiResponse = await aiClient.generateCaption({
        context: { title: video.title, description: video.description || '' },
        contentType: 'chapters',
      });

      if (aiResponse.success && aiResponse.data?.chapters) {
        await cacheService.set(cacheKey, aiResponse.data.chapters, AI_CONFIG.cache.recommendation);
        return aiResponse.data.chapters;
      }

      return [{ title: 'Introduction', timestamp: 0 }, { title: 'Main Content', timestamp: 30 }];
    } catch {
      return [{ title: 'Full Video', timestamp: 0 }];
    }
  }

  async generateVideoSummary(videoId: string): Promise<string> {
    try {
      const video = await prisma.video.findUnique({ where: { id: videoId } });
      if (!video) return '';

      const cacheKey = `summary:${videoId}`;
      const cached = await cacheService.get<string>(cacheKey);
      if (cached) return cached;

      const text = `${video.title}. ${video.description || ''}`;
      const aiResponse = await aiClient.summarizeText({ text, maxLength: 100 });

      const summary = aiResponse.success && aiResponse.data?.summary
        ? aiResponse.data.summary
        : `${video.title}`;

      await cacheService.set(cacheKey, summary, AI_CONFIG.cache.recommendation);
      return summary;
    } catch { return ''; }
  }

  async extractVideoKeywords(videoId: string): Promise<string[]> {
    try {
      const video = await prisma.video.findUnique({ where: { id: videoId } });
      if (!video) return [];

      const cacheKey = `keywords:${videoId}`;
      const cached = await cacheService.get<string[]>(cacheKey);
      if (cached) return cached;

      const text = `${video.title} ${video.description || ''}`;
      const aiResponse = await aiClient.extractKeywords({ text, limit: 10 });

      const keywords = aiResponse.success && aiResponse.data?.keywords
        ? aiResponse.data.keywords
        : video.title.split(' ').filter(w => w.length > 3);

      await cacheService.set(cacheKey, keywords, AI_CONFIG.cache.recommendation);
      return keywords;
    } catch { return []; }
  }

  async generateThumbnailSuggestions(videoId: string): Promise<string[]> {
    return ['Eye-catching moment', 'Best reaction shot', 'Key visual highlight', 'Text overlay with title'];
  }

  async generateAccessibilityCaptions(videoId: string): Promise<{ captions: string; language: string }> {
    return this.generateCaptions(videoId, 'en');
  }
}

export const videoService = new VideoService();