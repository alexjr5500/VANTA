import 'dotenv/config';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import compression from 'compression';
import { Server } from 'socket.io';
import { prisma } from './prisma';
import { initializeSecurity, config, rateLimiter, botProtection, auditLog } from './security';
import { authenticateSocket, handleConnect, handleDisconnect } from './security';
import authRoutes from './routes/auth.routes';
import profileRoutes from './routes/profile.routes';
import settingsRoutes from './routes/settings.routes';
import walletRoutes from './routes/wallet.routes';
import welcomeRewardRoutes from './routes/welcome-reward.routes';
import messageRoutes from './routes/message.routes';
import notificationRoutes from './routes/notification.routes';
import liveRoutes from './routes/live.routes';
import giftRoutes from './routes/gift.routes';
import adminRoutes from './routes/admin.routes';
import monetizationRoutes from './routes/monetization.routes';
import storyRoutes from './routes/story.routes';
import feedRoutes from './routes/feed.routes';
import searchRoutes from './routes/search.routes';
import uploadRoutes from './routes/upload.routes';
import reelRoutes from './routes/reel.routes';
import communityRoutes from './routes/community.routes';
import channelRoutes from './routes/channel.routes';
import groupRoutes from './routes/group.routes';
import complianceRoutes from './routes/compliance.routes';
import verificationRoutes from './routes/verification.routes';
import creatorRoutes from './routes/creator.routes';
import adRoutes from './routes/ad.routes';
import fundraiserRoutes from './routes/fundraiser.routes';
import { ensureDefaultCategories } from './services/fundraiser.service';
import { aiRouter, registerAISocketHandlers } from './ai';
import { analyticsRouter, registerAnalyticsSocketHandlers, analyticsEngine } from './analytics';
import { handleChatSocket } from './sockets/chat.socket';
import { handleLiveSocket } from './sockets/live.socket';
import { handleGiftSocket } from './sockets/gift.socket';
import { setNotificationIO } from './services/notification.service';
import { setSocialEventsIO } from './services/social-events.service';
import { apiLatencyMiddleware, healthStatus, metricsCollector, cacheService, setupDefaultAlerts } from './services';
import { uploadStorageDir } from './services/upload.service';

const app: Express = express();

// Local HTTPS development (optional). When HTTPS_DEV_CERT and HTTPS_DEV_KEY are
// set the API + Socket.IO are served over TLS (wss://) so an HTTPS frontend page
// (e.g. https://<LAN-IP>:3000 on a phone) is not blocked as mixed content. When
// unset the server keeps its existing plain-HTTP behavior. Socket.IO is attached
// to whichever server is created, so it automatically upgrades to WSS on HTTPS.
const httpsDevCert = process.env.HTTPS_DEV_CERT;
const httpsDevKey = process.env.HTTPS_DEV_KEY;
const httpServer = httpsDevCert && httpsDevKey
  ? createHttpsServer({ key: fs.readFileSync(httpsDevKey), cert: fs.readFileSync(httpsDevCert) }, app)
  : createHttpServer(app);

// ============================================================================
// ENTERPRISE SECURITY MIDDLEWARE
// ============================================================================

// Security headers with strict CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: config.csp.defaultSrc,
      scriptSrc: config.csp.scriptSrc,
      styleSrc: config.csp.styleSrc,
      imgSrc: config.csp.imgSrc,
      connectSrc: config.csp.connectSrc,
      fontSrc: config.csp.fontSrc,
      frameSrc: config.csp.frameSrc,
      mediaSrc: config.csp.mediaSrc,
      workerSrc: config.csp.workerSrc,
      formAction: ["'self'"],
      baseUri: ["'self'"],
      manifestSrc: ["'self'"],
    },
  },
  hsts: {
    maxAge: config.hsts.maxAge,
    includeSubDomains: config.hsts.includeSubDomains,
    preload: config.hsts.preload,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
  noSniff: true,
  hidePoweredBy: true,
  frameguard: { action: 'deny' },
  ieNoOpen: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
}));

