// =============================================================================
// VANTA AI Translation Service
// Content translation with database caching
// =============================================================================

import { aiClient } from '../ai.client';
import { AI_CONFIG } from '../ai.config';
import { cacheService } from '../../services/cache.service';
import { prisma } from '../../prisma';
import { nlpService } from './nlp.service';

const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', ru: 'Russian', ja: 'Japanese',
  ko: 'Korean', zh: 'Chinese', ar: 'Arabic', hi: 'Hindi',
  yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo', sw: 'Swahili',
  af: 'Afrikaans', nl: 'Dutch', tr: 'Turkish', vi: 'Vietnamese',
  th: 'Thai', bn: 'Bengali', pa: 'Punjabi',
};

class TranslationService {
  /**
   * Translate content with caching
   */
  async translateContent(contentId: string, contentType: string, targetLang: string): Promise<{ translated: string; sourceLang: string; cached: boolean }> {
    try {
      // Check DB cache first
      const cached = await this.getCachedTranslation(contentId, contentType, targetLang);
      if (cached) {
        return { translated: cached.translatedText, sourceLang: cached.sourceLang, cached: true };
      }

      // Get original content
      const { text, sourceLang } = await this.getOriginalContent(contentId, contentType);
      if (!text) return { translated: '', sourceLang: 'en', cached: false };

      // Translate via AI
      const result = await nlpService.translateText(text, sourceLang || 'en', targetLang);

      // Cache in database
      if (result.translated !== text) {
        await prisma.aITranslation.create({
          data: {
            contentId,
            contentType,
            sourceLang: sourceLang || 'en',
            targetLang,
            originalText: text.slice(0, 500),
            translatedText: result.translated,
            modelVersion: AI_CONFIG.models.translation,
            expiresAt: new Date(Date.now() + AI_CONFIG.cache.translation),
          },
        }).catch(() => {});
      }

      return { translated: result.translated, sourceLang: sourceLang || 'en', cached: false };
    } catch (error) {
      console.error('[TranslationService] translateContent error:', error);
      return { translated: '', sourceLang: 'en', cached: false };
    }
  }

