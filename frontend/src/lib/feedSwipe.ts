'use client';

// ============================================================================
// feedSwipe
// ---------
// Pure horizontal-swipe classification for the VANTA Reels feed. The feed
// scrolls VERTICALLY between videos, so a gesture may only become a feed
// switch when the sideways displacement clearly dominates — everything else
// (vertical swipes, taps, diagonal undershoots) must stay native.
//
// Direction convention: the feed order is [For You, Following, Trending].
// Swiping LEFT moves to the NEXT feed (+1), swiping RIGHT moves BACK (-1),
// mirroring the left→right tab order. `settleFeedSwipe` returns -1 | 0 | 1.
// ============================================================================

export interface FeedSwipeState {
  /** 'horizontal' = the feed-swipe handler owns the gesture. */
  locked: 'none' | 'horizontal' | 'vertical';
  /** Net horizontal travel since the touch started (px). */
  travelX: number;
}

export const FEED_SWIPE = {
  /** px of dominant travel before a gesture is classified at all. */
  LOCK_DRAG: 20,
  /** px of horizontal travel required to actually switch feeds. */
  SWIPE_MIN: 56,
  /** Horizontal must beat vertical by this ratio before it can win. */
  DOMINANCE_RATIO: 1.5,
} as const;

export function startFeedSwipe(): FeedSwipeState {
  return { locked: 'none', travelX: 0 };
}

/**
 * Classify a moving touch and return the updated gesture state:
 * - 'vertical': the y-displacement exceeded the dead zone first — this is a
 *   native vertical reel scroll and must be left to the browser untouched.
 * - 'horizontal': the x-displacement dominates (past the dead zone and the
 *   dominance ratio) — the reel feed swipe handler should consume these moves.
 * - 'none': still ambiguous (short/diagonal) — keep listening.
 */
export function trackFeedSwipe(state: FeedSwipeState, dx: number, dy: number): FeedSwipeState {
  if (state.locked === 'horizontal') return { locked: 'horizontal', travelX: dx };
  if (state.locked === 'vertical') return state;
  if (Math.abs(dy) > FEED_SWIPE.LOCK_DRAG) return { locked: 'vertical', travelX: state.travelX };
  if (Math.abs(dx) > FEED_SWIPE.LOCK_DRAG && Math.abs(dx) > Math.abs(dy) * FEED_SWIPE.DOMINANCE_RATIO) {
    return { locked: 'horizontal', travelX: dx };
  }
  return state;
}

/** Resolve the gesture at touchdown: -1 (swipe right/back), 0 (no switch), 1 (swipe left/next). */
export function settleFeedSwipe(state: FeedSwipeState): -1 | 0 | 1 {
  if (state.locked !== 'horizontal' || Math.abs(state.travelX) < FEED_SWIPE.SWIPE_MIN) return 0;
  return state.travelX < 0 ? 1 : -1;
}

/** Apply a settled swipe direction to an ordered tab list, clamped at both ends. */
export function feedFromSwipe<T>(order: readonly T[], current: T, direction: -1 | 0 | 1): T {
  if (direction === 0) return current;
  const index = order.indexOf(current);
  const target = order[Math.max(0, Math.min(order.length - 1, index + direction))];
  return target ?? current;
}