// CORS with strict origin validation
const normalizeOrigin = (origin: string): string => origin.replace(/\/$/, '');
const frontendOrigin = normalizeOrigin(process.env.FRONTEND_URL || 'http://localhost:3000');
const electronOrigin = normalizeOrigin(process.env.ELECTRON_URL || 'app://.');
const allowedOrigins = [...config.cors.allowedOrigins, frontendOrigin, electronOrigin, 'http://127.0.0.1:3000'];

const isAllowedLocalOrigin = (origin: string): boolean => {
  try {
    const normalizedOrigin = normalizeOrigin(origin);
    const url = new URL(normalizedOrigin);
    const hostname = url.hostname.toLowerCase();
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const localHostnames = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
    if (localHostnames.includes(hostname) && port === '3000') return true;
    // Private LAN origins are valid in development so a physical phone can
    // reach the laptop-hosted frontend. Production still uses allowedOrigins.
    if (process.env.NODE_ENV !== 'production' && port === '3000' && (
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    )) return true;
    return false;
  } catch {
    return false;
  }
};

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const normalizedOrigin = origin ? normalizeOrigin(origin) : undefined;
    if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin) || normalizedOrigin.startsWith('app://') || (normalizedOrigin && isAllowedLocalOrigin(normalizedOrigin))) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: config.cors.credentials,
  maxAge: config.cors.maxAge,
}));

// Performance optimization: Response compression
app.use(compression({
  level: 6, // Balanced compression level (1-9)
  threshold: 1024, // Only compress responses > 1KB
  filter: (req: Request, res: Response) => {
    // Don't compress SSE or WebSocket upgrades
    if (req.headers['accept'] === 'text/event-stream') return false;
    if (req.headers['upgrade'] === 'websocket') return false;
    // Use default compression filter
    return compression.filter(req, res);
  },
}));

// Request parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// API Latency tracking (performance monitoring)
app.use(apiLatencyMiddleware);

// Global bot protection middleware (non-blocking, marks requests)
app.use(botProtection.middleware);

// Global rate limiting for API
app.use('/api', rateLimiter.api);

// ============================================================================
// WEBM MEDIA TYPE PROBING
// ============================================================================
// A .webm container can hold audio-only (voice notes from MediaRecorder) or
// audio+video. Browsers (and <audio>/<video> elements) decide the media type
// from the response Content-Type, so serving every .webm as "video/webm"
// prevents audio-only voice notes from playing in an <audio> element on
// stricter engines (notably Safari). We probe the EBML Tracks table for the
// TrackType (1 = video, 2 = audio) and serve the correct type. The probe is
// cached per file (stat-based) so the hot path stays cheap.
const EBML_ID_SEGMENT = 0x18538067;
const EBML_ID_TRACKS = 0x1654ae6b;
const EBML_ID_TRACK_ENTRY = 0xae;
const EBML_ID_TRACK_TYPE = 0x83;
const TRACK_TYPE_VIDEO = 1;
const TRACK_TYPE_AUDIO = 2;
const WEBM_PROBE_LIMIT = 512;      // cap element scans per file
const WEBM_PROBE_HEADER_BYTES = 256 * 1024;

const webmProbeCache = new Map<string, { mtimeMs: number; size: number; isAudioOnly: boolean }>();
const WEBM_PROBE_CACHE_MAX = 512;

