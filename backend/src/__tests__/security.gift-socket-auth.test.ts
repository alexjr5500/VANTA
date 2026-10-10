/**
 * VANTA-003 regression tests — `/gifts` Socket.IO namespace authentication.
 *
 * Before the fix the /gifts handshake only verified the JWT *signature*: the
 * session, the account status and the token type were never checked, so a
 * revoked session or a suspended/banned account could keep sending real gifts
 * (financial transactions) over the socket for the rest of the access-token
 * lifetime. The middleware is now the canonical session-aware
 * `authenticateSocket`. These tests prove, over a real Socket.IO server:
 *   - no token            → connection rejected
 *   - bad signature       → connection rejected
 *   - revoked session     → connection rejected
 *   - suspended account   → connection rejected
 *   - active session+user → connection accepted
 */
import { describe, expect, test, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { createServer as createHttpServer, Server as HttpServer } from 'http';
import { Server as IOServer } from 'socket.io';
// socket.io-client resolves from the repo root workspace.
import { io as connect, Socket as ClientSocket } from 'socket.io-client';

jest.mock('../prisma', () => {
  const session = {
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const user = { findUnique: jest.fn() };
  return {
    prisma: {
      session,
      user,
      auditLog: { create: jest.fn() },
    },
  };
});

jest.mock('../security/auditLog', () => ({
  auditLog: { log: jest.fn().mockResolvedValue({}) },
}));

// Import AFTER mocks are registered.
import { prisma } from '../prisma';
import { handleGiftSocket } from '../sockets/gift.socket';

const JWT_SECRET = 'gift-socket-test-secret';

function accessToken(userId: string, sessionId: string): string {
  return jwt.sign({ userId, role: 'USER', sessionId, type: 'access' }, JWT_SECRET, { expiresIn: '15m' });
}

describe('/gifts socket authentication (VANTA-003)', () => {
  let httpServer: HttpServer;
  let io: IOServer;
  let port: number;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    httpServer = createHttpServer();
    io = new IOServer(httpServer, {
      cors: { origin: '*' },
      transports: ['websocket'],
    });
    handleGiftSocket(io);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as { port: number };
    port = address.port;
  });

  afterAll(async () => {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    delete process.env.JWT_SECRET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.session.update as jest.Mock).mockResolvedValue({});
  });

  function expectRejected(auth: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket: ClientSocket = connect(`http://127.0.0.1:${port}/gifts`, {
        transports: ['websocket'],
        auth,
        reconnection: false,
        timeout: 3000,
      });
      socket.on('connect', () => {
        socket.disconnect();
        reject(new Error('expected connection to be rejected'));
      });
      socket.on('connect_error', (err) => {
        socket.disconnect();
        resolve(String(err.message));
      });
    });
  }

  function expectAccepted(auth: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket: ClientSocket = connect(`http://127.0.0.1:${port}/gifts`, {
        transports: ['websocket'],
        auth,
        reconnection: false,
        timeout: 3000,
      });
      socket.on('connect', () => {
        socket.disconnect();
        resolve();
      });
      socket.on('connect_error', (err) => {
        socket.disconnect();
        reject(new Error(`connection rejected unexpectedly: ${err.message}`));
      });
    });
  }

  test('a connection without a token is rejected', async () => {
    const message = await expectRejected({});
    expect(message).toMatch(/Authentication required|Authentication/i);
  });

  test('a connection with a bad signature is rejected', async () => {
    const message = await expectRejected({ token: 'forged.token.value' });
    expect(message).toMatch(/Invalid token|Authentication failed/i);
  });

  test('a REVOKED session (no session row) is rejected', async () => {
    (prisma.session.findUnique as jest.Mock).mockResolvedValue(null);
    const message = await expectRejected({ token: accessToken('user-1', 'sess-1') });
    expect(message).toMatch(/revoked|expired|invalid|mismatch/i);
  });

  test('a token whose sessionId does not match the session row is rejected', async () => {
    (prisma.session.findUnique as jest.Mock).mockResolvedValue({
      id: 'sess-OTHER',
      userId: 'user-1',
      token: 'x',
      expiresAt: new Date(Date.now() + 60_000),
      user: { status: 'ACTIVE', role: 'USER' },
    });
    const message = await expectRejected({ token: accessToken('user-1', 'sess-1') });
    expect(message).toMatch(/invalid|revoked/i);
  });

  test('a SUSPENDED account is rejected', async () => {
    (prisma.session.findUnique as jest.Mock).mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      token: 'x',
      expiresAt: new Date(Date.now() + 60_000),
      user: { status: 'SUSPENDED', role: 'USER' },
    });
    const message = await expectRejected({ token: accessToken('user-1', 'sess-1') });
    expect(message).toMatch(/restricted|suspended|invalid/i);
  });

  test('an ACTIVE session with an ACTIVE user is accepted', async () => {
    (prisma.session.findUnique as jest.Mock).mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      token: 'x',
      expiresAt: new Date(Date.now() + 60_000),
      user: { status: 'ACTIVE', role: 'USER' },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', username: 'alice' });
    await expectAccepted({ token: accessToken('user-1', 'sess-1') });
  });
});