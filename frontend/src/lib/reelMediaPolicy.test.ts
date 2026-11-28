import { describe, expect, it } from 'vitest';
import { shouldMountReelVideo } from './reelMediaPolicy';

describe('Reels media window', () => {
  const indices = Array.from({ length: 20 }, (_, i) => i);
  it('limits normal playback to active and adjacent media', () => {
    expect(indices.filter(i => shouldMountReelVideo(i, 8, true, false))).toEqual([7, 8, 9]);
    expect(indices.filter(i => shouldMountReelVideo(i, 0, true, false))).toEqual([0, 1]);
  });
  it('mounts only active video on data saver and none while hidden', () => {
    expect(indices.filter(i => shouldMountReelVideo(i, 8, true, true))).toEqual([8]);
    expect(indices.filter(i => shouldMountReelVideo(i, 8, false, false))).toEqual([]);
    expect(shouldMountReelVideo(0, -1, true, false)).toBe(false);
  });
});
