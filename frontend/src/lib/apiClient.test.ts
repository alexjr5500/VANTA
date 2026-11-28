import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPost, invalidateCache, getCacheStats } from './apiClient';

/** Build a minimal Response-like object the client's readJson() understands. */
const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('apiClient retry policy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression: a structured 500 (e.g. a Prisma schema/DB failure surfaced by
  // the login endpoint) is deterministic. Retrying it 3x only delayed the real
  // message and, under concurrent load, pushed clients into backoff long enough
  // that the UI reported "Check your connection and try again" instead of the
  // actual server error. It must now surface immediately with the server's
  // message and hit the network exactly once.
  it('does NOT retry a deterministic 500 and preserves the server message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: 'Unable to complete login. Please try again.' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost('/api/auth/login', { identifier: 'a@b.c', password: 'x' })).rejects.toMatchObject({
      statusCode: 500,
      message: 'Unable to complete login. Please try again.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 4xx must never be retried (unchanged behaviour, pinned so it stays that way).
  it('does NOT retry a 400 client error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'Email/Username and password are required' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost('/api/auth/login', {})).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });


  it('skipCache bypasses cached responses and does not populate the shared cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { version: 1 }))
      .mockResolvedValueOnce(jsonResponse(200, { version: 2 }))
      .mockResolvedValueOnce(jsonResponse(200, { version: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/api/homes/cache-bypass-regression')).resolves.toEqual({ version: 1 });
    await expect(apiGet('/api/homes/cache-bypass-regression', undefined, { skipCache: true })).resolves.toEqual({ version: 2 });
    // The bypassed response must not replace the normal cache entry.
    await expect(apiGet('/api/homes/cache-bypass-regression')).resolves.toEqual({ version: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ cache: 'no-store' });
  });

  it('skipCache requests do not join a shared in-flight GET request', async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>(resolve => { resolveFirst = resolve; });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(jsonResponse(200, { source: 'fresh' }));
    vi.stubGlobal('fetch', fetchMock);

    const cachedRequest = apiGet('/api/homes/inflight-bypass-regression');
    const freshRequest = apiGet('/api/homes/inflight-bypass-regression', undefined, { skipCache: true });

    await expect(freshRequest).resolves.toEqual({ source: 'fresh' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveFirst(jsonResponse(200, { source: 'shared' }));
    await expect(cachedRequest).resolves.toEqual({ source: 'shared' });
  });

  it('does not replay a non-idempotent withdrawal after a gateway failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, {error:'Gateway unavailable'}));
    vi.stubGlobal('fetch',fetchMock);
    await expect(apiPost('/api/wallets/withdraw',{amount:10},undefined,undefined,{noRetry:true})).rejects.toMatchObject({statusCode:503});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  // Gateway/time-out style 5xx are transient and remain retryable.
  it('retries a transient 503 and succeeds on the next attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'Bad Gateway' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiPost<{ ok: boolean }>('/api/auth/login', { a: 1 });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);
});

describe('session-safe request efficiency', () => {
  beforeEach(() => invalidateCache());
  afterEach(() => { invalidateCache(); vi.unstubAllGlobals(); });

  it('does not share cached or pending responses across tokens', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { owner: 'a' }))
      .mockResolvedValueOnce(jsonResponse(200, { owner: 'b' }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([apiGet('/api/feed/home', 'a'), apiGet('/api/feed/home', 'b')]);
    expect(a).toEqual({ owner: 'a' });
    expect(b).toEqual({ owner: 'b' });
    expect(await apiGet('/api/feed/home', 'a')).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deduplicates immediately for the same token without a batching delay', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const a = apiGet('/api/feed/home', 'a');
    const b = apiGet('/api/feed/home', 'a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await Promise.all([a, b])).toEqual([{ ok: true }, { ok: true }]);
    expect(getCacheStats().pendingRequests).toBe(0);
  });

  it('does not repopulate an invalidated cache with a stale in-flight response', async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise<Response>(r => { resolve = r; }))
      .mockResolvedValueOnce(jsonResponse(200, { value: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const stale = apiGet('/api/feed/home', 'a');
    invalidateCache();
    const fresh = apiGet('/api/feed/home', 'a');
    expect(await fresh).toEqual({ value: 2 });
    resolve(jsonResponse(200, { value: 1 }));
    await stale;
    expect(await apiGet('/api/feed/home', 'a')).toEqual({ value: 2 });
  });

  it('does not share caller-owned cancellation with another request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { value: 1 }))
      .mockResolvedValueOnce(jsonResponse(200, { value: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const [a, b] = await Promise.all([apiGet('/api/feed/home', 'a', { signal: controller.signal }), apiGet('/api/feed/home', 'a')]);
    expect(a).toEqual({ value: 1 });
    expect(b).toEqual({ value: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
