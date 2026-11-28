import { mapCurrentReelHls } from '../services/reel-hls-mapping';

describe('Reel HLS mapping', () => {
  it('returns the HLS derivative matching the currently published MP4', () => {
    const result = mapCurrentReelHls(
      [{ id: 'reel-1', videoUrl: 'https://cdn.example/new.mp4' }],
      [
        { recordId: 'reel-1', url: 'https://cdn.example/old.mp4', hlsUrl: 'https://cdn.example/old.m3u8' },
        { recordId: 'reel-1', url: 'https://cdn.example/new.mp4', hlsUrl: 'https://cdn.example/new.m3u8' },
      ],
    );
    expect(result.get('reel-1')).toBe('https://cdn.example/new.m3u8');
  });

  it('never sends another Reel a stream and ignores unlinked or absent derivatives', () => {
    const result = mapCurrentReelHls(
      [
        { id: 'reel-1', videoUrl: 'https://cdn.example/one.mp4' },
        { id: 'reel-2', videoUrl: 'https://cdn.example/two.mp4' },
      ],
      [
        { recordId: 'reel-2', url: 'https://cdn.example/one.mp4', hlsUrl: 'https://cdn.example/one.m3u8' },
        { recordId: null, url: 'https://cdn.example/one.mp4', hlsUrl: 'https://cdn.example/one.m3u8' },
        { recordId: 'reel-1', url: 'https://cdn.example/one.mp4', hlsUrl: null },
      ],
    );
    expect([...result.keys()]).toEqual([]);
  });

  it('never returns a stream when the published video URL is absent', () => {
    const result = mapCurrentReelHls(
      [{ id: 'reel-empty', videoUrl: null }],
      [{ recordId: 'reel-empty', url: '', hlsUrl: 'https://cdn.example/old.m3u8' }],
    );
    expect(result.size).toBe(0);
  });

  it('handles multiple Reels without losing correct matches', () => {
    const result = mapCurrentReelHls(
      [{ id: 'a', videoUrl: '/uploads/a.mp4' }, { id: 'b', videoUrl: '/uploads/b.mp4' }],
      [
        { recordId: 'b', url: '/uploads/b.mp4', hlsUrl: 'https://cdn.example/b.m3u8' },
        { recordId: 'a', url: '/uploads/a.mp4', hlsUrl: 'https://cdn.example/a.m3u8' },
      ],
    );
    expect(Object.fromEntries(result)).toEqual({
      a: 'https://cdn.example/a.m3u8',
      b: 'https://cdn.example/b.m3u8',
    });
  });
});
