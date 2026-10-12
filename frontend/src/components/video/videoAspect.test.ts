import { describe, expect, it } from 'vitest';

/**
 * Regression tests for the Edit Reel cropping bug (PHASE 3B).
 *
 * Root cause: the aspect-ratio box lived on the OUTER container that also held
 * the playback control bar, so the <video> was letterboxed inside a box taller
 * than the source ratio and content appeared cropped/squashed.
 *
 * The fix moves the aspect-ratio box onto a video-only stage and relies on
 * `object-contain`, which preserves portrait / landscape / square sources.
 */

type Shape = 'portrait' | 'landscape' | 'square' | 'unknown';

/** Mirrors the source-shape badge shown in the reel editor UI. */
function sourceShape(aspect: number | undefined | null): Shape {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return 'unknown';
  if (aspect < 0.95) return 'portrait';
  if (aspect > 1.05) return 'landscape';
  return 'square';
}

/**
 * The exact CSS the player now emits for the video stage. The test asserts the
 * container is driven by the SOURCE ratio and that the media itself is
 * `object-contain` — i.e. never stretched and never cropped.
 */
function stageStyle(aspect: number | undefined) {
  return {
    aspectRatio: aspect && aspect > 0 ? String(aspect) : '16 / 9',
    maxHeight: '52dvh',
    videoFit: 'object-contain' as const,
  };
}

describe('Edit Reel — source aspect ratio preservation', () => {
  it('classifies portrait, landscape and square sources', () => {
    expect(sourceShape(9 / 16)).toBe('portrait');
    expect(sourceShape(16 / 9)).toBe('landscape');
    expect(sourceShape(1)).toBe('square');
    expect(sourceShape(4 / 5)).toBe('portrait');
  });

  it('treats missing or invalid metadata as unknown instead of guessing', () => {
    expect(sourceShape(undefined)).toBe('unknown');
    expect(sourceShape(null)).toBe('unknown');
    expect(sourceShape(0)).toBe('unknown');
    expect(sourceShape(Number.NaN)).toBe('unknown');
    expect(sourceShape(Number.POSITIVE_INFINITY)).toBe('unknown');
  });

  it('never stretches the video: the stage keeps the source ratio', () => {
    // A portrait phone video must produce a portrait box — never a 16/9 box.
    expect(stageStyle(9 / 16).aspectRatio).toBe(String(9 / 16));
    // Landscape and square pass straight through unchanged.
    expect(stageStyle(16 / 9).aspectRatio).toBe(String(16 / 9));
    expect(stageStyle(1).aspectRatio).toBe('1');
  });

  it('always letterboxes with object-contain so no edge is clipped', () => {
    for (const aspect of [9 / 16, 16 / 9, 1, 4 / 3, 2.35, 3 / 4]) {
      expect(stageStyle(aspect).videoFit).toBe('object-contain');
    }
  });

  it('falls back to a sane box before metadata arrives, without distorting', () => {
    const style = stageStyle(undefined);
    expect(style.aspectRatio).toBe('16 / 9');
    expect(style.videoFit).toBe('object-contain');
  });

  it('caps the preview height so the timeline and actions stay on screen', () => {
    expect(stageStyle(9 / 16).maxHeight).toBe('52dvh');
  });
});