const readEbmlId = (buffer: Buffer, offset: number): { id: number; length: number } | null => {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  let length = 1;
  if ((first & 0x80) !== 0) length = 1;
  else if ((first & 0x40) !== 0) length = 2;
  else if ((first & 0x20) !== 0) length = 3;
  else if ((first & 0x10) !== 0) length = 4;
  else return null;
  if (offset + length > buffer.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = (id << 8) | buffer[offset + i];
  return { id, length };
};

const readEbmlSize = (buffer: Buffer, offset: number): { size: number; length: number; known: boolean } | null => {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  let length = 1;
  if ((first & 0x80) !== 0) length = 1;
  else if ((first & 0x40) !== 0) length = 2;
  else if ((first & 0x20) !== 0) length = 3;
  else if ((first & 0x10) !== 0) length = 4;
  else if ((first & 0x08) !== 0) length = 5;
  else if ((first & 0x04) !== 0) length = 6;
  else if ((first & 0x02) !== 0) length = 7;
  else if ((first & 0x01) !== 0) length = 8;
  else return null;
  if (offset + length > buffer.length) return null;
  const mask = 0xff >>> length; // clear the VINT marker bits
  let value = first & mask;
  for (let i = 1; i < length; i++) value = (value << 8) | buffer[offset + i];
  // Unknown size = every value bit set across all payload bytes (e.g. 0x1FFF...FF).
  let allOnes = (first & mask) === mask;
  for (let i = 1; i < length && allOnes; i++) allOnes = buffer[offset + i] === 0xff;
  return { size: value, length, known: !allOnes };
};

/** Returns `true` when the WebM carries only an audio track, `false` when it
 *  has a video track, and `null` when the file cannot be probed. */
function probeWebmIsAudioOnly(filePath: string): boolean | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const cached = webmProbeCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.isAudioOnly;
    }
    const fd = fs.openSync(filePath, 'r');
    let buffer: Buffer;
    try {
      const readLength = Math.min(WEBM_PROBE_HEADER_BYTES, stat.size);
      buffer = Buffer.alloc(readLength);
      const bytesRead = fs.readSync(fd, buffer, 0, readLength, 0);
      buffer = buffer.subarray(0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }

    let hasVideo = false;
    let hasAudio = false;
    let elements = 0;

    const walk = (start: number, end: number): void => {
      let offset = start;
      while (offset + 2 <= end && elements < WEBM_PROBE_LIMIT) {
        elements += 1;
        const idInfo = readEbmlId(buffer, offset);
        if (!idInfo) return;
        const sizeInfo = readEbmlSize(buffer, offset + idInfo.length);
        if (!sizeInfo) return;
        offset += idInfo.length + sizeInfo.length;
        if (idInfo.id === EBML_ID_TRACK_TYPE) {
          // TrackType payload is a 1-byte integer (1=video, 2=audio).
          if (offset < buffer.length) {
            const type = buffer[offset];
            if (type === TRACK_TYPE_VIDEO) hasVideo = true;
            else if (type === TRACK_TYPE_AUDIO) hasAudio = true;
          }
          if (hasVideo) return;
          if (!sizeInfo.known) return;
          offset += sizeInfo.size;
          continue;
        }
        if (!sizeInfo.known) {
          // Unknown-size containers (common for Segment/Tracks): descend when
          // they are containers we care about, otherwise stop scanning.
          if (idInfo.id === EBML_ID_SEGMENT || idInfo.id === EBML_ID_TRACKS || idInfo.id === EBML_ID_TRACK_ENTRY) {
            if (idInfo.id === EBML_ID_TRACK_ENTRY) walk(offset, end);
            else walk(offset, end);
          }
          return;
        }
        const payloadEnd = offset + sizeInfo.size;
        if (idInfo.id === EBML_ID_SEGMENT || idInfo.id === EBML_ID_TRACKS || idInfo.id === EBML_ID_TRACK_ENTRY) {
          walk(offset, Math.min(payloadEnd, end));
        }
        if (hasVideo) return;
        offset = payloadEnd;
      }
    };

    walk(0, buffer.length);

    const result = hasVideo ? false : hasAudio ? true : null;
    if (result !== null) {
      if (webmProbeCache.size >= WEBM_PROBE_CACHE_MAX) {
        const oldestKey = webmProbeCache.keys().next().value;
        if (oldestKey !== undefined) webmProbeCache.delete(oldestKey);
      }
      webmProbeCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, isAudioOnly: result });
    }
    return result;
  } catch {
    return null;
  }
}

