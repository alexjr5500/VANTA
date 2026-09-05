/**
 * Regression test for the reported "Upload failed — File type text/plain is not allowed".
 *
 * The shared video trimmer can accept real .mp4/.webm files whose browser MIME
 * tag is wrong (text/plain / empty — common for downloads). The frontend now
 * re-tags (normalizes) the file to a valid video MIME before upload. This test
 * pins the backend behavior: the reel multer allow-list must reject bad MIME
 * parts and accept the normalized video/mp4 + video/webm (trimmed) parts.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import { AddressInfo } from 'net';
import { uploadVideo } from '../services/upload.service';

function multipart(boundary: string, fileName: string, contentType: string | null, data: Buffer): Buffer {
  const lines = [`--${boundary}`, `Content-Disposition: form-data; name="video"; filename="${fileName}"`];
  if (contentType) lines.push(`Content-Type: ${contentType}`);
  const head = Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return Buffer.concat([head, data, tail]);
}

function submit(baseUrl: string, body: Buffer): Promise<{ status: number; text: string }> {
  const boundary = '----vantaMulterTest';
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}/reel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('reel video multer allow-list', () => {
  let server: http.Server;
  let baseUrl = '';
  const writtenPaths: string[] = [];

  beforeAll(async () => {
    const app = express();
    app.post(
      '/reel',
      uploadVideo.single('video'),
      (req, res) => {
        const file = req.file as unknown as { mimetype: string; path: string } | undefined;
        if (file) writtenPaths.push(file.path);
        res.status(200).json({ ok: true, mimetype: file?.mimetype });
      },
      (err: any, _req: any, res: any, _next: any) => {
        res.status(400).json({ error: err?.message || 'Upload failed' });
      }
    );
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const p of writtenPaths) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // best-effort cleanup
      }
    }
  });

  test('rejects a .mp4 part tagged text/plain with the reported message', async () => {
    const body = multipart('----vantaMulterTest', 'clip.mp4', 'text/plain', Buffer.from('FAKE-MP4-BYTES'));
    const res = await submit(baseUrl, body);
    expect(res.status).toBe(400);
    expect(res.text).toContain('File type text/plain is not allowed');
  });

  test('rejects a .mp4 part with no Content-Type header (empty browser type)', async () => {
    const body = multipart('----vantaMulterTest', 'clip.mp4', null, Buffer.from('FAKE-MP4-BYTES'));
    const res = await submit(baseUrl, body);
    expect(res.status).toBe(400);
  });

  test('accepts the normalized video/mp4 part (frontend re-tags text/plain -> video/mp4)', async () => {
    const body = multipart('----vantaMulterTest', 'clip.mp4', 'video/mp4', Buffer.from('FAKE-MP4-BYTES'));
    const res = await submit(baseUrl, body);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.text);
    expect(json.mimetype).toBe('video/mp4');
  });

  test('accepts the trimmed video/webm part produced by the shared trimmer', async () => {
    const body = multipart('----vantaMulterTest', 'clip-trimmed.webm', 'video/webm', Buffer.from('FAKE-WEBM-BYTES'));
    const res = await submit(baseUrl, body);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.text);
    expect(json.mimetype).toBe('video/webm');
  });
});