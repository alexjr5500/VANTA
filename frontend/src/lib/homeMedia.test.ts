import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://api-vanta.example.com';
beforeEach(() => { vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_API_URL', API); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('Homes media URL contract', () => {
  it('rewrites old API hosts and resolves bare uploaded filenames for gallery and listing', async () => {
    const { homeImageCandidates } = await import('./homeMedia');
    expect(homeImageCandidates({ uploadedFile: { url: 'http://localhost:5000/uploads/photo.jpg' } })).toEqual([API + '/uploads/photo.jpg']);
    expect(homeImageCandidates({ url: 'photo.jpg' })).toEqual([API + '/uploads/photo.jpg']);
  });
  it('keeps real CDN originals and falls back to distinct thumbnails', async () => {
    const { homeImageCandidates } = await import('./homeMedia');
    const original = 'https://res.cloudinary.com/vanta/image/upload/property.jpg';
    const media = { uploadedFile: { url: original }, url: original, thumbnailUrl: '/uploads/thumb.jpg' };
    expect(homeImageCandidates(media)).toEqual([original, API + '/uploads/thumb.jpg']);
    expect(homeImageCandidates(media, true)).toEqual([API + '/uploads/thumb.jpg', original]);
  });
  it('uses video thumbnails for images and never sends a video source to img', async () => {
    const { homeMediaSource, homeImageCandidates } = await import('./homeMedia');
    const media = { type: 'video', uploadedFile: { url: '/uploads/movie.mp4' }, thumbnailUrl: '/uploads/poster.jpg' };
    expect(homeMediaSource(media)).toBe(API + '/uploads/movie.mp4');
    expect(homeImageCandidates(media)).toEqual([API + '/uploads/poster.jpg']);
    expect(homeImageCandidates({ type: 'VIDEO', url: '/uploads/movie.mp4' })).toEqual([]);
  });
  it('ignores invalid sources and uses the next valid candidate', async () => {
    const { homeImageCandidates, homeMediaSource } = await import('./homeMedia');
    expect(homeImageCandidates({ uploadedFile: { url: 'javascript:alert(1)' }, thumbnailUrl: '/uploads/photo.jpg' })).toEqual([API + '/uploads/photo.jpg']);
    expect(homeMediaSource({ uploadedFile: { url: ' ' }, url: 'image.png' })).toBe(API + '/uploads/image.png');
    expect(homeImageCandidates(null)).toEqual([]);
  });
});
