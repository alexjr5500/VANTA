// =============================================================================
// VANTA AI Socket.io Handlers
// Real-time AI features: chat assistance, live streaming, moderation
// =============================================================================

import { Server, Socket } from 'socket.io';

export function registerAISocketHandlers(io: Server): void {
  const aiNsp = io.of('/ai');

  aiNsp.on('connection', (socket: Socket) => {
    const userId = socket.data.userId;
    if (!userId) {
      socket.disconnect();
      return;
    }

    console.log(`[AI Socket] User ${userId} connected`);

    // ===========================================================================
    // Chat Assistance
    // ===========================================================================

    // Translate a message in real-time
    socket.on('ai:translate', async (data: { message: string; sourceLang: string; targetLang: string }) => {
      try {
        const { nlpService } = await import('./services/nlp.service');
        const result = await nlpService.translateText(data.message, data.sourceLang || 'auto', data.targetLang);
        socket.emit('ai:translated', { original: data.message, translated: result.translated, sourceLang: result.sourceLang });
      } catch (error: any) {
        socket.emit('ai:error', { error: 'Translation failed', message: error.message });
      }
    });

    // Rewrite a message
    socket.on('ai:rewrite', async (data: { message: string; tone: string }) => {
      try {
        const { nlpService } = await import('./services/nlp.service');
        const rewritten = await nlpService.rewriteMessage(data.message, data.tone);
        socket.emit('ai:rewritten', { original: data.message, rewritten, tone: data.tone });
      } catch (error: any) {
        socket.emit('ai:error', { error: 'Rewrite failed', message: error.message });
      }
    });

    // Get smart replies
    socket.on('ai:smart-reply', async (data: { context: string; count?: number }) => {
      try {
        const { nlpService } = await import('./services/nlp.service');
        const replies = await nlpService.generateSuggestedReplies(data.context, data.count || 3);
        socket.emit('ai:smart-replies', { replies, context: data.context });
      } catch (error: any) {
        socket.emit('ai:error', { error: 'Smart replies failed', message: error.message });
      }
    });

    // Correct grammar
    socket.on('ai:grammar', async (data: { text: string }) => {
      try {
        const { nlpService } = await import('./services/nlp.service');
        const corrected = await nlpService.correctGrammar(data.text);
        socket.emit('ai:grammar-corrected', { original: data.text, corrected });
      } catch (error: any) {
        socket.emit('ai:error', { error: 'Grammar check failed', message: error.message });
      }
    });

    // ===========================================================================
    // Live Stream AI Events
    // ===========================================================================

    // Generate live subtitles
    socket.on('ai:subtitles', async (data: { streamId: string; language?: string }) => {
      try {
        const { liveService } = await import('./services/live.service');
        const result = await liveService.generateLiveSubtitles(data.streamId, data.language || 'en');
        socket.emit('ai:subtitles-generated', result);
      } catch (error: any) {
        socket.emit('ai:error', { error: 'Subtitles generation failed', message: error.message });
      }
    });

    // Analyze audience sentiment in real-time
    socket.on('ai:sentiment', async (data: { streamId: string }) => {
      try {
        const { liveService } = await import('./services/live.service');
        const sentiment = await liveService.analyzeAudienceSentiment(data.streamId);
        socket.emit('ai:sentiment-result', sentiment);
      } catch (error: any) {
        socket.emit('ai:error', { error: 'Sentiment analysis failed', message: error.message });
      }
    });

    // Detect stream highlights
    socket.on('ai:highlights', async (data: { streamId: string }) => {
      try {
        const { liveService } = await import('./services/live.service');
        const highlights = await liveService.detectHighlights(data.streamId);
        socket.emit('ai:highlights-result', { highlights, streamId: data.streamId });
      } catch (error: any) {
        socket.emit('ai:error', { error: 'Highlight detection failed', message: error.message });
      }
    });

    // ===========================================================================
    // Real-time Moderation
    // ===========================================================================

    // Check message content in real-time before sending
    socket.on('ai:check-message', async (data: { message: string; targetType?: string }) => {
      try {
        const { moderationService } = await import('./services/moderation.service');
        const result = await moderationService.checkContent(data.message, {
          targetType: data.targetType || 'MESSAGE',
          userId,
        });
        socket.emit('ai:message-checked', {
          safe: result.safe,
          score: result.score,
          categories: result.categories,
          warning: !result.safe ? 'This message may violate community guidelines.' : undefined,
        });
      } catch (error: any) {
        socket.emit('ai:error', { error: 'Moderation check failed', message: error.message });
      }
    });

    // ===========================================================================
    // Search Suggestions
    // ===========================================================================

    // Get search suggestions as user types
    socket.on('ai:search-suggestions', async (data: { query: string }) => {
      try {
        const { recommendationService } = await import('./services/recommendation.service');
        const hashtags = await recommendationService.getTrendingHashtags(5);
        const suggestions = [
          ...hashtags.filter(h => h.toLowerCase().includes(data.query.toLowerCase())),
          `${data.query} videos`,
          `${data.query} creators`,
          `${data.query} communities`,
        ].slice(0, 5);
        socket.emit('ai:search-suggestions-result', { query: data.query, suggestions });
      } catch {
        socket.emit('ai:search-suggestions-result', { query: data.query, suggestions: [] });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[AI Socket] User ${userId} disconnected`);
    });
  });
}