import { describe, expect, it } from 'vitest';
import { estimatedStatusTrimSize, statusTrimBitrate } from './videoTrim';

describe('Status trim size budget', () => {
  it('reduces the estimate for a shorter clip instead of showing the original size', () => {
    const source = 8 * 1024 * 1024;
    expect(estimatedStatusTrimSize(source, 60, 30)).toBeLessThan(source / 2);
    expect(estimatedStatusTrimSize(source, 60, 60)).toBe(source);
    expect(estimatedStatusTrimSize(source, 60, 15)).toBeLessThan(estimatedStatusTrimSize(source, 60, 30));
  });
  it('caps higher bitrate inputs and preserves an explicit audio budget', () => {
    const budget = statusTrimBitrate(100 * 1024 * 1024, 10);
    expect(budget.videoBitsPerSecond + budget.audioBitsPerSecond).toBeLessThanOrEqual(3_000_000);
    expect(budget.audioBitsPerSecond).toBeGreaterThanOrEqual(32_000);
    expect(statusTrimBitrate(1, 100).videoBitsPerSecond).toBeGreaterThan(0);
  });
});
