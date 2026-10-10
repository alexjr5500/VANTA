/**
 * VANTA-002 regression tests — `/api/analytics/*` authorization.
 *
 * Before the fix every analytics route only required *authentication*, so any
 * signed-in user could read platform revenue/operational analytics and other
 * users' creator/stream analytics. This suite proves:
 *   - anonymous            → 401
 *   - ordinary user        → 403 on every platform analytics endpoint
 *   - administrator        → 200 on platform analytics endpoints
 *   - self-or-admin owner  → 200 on OWN creator/stream analytics, 403 on others
 *   - `/track` telemetry   → bounded payload validation (400 on garbage)
 */
import { describe, expect, test, jest, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';

jest.mock('../prisma', () => {
  const session = { findUnique: jest.fn(), delete: jest.fn(), update: jest.fn() };
  const user = { findUnique: jest.fn() };
  return { prisma: { session, user, auditLog: { create: jest.fn() } } };
});

jest.mock('../security/auditLog', () => ({
  auditLog: { log: jest.fn().mockResolvedValue({}) },
}));

// The controller layer is replaced with fakes that also RESPOND (the router's
// authorize-then-send flow needs the handler to produce the response) — this
// suite is about the authorization barrier, not the analytics queries.
// NOTE: a hoisted function declaration (prefixed `mock` per jest's rule) is
// used so the jest.mock factory can reference it before its own line runs.
function mockOkHandler(_req: any, res: any): void {
  res.status(200).json({ success: true, data: [] });
}

jest.mock('../controllers/analytics.controller', () => ({
  analyticsController: {
    getPlatformOverview: jest.fn().mockImplementation(mockOkHandler),
    getUserMetrics: jest.fn().mockImplementation(mockOkHandler),
    getCurrentDAU: jest.fn().mockImplementation(mockOkHandler),
    getOnlineUsers: jest.fn().mockImplementation(mockOkHandler),
    getRetentionRates: jest.fn().mockImplementation(mockOkHandler),
    getUserGrowth: jest.fn().mockImplementation(mockOkHandler),
    getCreatorAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getCreatorLeaderboard: jest.fn().mockImplementation(mockOkHandler),
    getContentMetrics: jest.fn().mockImplementation(mockOkHandler),
    getTopContent: jest.fn().mockImplementation(mockOkHandler),
    getRevenueAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getARPU: jest.fn().mockImplementation(mockOkHandler),
    getAdRevenue: jest.fn().mockImplementation(mockOkHandler),
    getActiveStreamsAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getStreamAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getStreamPerformance: jest.fn().mockImplementation(mockOkHandler),
    getCommunityAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getSearchAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getTrendingTopics: jest.fn().mockImplementation(mockOkHandler),
    getNotificationAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getAIAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getDashboardSnapshot: jest.fn().mockImplementation(mockOkHandler),
    getAlertRules: jest.fn().mockImplementation(mockOkHandler),
    createAlertRule: jest.fn().mockImplementation(mockOkHandler),
    updateAlertRule: jest.fn().mockImplementation(mockOkHandler),
    deleteAlertRule: jest.fn().mockImplementation(mockOkHandler),
    getAlertHistory: jest.fn().mockImplementation(mockOkHandler),
    acknowledgeAlert: jest.fn().mockImplementation(mockOkHandler),
    resolveAlert: jest.fn().mockImplementation(mockOkHandler),
    getMarketingCampaigns: jest.fn().mockImplementation(mockOkHandler),
    createMarketingCampaign: jest.fn().mockImplementation(mockOkHandler),
    getScheduledReports: jest.fn().mockImplementation(mockOkHandler),
    createScheduledReport: jest.fn().mockImplementation(mockOkHandler),
    getPredictions: jest.fn().mockImplementation(mockOkHandler),
    getLTVAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getScreenAnalytics: jest.fn().mockImplementation(mockOkHandler),
    getAPIPerformance: jest.fn().mockImplementation(mockOkHandler),
    trackEvent: jest.fn().mockImplementation(mockOkHandler),
    trackBatchEvents: jest.fn().mockImplementation(mockOkHandler),
  } as any,
}));

// Import AFTER the mocks above are registered.
import { prisma } from '../prisma';
import analyticsRoutes from '../routes/analytics.routes';

const JWT_SECRET = 'analytics-test-secret';

function signToken(userId: string, role: string, sessionId: string): string {
  return jwt.sign(
    { userId, role, sessionId, type: 'access' },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

describe('/api/analytics authorization (VANTA-002)', () => {
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const app = express();
    app.use(express.json());
    app.use('/api/analytics', analyticsRoutes);
    app.use((_req: any, res: any) => res.status(404).json({ error: 'not found' }));

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.close();
    delete process.env.JWT_SECRET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockSession(userId: string, role: string) {
    const session = {
      id: 'sess-1',
      userId,
      token: 'token',
      expiresAt: new Date(Date.now() + 60_000),
    };
    (prisma.session.findUnique as jest.Mock).mockResolvedValue(session);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: userId, status: 'ACTIVE', role });
    (prisma.session.update as jest.Mock).mockResolvedValue(session);
  }

  test('anonymous request is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/overview`);
    expect(res.status).toBe(401);
  });

  test('ordinary authenticated USER is rejected (403) from platform analytics', async () => {
    mockSession('user-1', 'USER');
    const token = signToken('user-1', 'USER', 'sess-1');
    const paths = [
      '/api/analytics/overview',
      '/api/analytics/users/dau',
      '/api/analytics/revenue/analytics',
      '/api/analytics/revenue/arpu',
      '/api/analytics/revenue/ad',
      '/api/analytics/streams/active',
      '/api/analytics/streams/stream-abc',
      '/api/analytics/creators/leaderboard',
      '/api/analytics/ltv',
      '/api/analytics/screens',
      '/api/analytics/performance/api',
      '/api/analytics/predictions',
      '/api/analytics/funnel',
      '/api/analytics/alerts/rules',
      '/api/analytics/marketing/campaigns',
    ];
    for (const path of paths) {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });

  test('ADMIN role can read platform analytics', async () => {
    mockSession('admin-1', 'ADMIN');
    const token = signToken('admin-1', 'ADMIN', 'sess-1');
    const res = await fetch(`${baseUrl}/api/analytics/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test('a creator may read their OWN analytics but not another creator\u2019s', async () => {
    mockSession('creator-1', 'CREATOR');
    const token = signToken('creator-1', 'CREATOR', 'sess-1');

    const own = await fetch(`${baseUrl}/api/analytics/creators/analytics?creatorId=creator-1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(own.status).toBe(200);

    const other = await fetch(`${baseUrl}/api/analytics/creators/analytics?creatorId=creator-2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(other.status).toBe(403);
  });

  test('a host may read their OWN stream performance but not another host\u2019s', async () => {
    mockSession('host-1', 'CREATOR');
    const token = signToken('host-1', 'CREATOR', 'sess-1');

    const own = await fetch(`${baseUrl}/api/analytics/streams/performance/host?hostId=host-1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(own.status).toBe(200);

    const other = await fetch(`${baseUrl}/api/analytics/streams/performance/host?hostId=host-2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(other.status).toBe(403);
  });

  test('ADMIN may read any creator analytics', async () => {
    mockSession('admin-1', 'ADMIN');
    const token = signToken('admin-1', 'ADMIN', 'sess-1');
    const res = await fetch(`${baseUrl}/api/analytics/creators/analytics?creatorId=someone-else`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test('telemetry /track rejects malformed payloads and accepts bounded ones', async () => {
    const bad = await fetch(`${baseUrl}/api/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: '' }),
    });
    expect(bad.status).toBe(400);

    const tooBig = await fetch(`${baseUrl}/api/analytics/track/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: new Array(60).fill({ eventType: 'page.view' }) }),
    });
    expect(tooBig.status).toBe(400);

    const ok = await fetch(`${baseUrl}/api/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'page.view', userId: 'user-1' }),
    });
    expect(ok.status).toBe(200);
  });
});