// ============================================================================
// STATIC MEDIA SERVING
// ============================================================================
// byte ranges, which browsers require for seeking and progressive video load.
const publicDir = path.resolve(__dirname, '../public');
// Media files (images, videos, avatars, covers, chat attachments) are public
// content that the VANTA frontend embeds from a DIFFERENT origin than the API
// (for example https://<host>:3000 page embedding https://<host>:5000 media in
// development, or the frontend domain embedding the API/CDN domain in
// production). helmet() sets `Cross-Origin-Resource-Policy: same-origin` on
// every response by default; that policy makes browsers BLOCK these cross-origin
// no-cors media loads at the network layer (`net::ERR_BLOCKED_BY_RESPONSE.CORP`)
// before a single media byte is fetched, which previously surfaced as:
//   - Reels: <video> onError -> "Unable to load Reel"
//   - Avatars/covers: <img>/CSS background silently fails -> first-letter fallback
//   - Chat images: broken/never-rendered attachments
// Express.static's setHeaders runs when the file is sent (after helmet set the
// header), so we explicitly allow cross-origin embedding for STATIC MEDIA ONLY.
// API JSON responses keep helmet's safe same-origin default.
app.use('/uploads', express.static(uploadStorageDir, {
  etag: true,
  acceptRanges: true, // Range/byte requests: <video> seeking & progressive play
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (/\.mp4$/i.test(filePath)) res.setHeader('Content-Type', 'video/mp4');
    if (/\.webm$/i.test(filePath)) {
      // Voice notes are audio-only WebM (MediaRecorder audio/webm). Serving them
      // as video/webm prevents <audio> playback on stricter engines. Probe the
      // container's track table once (cached) and set the correct type.
      const audioOnly = probeWebmIsAudioOnly(filePath);
      res.setHeader('Content-Type', audioOnly === true ? 'audio/webm' : 'video/webm');
    }
    if (/\.mov$/i.test(filePath)) res.setHeader('Content-Type', 'video/quicktime');
    if (/\.mp3$/i.test(filePath)) res.setHeader('Content-Type', 'audio/mpeg');
    if (/\.m4a$/i.test(filePath)) res.setHeader('Content-Type', 'audio/mp4');
    if (/\.aac$/i.test(filePath)) res.setHeader('Content-Type', 'audio/aac');
    if (/\.wav$/i.test(filePath)) res.setHeader('Content-Type', 'audio/wav');
    if (/\.(?:ogg|oga|opus)$/i.test(filePath)) res.setHeader('Content-Type', 'audio/ogg');
    if (/\.(?:jpe?g|png|webp|gif|avif|mp4|webm|mov|mp3|m4a|aac|wav|ogg|oga|opus)$/i.test(filePath)) {
      res.setHeader('Cache-Control', process.env.NODE_ENV === 'production'
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400');
    }
  },
}));
app.use(express.static(publicDir, {
  maxAge: process.env.NODE_ENV === 'production' ? '1y' : '1d',
  immutable: process.env.NODE_ENV === 'production',
  etag: true,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (filePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    }
    if (/\.mp4$/i.test(filePath)) res.setHeader('Content-Type', 'video/mp4');
    if (/\.webm$/i.test(filePath)) res.setHeader('Content-Type', 'video/webm');
    if (/\.mov$/i.test(filePath)) res.setHeader('Content-Type', 'video/quicktime');
    if (/\.(?:jpe?g|png|webp|gif|avif|mp4|webm|mov)$/i.test(filePath)) {
      res.setHeader('Cache-Control', process.env.NODE_ENV === 'production'
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400');
    }
  },
}));

// ============================================================================
// API ROUTES
// ============================================================================

// Health check (no auth required)
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'VANTA API is running',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// API version info
app.get('/api/version', (req: Request, res: Response) => {
  res.status(200).json({
    version: 'v1',
    features: ['auth', '2fa', 'rbac', 'rate-limiting', 'bot-protection', 'csrf-protection', 'audit-logging', 'ai-recommendations', 'ai-moderation', 'ai-nlp', 'ai-analytics', 'ai-fraud'],
  });
});

// Mount routes with rate limiting
app.use('/api/auth', authRoutes);

