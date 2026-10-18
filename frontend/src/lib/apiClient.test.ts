import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPost } from './apiClient';

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
