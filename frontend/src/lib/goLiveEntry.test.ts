import { describe, expect, it } from 'vitest';
import {
  GO_LIVE_ROUTE,
  isGoLiveRoute,
  NON_LIVE_RECORD_ROUTES,
  routeForCreateAction,
} from './goLiveEntry';

/**
 * Regression guard for the core Go Live routing acceptance criterion:
 *
 *   + Create → Go Live → VANTA Live Pre-Stream screen   (required)
 *   + Create → Go Live → Video Recording screen         (forbidden)
 *
 * The "+" Create hub and composer quick-actions route through
 * routeForCreateAction(), so this test locks in the invariant at the source of
 * truth instead of relying on each call-site remembering it.
 */
describe('Go Live routing (never opens the video-recording flow)', () => {
  it('routes every Go Live entry to the dedicated /live/go-live pre-stream screen', () => {
    expect(GO_LIVE_ROUTE).toBe('/live/go-live');
    // "+ Create hub" entry uses the 'livestream' action id.
    expect(routeForCreateAction('livestream')).toBe('/live/go-live');
    // The composer quick-action uses the 'live' action id.
    expect(routeForCreateAction('live')).toBe('/live/go-live');
    expect(isGoLiveRoute(routeForCreateAction('livestream'))).toBe(true);
  });

  it('never resolves Go Live to a video-recording / media-capture route', () => {
    expect(NON_LIVE_RECORD_ROUTES.length).toBeGreaterThan(0);
    for (const recordingRoute of NON_LIVE_RECORD_ROUTES) {
      expect(GO_LIVE_ROUTE).not.toBe(recordingRoute);
      expect(isGoLiveRoute(recordingRoute)).toBe(false);
    }
  });

  it('returns no route for non-navigational create actions', () => {
    // 'post' / 'story' / 'reel' open their own modals — they must not be
    // mistaken for the Go Live destination.
    expect(routeForCreateAction('post')).toBe('');
    expect(routeForCreateAction('story')).toBe('');
    expect(routeForCreateAction('reel')).toBe('');
    expect(routeForCreateAction('unknown')).toBe('');
  });
});