  /**
   * Get cached translation from database
   */
  async getCachedTranslation(contentId: string, contentType: string, targetLang: string): Promise<{ translatedText: string; sourceLang: string } | null> {
    try {
      const cached = await prisma.aITranslation.findFirst({
        where: {
          contentId,
          contentType,
          targetLang,
          OR: [
            { expiresAt: { gt: new Date() } },
            { expiresAt: null },
          ],
        },
      });

      if (cached) {
        return { translatedText: cached.translatedText, sourceLang: cached.sourceLang };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Real-time translation for live messages
   */
  async translateLiveMessage(message: string, sourceLang: string, targetLang: string): Promise<string> {
    try {
      const result = await nlpService.translateText(message, sourceLang, targetLang);
      return result.translated;
    } catch {
      return message;
    }
  }

  /**
   * Translate a post
   */
  async translatePost(postId: string, targetLang: string): Promise<any> {
    try {
      const post = await prisma.post.findUnique({ where: { id: postId }, select: { content: true } });
      if (!post) throw new Error('Post not found');

      const translated = await this.translateContent(postId, 'POST', targetLang);
      return { contentId: postId, contentType: 'POST', ...translated };
    } catch (error) {
      console.error('[TranslationService] translatePost error:', error);
      return { contentId: postId, contentType: 'POST', translated: '', error: 'Translation failed' };
    }
  }

  /**
   * Translate a comment
   */
  async translateComment(commentId: string, targetLang: string): Promise<any> {
    try {
      const comment = await prisma.postComment.findUnique({ where: { id: commentId }, select: { content: true } })
        || await prisma.videoComment.findUnique({ where: { id: commentId }, select: { content: true } });

      if (!comment) throw new Error('Comment not found');

      const translated = await this.translateContent(commentId, 'COMMENT', targetLang);
      return { contentId: commentId, contentType: 'COMMENT', ...translated };
    } catch (error) {
      console.error('[TranslationService] translateComment error:', error);
      return { contentId: commentId, contentType: 'COMMENT', translated: '', error: 'Translation failed' };
    }
  }

  /**
   * Translate video title and description
   */
  async translateVideoContent(videoId: string, targetLang: string): Promise<any> {
    try {
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { title: true, description: true },
      });
      if (!video) throw new Error('Video not found');

      const [title, description] = await Promise.all([
        this.translateContent(`video_title:${videoId}`, 'VIDEO_TITLE', targetLang).catch(() => ({ translated: video.title, sourceLang: 'en', cached: false })),
        video.description
          ? this.translateContent(`video_desc:${videoId}`, 'VIDEO_DESC', targetLang).catch(() => ({ translated: video.description!, sourceLang: 'en', cached: false }))
          : Promise.resolve({ translated: '', sourceLang: 'en', cached: false }),
      ]);

      return { videoId, translatedTitle: title.translated, translatedDescription: description.translated };
    } catch (error) {
      console.error('[TranslationService] translateVideoContent error:', error);
      return { videoId, translatedTitle: '', translatedDescription: '' };
    }
  }

  /**
   * Translate stream title and description
   */
  async translateStreamContent(streamId: string, targetLang: string): Promise<any> {
    try {
      const stream = await prisma.liveStream.findUnique({
        where: { id: streamId },
        select: { title: true, description: true },
      });
      if (!stream) throw new Error('Stream not found');

      const [title, description] = await Promise.all([
        this.translateContent(`stream_title:${streamId}`, 'STREAM_TITLE', targetLang),
        stream.description
          ? this.translateContent(`stream_desc:${streamId}`, 'STREAM_DESC', targetLang)
          : Promise.resolve({ translated: '', sourceLang: 'en', cached: false }),
      ]);

      return { streamId, translatedTitle: title.translated, translatedDescription: description.translated };
    } catch (error) {
      console.error('[TranslationService] translateStreamContent error:', error);
      return { streamId, translatedTitle: '', translatedDescription: '' };
    }
  }

  /**
   * Batch translate texts
   */
  async batchTranslate(items: Array<{ text: string; sourceLang: string; targetLang: string }>): Promise<string[]> {
    try {
      const results = await Promise.all(
        items.map(item => this.translateLiveMessage(item.text, item.sourceLang, item.targetLang))
      );
      return results;
    } catch (error) {
      console.error('[TranslationService] batchTranslate error:', error);
      return items.map(i => i.text);
    }
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): Record<string, string> {
    return { ...SUPPORTED_LANGUAGES };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private async getOriginalContent(contentId: string, contentType: string): Promise<{ text: string; sourceLang: string }> {
    try {
      switch (contentType) {
        case 'POST': {
          const post = await prisma.post.findUnique({ where: { id: contentId }, select: { content: true } });
          return { text: post?.content || '', sourceLang: 'en' };
        }
        case 'COMMENT': {
          const comment = await prisma.postComment.findUnique({ where: { id: contentId }, select: { content: true } })
            || await prisma.videoComment.findUnique({ where: { id: contentId }, select: { content: true } });
          return { text: comment?.content || '', sourceLang: 'en' };
        }
        case 'VIDEO_TITLE':
        case 'VIDEO_DESC': {
          const realId = contentId.replace(/^video_(title|desc):/, '');
          const video = await prisma.video.findUnique({ where: { id: realId } });
          const field = contentType === 'VIDEO_TITLE' ? 'title' : 'description';
          return { text: video?.[field as keyof typeof video] as string || '', sourceLang: 'en' };
        }
        case 'STREAM_TITLE':
        case 'STREAM_DESC': {
          const streamId = contentId.replace(/^stream_(title|desc):/, '');
          const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
          const field = contentType === 'STREAM_TITLE' ? 'title' : 'description';
          return { text: stream?.[field as keyof typeof stream] as string || '', sourceLang: 'en' };
        }
        case 'MESSAGE': {
          const msg = await prisma.message.findUnique({ where: { id: contentId }, select: { content: true } });
          return { text: msg?.content || '', sourceLang: 'en' };
        }
        default:
          return { text: '', sourceLang: 'en' };
      }
    } catch {
      return { text: '', sourceLang: 'en' };
    }
  }
}

export const translationService = new TranslationService();
