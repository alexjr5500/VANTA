import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import {
  buildAllowedOrigins,
  isOriginAllowed,
  isAllowedLocalOrigin,
  normalizeOrigin,
  PRODUCTION_FRONTEND_ORIGIN,
} from '../security/cors';

// See TESTING_GUIDE.md -> "Test CORS". These tests guard the production
// regression where the Vercel frontend (https://vanta-nu.vercel.app) could not
// reach POST /api/auth/login because the origin was missing from the allow
// list, so preflight was answered WITHOUT an Access-Control-Allow-Origin header.

describe('buildAllowedOrigins', () => {
  test('includes CORS_ALLOWED_ORIGINS, FRONTEND_URL and the dev default', () => {
    const origins = buildAllowedOrigins({
      CORS_ALLOWED_ORIGINS: 'https://admin.example.com',
      FRONTEND_URL: 'https://app.example.com',
    });
    expect(origins).toContain('https://admin.example.com');
    expect(origins).toContain('https://app.example.com');
    expect(origins).toContain('http://127.0.0.1:3000');
  });

  test('always includes the exact production frontend origin (regression)', () => {
    // Simulates a Railway deploy that forgot FRONTEND_URL / CORS_ALLOWED_ORIGINS.
    const origins = buildAllowedOrigins({});
    expect(origins).toContain(PRODUCTION_FRONTEND_ORIGIN);
    expect(origins).toContain('http://localhost:3000');
  });

  test('never emits a wildcard', () => {
    const origins = buildAllowedOrigins({ CORS_ALLOWED_ORIGINS: '*' });
    expect(origins).not.toContain('*');
  });

  test('normalizes trailing slashes', () => {
    const origins = buildAllowedOrigins({ FRONTEND_URL: `${PRODUCTION_FRONTEND_ORIGIN}/` });
    expect(origins).toContain(PRODUCTION_FRONTEND_ORIGIN);
  });

  test('deduplicates repeat entries', () => {
    const origins = buildAllowedOrigins({ CORS_ALLOWED_ORIGINS: PRODUCTION_FRONTEND_ORIGIN });
    expect(origins.filter((o) => o === PRODUCTION_FRONTEND_ORIGIN)).toHaveLength(1);
  });
});

describe('normalizeOrigin', () => {
  test('strips trailing slashes', () => {
    expect(normalizeOrigin('https://vanta-nu.vercel.app///')).toBe(PRODUCTION_FRONTEND_ORIGIN);
    expect(normalizeOrigin('http://localhost:3000/')).toBe('http://localhost:3000');
  });
});

describe('isOriginAllowed', () => {
  test('allows the exact production frontend origin in production', () => {
    const origins = buildAllowedOrigins({});
    expect(isOriginAllowed(PRODUCTION_FRONTEND_ORIGIN, origins, true)).toBe(true);
  });

  test('allows configured extra origins', () => {
    const origins = buildAllowedOrigins({ CORS_ALLOWED_ORIGINS: 'https://admin.example.com' });
    expect(isOriginAllowed('https://admin.example.com/', origins, true)).toBe(true);
  });

  test('rejects unknown origins (no wildcard)', () => {
    const origins = buildAllowedOrigins({});
    expect(isOriginAllowed('https://evil.example.com', origins, true)).toBe(false);
    // Subdomain-of-allowed still must NOT pass: exact match only.
    expect(isOriginAllowed('https://vanta-nu.vercel.app.evil.com', origins, true)).toBe(false);
  });

  test('passes through requests without an Origin header', () => {
    const origins = buildAllowedOrigins({});
    expect(isOriginAllowed(undefined, origins, true)).toBe(true);
  });

  test('allows localhost:3000 and private-LAN dev origins in development', () => {
    const origins = buildAllowedOrigins({ NODE_ENV: 'development' });
    expect(isOriginAllowed('http://localhost:3000', origins, false)).toBe(true);
    expect(isAllowedLocalOrigin('http://192.168.1.50:3000', false)).toBe(true);
    expect(isAllowedLocalOrigin('http://10.174.123.177:3000', false)).toBe(true);
  });

  test('private-LAN origins are NOT allowed in production', () => {
    expect(isAllowedLocalOrigin('http://192.168.1.50:3000', true)).toBe(false);
    expect(isAllowedLocalOrigin('http://10.174.123.177:3000', true)).toBe(false);
  });
});

describe('CORS middleware preflight (integration)', () => {
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    // Production-like app with the same middleware wiring as backend/src/index.ts.
    const origins = buildAllowedOrigins({});
    const app = express();
    app.use(cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (isOriginAllowed(origin, origins, true)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 86400,
      optionsSuccessStatus: 204,
      preflightContinue: false,
    }));
    app.post('/api/auth/login', (req: any, res: any) => res.status(200).json({ ok: true }));
    app.get('/api/version', (req: any, res: any) => res.status(200).json({ version: 'v1' }));
    app.use((req: any, res: any) => res.status(404).json({ error: 'Not found' }));

    server = createServer(app);
    // Wait until the socket is actually bound before reading server.address(),
    // otherwise it returns null and the integration tests cannot resolve a port.
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  test('OPTIONS preflight for /api/auth/login is accepted for the production origin', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: PRODUCTION_FRONTEND_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(PRODUCTION_FRONTEND_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  test('the actual POST response echoes the exact origin plus credentials', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: PRODUCTION_FRONTEND_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'x', password: 'y' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(PRODUCTION_FRONTEND_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  test('preflight applies to every API route, not just login', async () => {
    const res = await fetch(`${baseUrl}/api/version`, {
      method: 'OPTIONS',
      headers: { Origin: PRODUCTION_FRONTEND_ORIGIN, 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(PRODUCTION_FRONTEND_ORIGIN);
  });

  test('unknown origins get no ACAO header (deny)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});