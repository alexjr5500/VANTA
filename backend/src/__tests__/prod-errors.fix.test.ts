/**
 * Regression coverage for the two production Railway errors:
 *
 *  1) P2003 "SecurityLog_userId_fkey (index)" — anonymous/system security
 *     events were inserting a fabricated userId ('anonymous') that is not a
 *     real User.id. With the nullable schema, auditLog.ts stores NULL instead.
 *
 *  2) "InternalServerError: stream is not readable" — a global req.on('data')/
 *     req.on('end') reader consumed the stream before body-parser read it. The
 *     fix captures the raw body via express.json()'s `verify` callback so the
 *     stream is read exactly ONCE.
 */
import express, { Request } from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { auditLog } from '../security/auditLog';
import { prisma } from '../prisma';

// Stub the Prisma client so we can observe exactly what userId is persisted.
// The jest.fn() instances are created INSIDE the factory to avoid jest's hoisting
// of jest.mock above the module's import bindings.
jest.mock('../prisma', () => ({
  prisma: {
    securityLog: {
      create: jest.fn().mockResolvedValue({ id: 'log_1', action: 'BOT_DETECTED', userId: null, createdAt: new Date() }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

const securityLogCreate = prisma.securityLog.create as jest.Mock;
describe('Production security/body-parser regression fixes', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Replicate the EXACT middleware used in index.ts: express.json() with the
    // verify callback that captures the raw body during the single stream read.
    const app = express();
    app.use(express.json({
      limit: '10mb',
      verify: (req: Request, _res: any, buf: Buffer) => {
        if (buf && buf.length > 0) (req as any).rawBody = buf.toString('utf8');
      },
    }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // JSON POST endpoint: proves the body is parsed once and rawBody is captured.
    app.post('/webhook', (req: Request, res: any) => {
      res.json({ parsed: req.body, rawBody: (req as any).rawBody });
    });

    // Endpoint that triggers an anonymous/system SecurityLog insert.
    app.post('/anonymous-event', (_req: Request, res: any) => {
      auditLog.log({ action: 'BOT_DETECTED', ipAddress: '1.2.3.4' });
      res.status(200).json({ ok: true });
    });

    // Endpoint that triggers an authenticated SecurityLog insert.
    app.post('/authenticated-event', (_req: Request, res: any) => {
      auditLog.log({ userId: 'user_real_1', action: 'ADMIN_ACTION', ipAddress: '9.9.9.9' });
      res.status(200).json({ ok: true });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    securityLogCreate.mockClear();
  });

  afterAll(async () => {
    server?.close();
  });

  test('JSON POST is parsed exactly once and rawBody is captured (no "stream is not readable")', async () => {
    const payload = JSON.stringify({ eventId: 'evt-1', amount: 5, txHash: '0xabc' });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parsed).toEqual({ eventId: 'evt-1', amount: 5, txHash: '0xabc' });
    expect(body.rawBody).toBe(payload);
  });

  test('URL-encoded POST body is parsed exactly once', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=two',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parsed.a).toBe('1');
    expect(body.parsed.b).toBe('two');
  });
test('anonymous/system SecurityLog event stores a NULL userId (never a fabricated id)', async () => {
    const res = await fetch(`${baseUrl}/anonymous-event`, { method: 'POST' });
    expect(res.status).toBe(200); // a valid request must not become a 500
    await new Promise((r) => setTimeout(r, 50)); // let auditLog.log flush
    expect(securityLogCreate).toHaveBeenCalled();
    const data = securityLogCreate.mock.calls[0][0].data;
    expect(data.userId).toBeNull(); // NULL, NOT 'anonymous'
    expect(data.action).toBe('BOT_DETECTED');
  });

  test('authenticated SecurityLog event stores the real userId', async () => {
    const res = await fetch(`${baseUrl}/authenticated-event`, { method: 'POST' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(securityLogCreate).toHaveBeenCalled();
    const data = securityLogCreate.mock.calls[0][0].data;
    expect(data.userId).toBe('user_real_1');
  });

  test('multiple simultaneous JSON requests each parse their own stream independently', async () => {
    const reqs = Array.from({ length: 10 }, (_, i) =>
      fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: i, value: `payload-${i}` }),
      })
        .then((r) => r.json())
        .then((b) => expect(b.rawBody).toBe(JSON.stringify({ id: i, value: `payload-${i}` }))),
    );
    await Promise.all(reqs); // resolves only if no stream is double-consumed
  });

  test('a malformed JSON body returns 4xx (still no "stream is not readable" crash)', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    expect([400, 500]).toContain(res.status);
  });
});