// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DAILY_STATUS_LIMIT_FRONTEND,
  MAX_STATUS_MEDIA_FILES,
  storyMediaCapacity,
  storyMediaKindOf,
  toUserFacingStoryError,
  validateStoryMediaFile,
} from './storyMedia';

const imageFile = (name = 'photo.jpg', type = 'image/jpeg', size = 1024): File =>
  new File(['x'.repeat(Math.max(1, size))], name, { type });

const videoFile = (name = 'clip.mp4', type = 'video/mp4', size = 1024): File =>
  new File(['x'.repeat(Math.max(1, size))], name, { type });

describe('storyMedia multi-file selection rules', () => {
  it('detects image and video kinds from MIME type and extension', () => {
    expect(storyMediaKindOf(imageFile())).toBe('image');
    expect(storyMediaKindOf(imageFile('pic.webp', 'image/webp'))).toBe('image');
    expect(storyMediaKindOf(imageFile('pic.gif', 'image/gif'))).toBe('image');
    expect(storyMediaKindOf(imageFile('pic.avif', 'image/avif'))).toBe('image');
    expect(storyMediaKindOf(videoFile())).toBe('video');
    expect(storyMediaKindOf(videoFile('clip.webm', 'video/webm'))).toBe('video');
    expect(storyMediaKindOf(videoFile('clip.mov', 'video/quicktime'))).toBe('video');
    // Extension fallback when the browser reports an unknown MIME.
    expect(storyMediaKindOf({ name: 'photo.jpg', type: '' })).toBe('image');
    expect(storyMediaKindOf({ name: 'clip.mp4', type: 'application/octet-stream' })).toBe('video');
    expect(storyMediaKindOf({ name: 'notes.txt', type: 'text/plain' })).toBeNull();
    expect(storyMediaKindOf({ name: 'audio.mp3', type: 'audio/mpeg' })).toBeNull();
  });

  it('accepts valid images and videos', () => {
    expect(validateStoryMediaFile(imageFile())).toBeNull();
    expect(validateStoryMediaFile(videoFile())).toBeNull();
    expect(validateStoryMediaFile(null)).toContain('No file');
  });

  it('rejects unsupported files with a human-friendly message', () => {
    const message = validateStoryMediaFile(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(message).toContain('Unsupported file');
    expect(message).toContain('photo');
    expect(message).toContain('video');
  });

  it('rejects oversized images and videos with clear size limits', () => {
    const bigImage = validateStoryMediaFile(imageFile('huge.jpg', 'image/jpeg', 16 * 1024 * 1024));
    expect(bigImage).toContain('15MB');

    const bigVideo = validateStoryMediaFile(videoFile('huge.mp4', 'video/mp4', 101 * 1024 * 1024));
    expect(bigVideo).toContain('100MB');

    // Boundary sizes are allowed.
    expect(validateStoryMediaFile(imageFile('ok.jpg', 'image/jpeg', 15 * 1024 * 1024))).toBeNull();
    expect(validateStoryMediaFile(videoFile('ok.mp4', 'video/mp4', 100 * 1024 * 1024))).toBeNull();
  });

  it('caps every Status at the production max of 7 files', () => {
    expect(MAX_STATUS_MEDIA_FILES).toBe(7);
    expect(storyMediaCapacity({ verified: true })).toBe(MAX_STATUS_MEDIA_FILES);
    expect(storyMediaCapacity({ verified: true, usedToday: 4, limit: 7 })).toBe(MAX_STATUS_MEDIA_FILES);
  });

  it('reflects remaining daily quota for standard users', () => {
    expect(storyMediaCapacity({ verified: false, usedToday: 0, limit: 7 })).toBe(7);
    expect(storyMediaCapacity({ verified: false, usedToday: 3, limit: 7 })).toBe(4);
    expect(storyMediaCapacity({ verified: false, usedToday: 7, limit: 7 })).toBe(0);
    // Never goes negative.
    expect(storyMediaCapacity({ verified: false, usedToday: 99, limit: 7 })).toBe(0);
  });

  it('uses the known daily quota as the default limit', () => {
    expect(DAILY_STATUS_LIMIT_FRONTEND).toBe(7);
    expect(storyMediaCapacity({ verified: false, usedToday: 2 })).toBe(5);
  });

  it('maps backend/API failures to user-friendly messages', () => {
    expect(toUserFacingStoryError({ statusCode: 401, message: 'Unauthorized' })).toContain('session');
    expect(toUserFacingStoryError(new Error("You've reached today's Status limit of 7 posts."))).toContain('limit');
    expect(toUserFacingStoryError(new Error('Network error while uploading. Check your connection.'))).toContain('network');
    expect(toUserFacingStoryError({ statusCode: 499, message: 'Upload cancelled' })).toContain('cancelled');
    expect(toUserFacingStoryError(new Error('something else'))).toContain('something else');
  });
});