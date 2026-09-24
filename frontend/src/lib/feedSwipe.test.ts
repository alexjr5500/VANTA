import { describe, expect, test } from 'vitest';
import {
  feedFromSwipe,
  settleFeedSwipe,
  startFeedSwipe,
  trackFeedSwipe,
} from './feedSwipe';

const ORDER = ['for-you', 'following', 'trending'];

describe('trackFeedSwipe', () => {
  test('leaves small horizontal jitter unclassified (dead zone)', () => {
    const state = trackFeedSwipe(startFeedSwipe(), 14, 2);
    expect(state.locked).toBe('none');
    expect(settleFeedSwipe(state)).toBe(0);
  });

  test('locks vertical gestures and never switches feeds', () => {
    const state = trackFeedSwipe(startFeedSwipe(), 5, 30);
    expect(state.locked).toBe('vertical');
    expect(settleFeedSwipe(state)).toBe(0);
  });

  test('locks horizontal only when sideways clearly dominates', () => {
    const state = trackFeedSwipe(startFeedSwipe(), 30, 6);
    expect(state.locked).toBe('horizontal');
  });

  test('keeps diagonal gestures ambiguous instead of double-triggering', () => {
    // 24px vertical exceeds the dead zone before a 28px horizontal could win,
    // so the gesture stays vertical (a reel scroll), never a tab switch.
    const state = trackFeedSwipe(startFeedSwipe(), 28, 24);
    expect(state.locked).toBe('vertical');
    expect(settleFeedSwipe(state)).toBe(0);
  });

  test('a vertical lock persists even if the finger later moves sideways', () => {
    let state = trackFeedSwipe(startFeedSwipe(), 4, 40);
    state = trackFeedSwipe(state, 80, 44);
    expect(state.locked).toBe('vertical');
    expect(settleFeedSwipe(state)).toBe(0);
  });

  test('a horizontal lock tracks the latest travel and survives subsequent moves', () => {
    const state = trackFeedSwipe(trackFeedSwipe(startFeedSwipe(), -40, -4), -70, -8);
    expect(state.locked).toBe('horizontal');
    expect(settleFeedSwipe(state)).toBe(1); // traveled left → next feed
  });
});

describe('settleFeedSwipe', () => {
  test('requires the full SWIPE_MIN distance before switching', () => {
    const state = trackFeedSwipe(startFeedSwipe(), 50, 3);
    expect(state.locked).toBe('horizontal');
    expect(settleFeedSwipe(state)).toBe(0);
  });

  test('swipe LEFT returns +1 (next feed)', () => {
    const state = trackFeedSwipe(startFeedSwipe(), -70, 2);
    expect(settleFeedSwipe(state)).toBe(1);
  });

  test('swipe RIGHT returns -1 (previous feed)', () => {
    const state = trackFeedSwipe(startFeedSwipe(), 70, 2);
    expect(settleFeedSwipe(state)).toBe(-1);
  });
});

describe('feedFromSwipe', () => {
  test('left from For You advances to Following, then Trending, clamped at the end', () => {
    expect(feedFromSwipe(ORDER, 'for-you', 1)).toBe('following');
    expect(feedFromSwipe(ORDER, 'following', 1)).toBe('trending');
    expect(feedFromSwipe(ORDER, 'trending', 1)).toBe('trending');
  });

  test('right from Trending returns to Following, then For You, clamped at the start', () => {
    expect(feedFromSwipe(ORDER, 'trending', -1)).toBe('following');
    expect(feedFromSwipe(ORDER, 'following', -1)).toBe('for-you');
    expect(feedFromSwipe(ORDER, 'for-you', -1)).toBe('for-you');
  });

  test('direction 0 never changes the current feed', () => {
    expect(feedFromSwipe(ORDER, 'following', 0)).toBe('following');
  });
});