import { describe, expect, it } from 'vitest';
import { chooseReelPlaybackSource } from './reelPlaybackSource';

describe('Reel HLS playback source selection', () => {
  const mp4 = 'https://cdn.example/reel.mp4';
  const hls = 'https://cdn.example/reel.m3u8';

  it('uses HLS only when the browser supports native playback', () => {
    expect(chooseReelPlaybackSource(mp4, hls, true, false)).toBe(hls);
    expect(chooseReelPlaybackSource(mp4, hls, false, false)).toBe(mp4);
  });

  it('falls back to the original MP4 after HLS failure', () => {
    expect(chooseReelPlaybackSource(mp4, hls, true, true)).toBe(mp4);
  });

  it('retains MP4 for unprocessed Reels', () => {
    expect(chooseReelPlaybackSource(mp4, null, true, false)).toBe(mp4);
    expect(chooseReelPlaybackSource(mp4, undefined, true, false)).toBe(mp4);
  });
});