// Protected routes with rate limiting
app.use('/api/profiles', profileRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/welcome-reward', welcomeRewardRoutes);
app.use('/api/messages', rateLimiter.messaging, messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/gifts', giftRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/monetization', monetizationRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/search', rateLimiter.search, searchRoutes);
app.use('/api/upload', rateLimiter.upload, uploadRoutes);
app.use('/api/reels', reelRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/compliance', complianceRoutes);

// Verification & Creator Membership routes
app.use('/api/verification', verificationRoutes);

// Creator Studio routes (real aggregated metrics for the authenticated creator)
app.use('/api/creator', creatorRoutes);

// Ad routes
app.use('/api/ads', adRoutes);

// VANTA Give — fundraiser routes (public discovery, owner drafts, donations,
// private evidence, and admin review).
app.use('/api/fundraisers', fundraiserRoutes);

// ============================================================================
// AI ROUTES
// ============================================================================
app.use('/api/ai', aiRouter);

// ============================================================================
// ANALYTICS ROUTES
// ============================================================================
app.use('/api/analytics', analyticsRouter);

// ============================================================================
// WEBSOCKET SECURITY
// ============================================================================

const io = new Server(httpServer, {
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const normalizedOrigin = origin ? normalizeOrigin(origin) : undefined;
      if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin) || normalizedOrigin.startsWith('app://') || (normalizedOrigin && isAllowedLocalOrigin(normalizedOrigin))) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Rate limiting for WebSocket connections
  maxHttpBufferSize: 1e6, // 1MB max message size
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Authenticate WebSocket connections using enterprise security
io.use(authenticateSocket);

// Initialize Socket.io handlers
handleChatSocket(io);
handleLiveSocket(io);
handleGiftSocket(io);
setNotificationIO(io);
setSocialEventsIO(io);

// Register AI Socket.io handlers
registerAISocketHandlers(io);

// Register Analytics Socket.io handlers
registerAnalyticsSocketHandlers(io);

// Global socket connection handler
io.on('connection', (socket) => {
  handleConnect(socket as any);
  const userId = socket.data?.userId || (socket as any).userId;
  if (userId) socket.join(`user_${userId}`);
  
  socket.on('disconnect', () => {
    handleDisconnect(socket as any);
  });
});

// ============================================================================
// SECURITY HEADERS
// ============================================================================

// Security headers middleware (additional to helmet)
app.use((req: Request, res: Response, next) => {
  // Permissions Policy - allow camera and microphone for live streaming
  res.setHeader('Permissions-Policy', 
    'camera=(self), microphone=(self), geolocation=(), interest-cohort=()');
  
  // Clear-Site-Data for logout endpoints
  if (req.path === '/api/auth/logout') {
    res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
  }
  
  next();
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error('[ERROR]', err);
  
  auditLog.log({
    action: 'SERVER_ERROR',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    metadata: {
      method: req.method,
      path: req.path,
      error: err.message,
    },
    severity: 'ERROR' as any,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : err.message,
  });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Initialize security layer
    await initializeSecurity();

    // Initialize performance monitoring alerts
    setupDefaultAlerts();

    // Initialize analytics engine
    analyticsEngine.initialize();

    // Start cache warming for frequently accessed data
    startCacheWarming();

    // Connect to database
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set. Set it in .env or environment.');
    }

    await prisma.$connect();

    // Ensure the configurable VANTA Give category catalog exists.
    try {
      await ensureDefaultCategories();
    } catch (categoryError) {
      console.warn('[GIVE] Category seeding skipped:', categoryError);
    }

    // Seed development wallet for Admin/CEO (development only - guarded internally)
    try {
      const { seedDevWallet } = require('../prisma/seed-dev-wallet');
      await seedDevWallet();
    } catch (seedError) {
      console.warn('[SEED] Dev wallet seeding skipped:', seedError);
    }

    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.info(`Server running on port ${PORT}`);
      console.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Server startup failed:', error);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('Continuing despite startup errors in non-production environment.');
      httpServer.listen(PORT, () => {
        console.log(`Server is running on port ${PORT} (degraded mode)`);
      });
    }
  }
}


// Cache warming - pre-populate frequently accessed data
function startCacheWarming(): void {
  const warmer = cacheService.warmerInstance;
  
  // Warm trending content every 5 minutes
  warmer.register('trending', async () => {
    try {
      const { feedService } = require('./services/feed.service');
      const trending = await feedService.getTrending({ limit: 50 });
      await cacheService.set('trending', trending, 300_000);
    } catch {
      // Ignore warming errors
    }
  }, 300_000);

  // Warm active live streams every 30 seconds
  warmer.register('live:active', async () => {
    try {
      const { liveService } = require('./services/live.service');
      const streams = await liveService.getActiveStreams(undefined, 50);
      await cacheService.set('live:active', streams, 30_000);
    } catch {
      // Ignore warming errors
    }
  }, 30_000);

  warmer.start();
}

startServer();
