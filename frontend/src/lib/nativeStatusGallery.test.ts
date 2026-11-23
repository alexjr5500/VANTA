import { describe, expect, it } from 'vitest';
import { parseNativeGallery } from './nativeStatusGallery';

const origin = 'https://vanta-nu.vercel.app';
const nonce = 'fa17caaa-20d1-4000-9000-fb852af70b3d';
const prefix = origin + '/__vanta_native_gallery/' + nonce + '/';

describe('native Status gallery permission and media responses', () => {
  it('validates legitimate local gallery image/video entries', () => {
    const item = { id: 'i42', name: 'photo.jpg', mimeType: 'image/jpeg', size: 8000,
      thumbnailUrl: prefix + 'thumb/i42', mediaUrl: prefix + 'full/i42' };
    const result = parseNativeGallery(JSON.stringify({ status: 'ready', items: [item] }), origin, nonce);
    expect(result.status).toBe('ready');
    expect(result.items).toEqual([item]);
  });

  it('never leaks photos before permission', () => {
    const result = parseNativeGallery(JSON.stringify({
      status: 'permission', items: [{ id: 'i42', name: 'secret.jpg' }],
    }), origin, nonce);
    expect(result).toEqual({ status: 'permission', items: [] });
  });

  it('rejects forged non-local media URLs', () => {
    const result = parseNativeGallery(JSON.stringify({ status: 'ready', items: [{
      id: 'i42', name: 'photo.jpg', mimeType: 'image/jpeg', size: 12,
      thumbnailUrl: 'https://other.example/photo', mediaUrl: prefix + 'full/i42',
    }] }), origin, nonce);
    expect(result.items).toEqual([]);
  });

  it('handles malformed data and clips untrusted result count', () => {
    expect(parseNativeGallery('{bad', origin, nonce)).toEqual({ status: 'error', items: [] });
    expect(parseNativeGallery('null', origin, nonce)).toEqual({ status: 'error', items: [] });
  });
});
