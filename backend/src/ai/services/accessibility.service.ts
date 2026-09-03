// =============================================================================
// VANTA AI Accessibility Service
// =============================================================================

import { aiClient } from '../ai.client';
import { AI_CONFIG } from '../ai.config';
import { cacheService } from '../../services/cache.service';

class AccessibilityService {
  async generateImageDescription(imageUrl: string): Promise<string> {
    const cacheKey = `alt:${Buffer.from(imageUrl).toString('base64').slice(0, 48)}`;
    try {
      const cached = await cacheService.get<string>(cacheKey);
      if (cached) return cached;
      const aiResponse = await aiClient.generateCaption({
        context: { description: `Describe this image: ${imageUrl}` },
        contentType: 'image_description',
      });
      const desc = aiResponse.success && aiResponse.data?.description ? aiResponse.data.description : 'Image available';
      await cacheService.set(cacheKey, desc, AI_CONFIG.cache.recommendation);
      return desc;
    } catch { return 'Image available'; }
  }

  async generateImageAltText(imageUrl: string): Promise<string> {
    return this.generateImageDescription(imageUrl);
  }

  async voiceToText(audioBuffer: any): Promise<string> {
    console.warn('[AccessibilityService] voiceToText requires audio processing service');
    return '[Transcription not available]';
  }

  async textToSpeech(text: string): Promise<Buffer | null> {
    console.warn('[AccessibilityService] textToSpeech requires TTS service');
    return null;
  }

  async simplifyLanguage(text: string, targetLevel: string = 'simple'): Promise<string> {
    try {
      const { nlpService } = await import('./nlp.service');
      const result = await nlpService.rewriteMessage(text, 'simple');
      return result;
    } catch { return text; }
  }
}

export const accessibilityService = new AccessibilityService();