import { describe, expect, it } from 'vitest';
import { isReelTap, isReelDoubleTap, reelPreload, reelIndexAtScroll, nextReelLike } from './reelPlayback';

describe('Reels feed playback rules', () => {
  it('preloads the next reel, retains the previous, and mounts no distant players', () => {
    expect(Array.from({length: 7}, (_, i) => reelPreload(i, 3, false))).toEqual([null,null,'metadata','auto','auto',null,null]);
    expect(reelPreload(4, 3, true)).toBe('metadata');
    expect(reelPreload(0, 0, true)).toBe('auto');
  });
  it('uses the nearest snap position, including resize and out-of-range values', () => {
    expect(reelIndexAtScroll(349, 700, 5)).toBe(0);
    expect(reelIndexAtScroll(351, 700, 5)).toBe(1);
    expect(reelIndexAtScroll(1400, 700, 5)).toBe(2);
    expect(reelIndexAtScroll(9999, 700, 5)).toBe(4);
    expect(reelIndexAtScroll(-15, 700, 5)).toBe(0);
    expect(reelIndexAtScroll(500, 0, 5)).toBe(0);
  });
  it('rejects vertical and horizontal swipes, slow presses and distant double taps', () => {
    const first = {x: 100,y: 100,at: 1000};
    expect(isReelTap(first, {x: 102,y: 104,at: 1100})).toBe(true);
    expect(isReelTap(first, {x: 100,y: 170,at: 1100})).toBe(false);
    expect(isReelTap(first, {x: 160,y: 100,at: 1100})).toBe(false);
    expect(isReelTap(first, {x: 100,y: 100,at: 1500})).toBe(false);
    expect(isReelDoubleTap(first, {x: 108,y: 106,at: 1200})).toBe(true);
    expect(isReelDoubleTap(first, {x: 200,y: 100,at: 1200})).toBe(false);
    expect(isReelDoubleTap(first, {x: 100,y: 100,at: 1300})).toBe(false);
  });
  it('never unlikes on repeated double taps, while heart button can unlike', () => {
    expect(nextReelLike(false, true)).toBe(true);
    expect(nextReelLike(true, true)).toBeNull();
    expect(nextReelLike(true, false)).toBe(false);
    expect(nextReelLike(false, false)).toBe(true);
  });
});
