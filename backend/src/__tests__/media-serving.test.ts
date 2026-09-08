/**
 * Regression coverage for the production "Unable to load Reel — MEDIA_ELEMENT_ERROR"
 * failure.
 *
 * Root cause (verified against production): Reel videos are stored on the
 * backend's LOCAL disk (`/uploads` mount serves uploadStorageDir). When that
 * disk is EPHEMERAL (Railway without a persistent volume / UPLOAD_STORAGE_DIR
 * unset), a restart wipes the bytes while the Postgres row survives. The API
 * keeps returning `/uploads/<file>.mp4` for the Reel, but the browser <video>
 * receives a JSON 404 (Content-Type: application/json) → "The server returned
 * no playable video source: MEDIA_ELEMENT_ERROR: Format error".
 *
 * These tests pin the delivery contract that makes Reels playable:
 *   - an existing file is served as `video/mp4` with Range support and a
 *     cross-origin media policy (so Vercel can embed Railway-hosted <video>);
 *   - a missing file MUST NOT be served as a playable source (404 JSON), which
 *     is the exact signature that produces the browser error above;
 *   - the URL produced by buildUploadUrl (what /api/reels returns) is actually
 *     fetchable through the very same /uploads mount.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import { buildUploadUrl } from '../services/upload.service';

// upload.service imports the Prisma client for metadata persistence; the media
// serving contract only cares about the static mount, so stub it out.
jest.mock('../prisma', () => ({
  prisma: { uploadedFile: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } },
}));

const SAMPLE_MP4 = Buffer.concat([
  Buffer.from('000000186674797069736F6D0000020069736F6D', 'hex'), // ftyp box (real mp4 magic)
  Buffer.from('000008046D646174', 'hex'),                          // mdat box header
  Buffer.alloc(4 * 1024, 7),                                       // padding
]);

/** Mirror of the PRODUCTION /uploads static mount options in src/index.ts. */
function mountUploads(app: express.Express, dir: string) {
  app.use('/uploads', express.static(dir, {
    etag: true,
    acceptRanges: true,
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (/\.mp4$/i.test(filePath)) res.setHeader('Content-Type', 'video/mp4');
      if (/\.(?:jpe?g|png|webp|gif|avif|mp4|webm|mov)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  // Same fallthrough the real app uses: express.static calls next() on a miss
  // and the API 404 handler answers with JSON (never streamable media).
  app.use((_req: any, res: any) => {
    res.status(404).json({ error: 'Not found', message: 'Route not found' });
  });
}

function get(baseUrl: string, reqPath: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.request(`${baseUrl}${reqPath}`, { method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Reel video media delivery contract (/uploads static mount)', () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl = '';
  const uploadedName = '1788000000000-abcdef0123456789abcdef0123456789.mp4';

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `vanta-media-serving-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(tmpDir);
    fs.writeFileSync(path.join(tmpDir, uploadedName), SAMPLE_MP4);
    fs.writeFileSync(path.join(tmpDir, 'cover.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'binary');

    const app = express();
    mountUploads(app, tmpDir);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('serves an existing Reel mp4 as video/mp4 with byte ranges (browser can play it)', async () => {
    const { status, headers, body } = await get(baseUrl, `/uploads/${uploadedName}`);
    expect(status).toBe(200);
    expect(String(headers['content-type'])).toMatch(/^video\/mp4/i);
    expect(String(headers['accept-ranges'])).toBe('bytes');
    expect(String(headers['cross-origin-resource-policy'])).toBe('cross-origin');
    expect(String(headers['cache-control'])).toContain('immutable');
    // Real MP4 container magic (the payload a browser demuxer needs).
    expect(body.subarray(4, 8).toString('ascii')).toBe('ftyp');
  });

  test('honors Range requests (206) required for <video> seeking/progressive load', async () => {
    const { status, headers } = await get(baseUrl, `/uploads/${uploadedName}`, { Range: 'bytes=0-1023' });
    expect(status).toBe(206);
    expect(String(headers['content-range'])).toMatch(/^bytes 0-1023\//);
    expect(String(headers['content-type'])).toMatch(/^video\/mp4/i);
  });

  test('returns a cross-origin policy header so Vercel <video> can embed the API media', async () => {
    // no-cors media loads are gated by CORP, not CORS; same-origin blocks at
    // net::ERR_BLOCKED_BY_RESPONSE.CORP before a byte is fetched.
    const { headers } = await get(baseUrl, `/uploads/${uploadedName}`);
    expect(String(headers['cross-origin-resource-policy'])).toBe('cross-origin');
  });

  test('a missing file is a JSON 404 — the exact MEDIA_ELEMENT_ERROR signature after a storage wipe', async () => {
    // "Hehe"-style production reels 404 like this; <video> cannot demux JSON and
    // the browser reports "The server returned no playable video source".
    const { status, headers, body } = await get(baseUrl, '/uploads/1788831833464-9a1b2a6bd0cf60925e9934a66df2f5ea.mp4');
    expect(status).toBe(404);
    expect(String(headers['content-type'])).toMatch(/^application\/json/i);
    expect(body.subarray(4, 8).toString('ascii')).not.toBe('ftyp');
    const parsed = JSON.parse(body.toString('utf8'));
    expect(parsed.error).toBe('Not found');
  });

  test('buildUploadUrl returns a URL that is servable through the /uploads mount (API → <video> round trip)', async () => {
    const mockReq = { protocol: 'http', get: jest.fn().mockImplementation((name: string) => (name === 'host' ? 'media.test' : undefined)) };
    const url = buildUploadUrl(mockReq, uploadedName);
    expect(url).toBe(`/uploads/${uploadedName}`);
    const { status, headers } = await get(baseUrl, url);
    expect(status).toBe(200);
    expect(String(headers['content-type'])).toMatch(/^video\/mp4/i);
  });
});