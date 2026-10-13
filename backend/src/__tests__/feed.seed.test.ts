/**
 * Feed variety — seeded, deterministic shuffle of discovery buckets.
 *
 * Guarantees the homepage can produce a DIFFERENT eligible ordering on refresh
 * (new seed) while staying STABLE and duplicate-free within a feed session
 * (same seed), without any full-table random sort.
 */
import { seededShuffle } from '../services/feed.service';

describe('seededShuffle (home feed variety)', () => {
  const items = Array.from({ length: 12 }, (_, i) => `item-${i}`);

  it('is deterministic for the same seed (stable pagination within a session)', () => {
    const a = seededShuffle(items, 'seed-abc');
    const b = seededShuffle(items, 'seed-abc');
    expect(a).toEqual(b);
  });

  it('produces a different order for a different seed (variety on refresh)', () => {
    const a = seededShuffle(items, 'seed-abc');
    const b = seededShuffle(items, 'seed-xyz');
    expect(a).not.toEqual(b);
  });

  it('preserves the exact set of items (no drops, no duplicates)', () => {
    const shuffled = seededShuffle(items, 'seed-abc');
    expect([...shuffled].sort()).toEqual([...items].sort());
    expect(new Set(shuffled).size).toBe(items.length);
  });

  it('does not mutate the input array', () => {
    const input = [...items];
    seededShuffle(input, 'seed-abc');
    expect(input).toEqual(items);
  });

  it('handles an empty seed and small arrays without throwing', () => {
    expect(seededShuffle(items, '')).toHaveLength(items.length);
    expect(seededShuffle([], 'seed')).toEqual([]);
    expect(seededShuffle(['only'], 'seed')).toEqual(['only']);
  });
});
