import { feedPageKey, finishCursorPage, runFeedQueries } from '../services/feed-read-optimization';

describe('feed read optimization', () => {
  it('isolates cache keys by cursor, limit, seed and viewer, even for long untrusted cursors', () => {
    const a = 'feed:user-a:latest';
    const keys = [feedPageKey(a, undefined, 20), feedPageKey(a, undefined, 5),
      feedPageKey(a, 'latest', 20), feedPageKey(a, undefined, 20, 'default'),
      feedPageKey(a, 'x'.repeat(300), 20), feedPageKey(a, 'x'.repeat(300) + 'y', 20),
      feedPageKey('feed:user-b:latest', undefined, 20)];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(k => k.length < 256)).toBe(true);
    expect(keys[0]).toBe(feedPageKey(a, undefined, 20));
  });
  it('uses last delivered row as next cursor, retaining lookahead for next query', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(finishCursorPage(rows, 2)).toBe('b');
    expect(rows.map(r => r.id)).toEqual(['a', 'b']);
    expect(finishCursorPage(rows, 2)).toBeUndefined();
  });
  it('runs seven independent reads in three bounded stages with stable output order', async () => {
    let active = 0, peak = 0;
    const result = await runFeedQueries(Array.from({ length: 7 }, (_, i) => async () => {
      active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => setImmediate(resolve));
      active--; return i;
    }));
    expect(peak).toBe(3);
    expect(result).toEqual([0,1,2,3,4,5,6]);
  });
  it('does not launch subsequent stages after a failed read', async () => {
    const later = jest.fn(async () => 4);
    await expect(runFeedQueries([async () => { throw Error('unavailable'); }, async () => 1, async () => 2, later])).rejects.toThrow('unavailable');
    expect(later).not.toHaveBeenCalled();
  });
});
