// @vitest-environment node
/**
 * Regression coverage for the Reel playback pipeline's URL layer.
 *
 * Production Reels failed with "Unable to load Reel — MEDIA_ELEMENT_ERROR:
 * The server returned no playable video source" because the backend returns
 * RELATIVE `/uploads/<file>.mp4` URLs and the files behind them had been wiped
 * from an ephemeral storage disk (Railway, no persistent volume). These tests
 * pin the OTHER half of the contract the frontend owns:
 *   - relative /uploads URLs returned by /api/reels resolve against the
 *     configured API origin (NOT the Vercel page origin, never "localhost:5000");
 *   - external/CDN media (e.g. Cloudinary) is passed through untouched.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const API = 'https://api-vanta.example.com';

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_API_URL = API;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_API_URL;
});

async function load() {
  const { resolveMediaUrl } = await import('./mediaUrl');
  return resolveMediaUrl;
}

describe('resolveMediaUrl (Reel video source resolution)', () => {
  test('resolves the relative /uploads URL returned by /api/reels against the API origin', async () => {
    const resolve = await load();
    expect(resolve('/uploads/1788831833464-9a1b2a6bd0cf60925e9934a66df2f5ea.mp4'))
      .toBe(`${API}/uploads/1788831833464-9a1b2a6bd0cf60925e9934a66df2f5ea.mp4`);
  });

  test('resolves legacy bare uploads/... and filename-only records to /uploads', async () => {
    const resolve = await load();
    expect(resolve('uploads/reel.mp4')).toBe(`${API}/uploads/reel.mp4`);
    expect(resolve('reel-clip.webm')).toBe(`${API}/uploads/reel-clip.webm`);
  });

  test('rewrites old localhost /uploads records (authored on a dev machine) to the current API origin', async () => {
    const resolve = await load();
    expect(resolve('http://localhost:5000/uploads/dev-reel.mp4')).toBe(`${API}/uploads/dev-reel.mp4`);
    expect(resolve('http://192.168.1.50:5000/uploads/dev-reel.mp4')).toBe(`${API}/uploads/dev-reel.mp4`);
  });

  test('passes external CDN/media URLs (e.g. Cloudinary) through untouched', async () => {
    const resolve = await load();
    const cdn = 'https://res.cloudinary.com/vanta/video/upload/v1/reel_abc.mp4';
    expect(resolve(cdn)).toBe(cdn);
  });

  test('passes same-origin absolute media URLs through untouched', async () => {
    const resolve = await load();
    const sameOrigin = `${API}/uploads/reel.mp4`;
    expect(resolve(sameOrigin)).toBe(sameOrigin);
  });

  test('resolves protocol-relative media URLs against the API origin (as documented)', async () => {
    const resolve = await load();
    // Current documented behavior: the API origin is prepended verbatim.
    expect(resolve('//cdn.example.com/media/reel.mp4')).toBe(`${API}//cdn.example.com/media/reel.mp4`);
  });

  test('passes blob:/data: object URLs through (pre-upload trimmer previews)', async () => {
    const resolve = await load();
    expect(resolve('blob:http://localhost:3000/abc')).toBe('blob:http://localhost:3000/abc');
    expect(resolve('data:video/mp4;base64,AAAA')).toBe('data:video/mp4;base64,AAAA');
  });

  test('rejects local filesystem paths that a browser can never play', async () => {
    const resolve = await load();
    expect(resolve('C:\\videos\\reel.mp4')).toBe('');
    expect(resolve('\\\\server\\uploads\\reel.mp4')).toBe('');
  });

  test('returns empty string for missing/blank sources', async () => {
    const resolve = await load();
    expect(resolve(undefined)).toBe('');
    expect(resolve('')).toBe('');
    expect(resolve(null)).toBe('');
  });
});