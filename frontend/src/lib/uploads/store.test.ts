// @vitest-environment node
/**
 * Coverage for the background upload manager (Story/Reel publishing).
 * Verifies the job lifecycle (starting -> uploading -> processing -> completed),
 * that the finalize call only happens AFTER the resumable chunk pipeline
 * completes, and that byte-based progress reaches 100% on success.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiGet, apiPost, invalidateCache } from '@/lib/apiClient';
import { notifyStoryFeedChanged } from '@/lib/storyEvents';

vi.mock('@/lib/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  invalidateCache: vi.fn(),
}));
vi.mock('@/lib/storyEvents', () => ({
  notifyStoryFeedChanged: vi.fn(),
}));

/** Minimal XMLHttpRequest stub: fires a successful `load` on send(). */
class FakeXHR {
  upload = { addEventListener: vi.fn() };
  status = 200;
  responseText = '{}';
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};
  open() {}
  setRequestHeader(_name: string, _value: string) {}
  send() {
    for (const fn of this.listeners['load'] ?? []) fn();
  }
  addEventListener(type: string, fn: (...args: any[]) => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener() {}
  abort() {}
}
vi.stubGlobal('XMLHttpRequest', FakeXHR);

async function loadStore() {
  const mod = await import('./store');
  return mod;
}

describe('uploadManager store (background Story/Reel publishing)', () => {
  let store: Awaited<ReturnType<typeof loadStore>>;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    store = await loadStore();
    (apiPost as any).mockImplementation((path: string) => {
      if (path.includes('/uploading')) return Promise.resolve({});
      if (path.includes('/chunk/init')) return Promise.resolve({ sessionId: 'sess-1' });
      if (path.includes('/chunk/complete')) return Promise.resolve({ id: 'file-1', url: '/uploads/x.mp4' });
      if (path.includes('/finalize')) return Promise.resolve({});
      return Promise.resolve({});
    });
    (apiGet as any).mockResolvedValue({ status: 'ACTIVE', receivedIndexes: [], complete: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test('publishes a Story in the background and only finalizes after the upload completes', async () => {
    const file = new File(['hello-world'], 'clip.mp4', { type: 'video/mp4' });
    const job = store.startUpload({
      kind: 'story',
      file,
      draftId: 'story-1',
      token: 'tok',
      meta: { mimeType: 'video/mp4', caption: 'hi' },
    });

    await vi.waitFor(() => {
      const current = store.getJobs().find((j) => j.id === job.id);
      if (current) expect(current.phase).toBe('completed');
    });

    const completed = store.getJobs().find((j) => j.id === job.id)!;
    expect(completed.progress).toBe(100);
    expect(completed.bytesSent).toBe(completed.bytesTotal);
    expect(apiPost).toHaveBeenCalledWith(`/api/stories/story-1/uploading`, {}, 'tok');
    expect(apiPost).toHaveBeenCalledWith('/api/upload/chunk/init', expect.objectContaining({ category: 'story', recordId: 'story-1' }), 'tok');
    expect(apiPost).toHaveBeenCalledWith('/api/upload/chunk/complete', expect.objectContaining({ sessionId: 'sess-1' }), 'tok');
    expect(apiPost).toHaveBeenCalledWith(`/api/stories/story-1/finalize`, expect.objectContaining({ fileId: 'file-1' }), 'tok');
    expect(notifyStoryFeedChanged).toHaveBeenCalled();
  });

  test('marks the job failed and calls the server fail endpoint when the upload errors', async () => {
    (apiPost as any).mockImplementation((path: string) => {
      if (path.includes('/chunk/init')) return Promise.reject(new Error('File type is not allowed'));
      return Promise.resolve({});
    });
    const file = new File(['abc'], 'clip.mp4', { type: 'video/mp4' });
    const job = store.startUpload({ kind: 'reel', file, draftId: 'reel-1', token: 'tok', meta: { mimeType: 'video/mp4' } });

    await vi.waitFor(() => {
      const current = store.getJobs().find((j) => j.id === job.id);
      if (current) expect(current.phase).toBe('failed');
    });

    const failed = store.getJobs().find((j) => j.id === job.id)!;
    expect(failed.error).toContain('not allowed');
    expect(apiPost).toHaveBeenCalledWith(`/api/reels/reel-1/fail`, {}, 'tok');
  });

  test('retries a failed Status using its original file and token, then publishes it', async () => {
    let initAttempts = 0;
    (apiPost as any).mockImplementation((route: string, _payload: unknown, token: string) => {
      if (route.includes('/chunk/init')) {
        initAttempts += 1;
        if (initAttempts === 1) return Promise.reject(new Error('Temporary upload outage'));
        return Promise.resolve({ sessionId: 'retry-session' });
      }
      if (route.includes('/chunk/complete')) return Promise.resolve({ id: 'uploaded-photo', url: '/uploads/photo.jpg' });
      return Promise.resolve({});
    });

    const file = new File(['photo-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const job = store.startUpload({
      kind: 'story', file, draftId: 'retry-story', token: 'original-token',
      meta: { mimeType: 'image/jpeg' },
    });

    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('failed'));
    await new Promise(resolve => setTimeout(resolve, 0));

    store.retryUpload(store.getJobs().find(item => item.id === job.id)!);
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('completed'));

    expect(initAttempts).toBe(2);
    expect(apiPost).toHaveBeenCalledWith('/api/stories/retry-story/uploading', {}, 'original-token');
    expect(apiPost).toHaveBeenCalledWith('/api/stories/retry-story/finalize', { fileId: 'uploaded-photo' }, 'original-token');
  });

  test('ignores duplicate Retry requests while a job is active', async () => {
    let initAttempts = 0;
    (apiPost as any).mockImplementation((route: string) => {
      if (route.includes('/chunk/init')) {
        initAttempts += 1;
        return Promise.reject(new Error('Temporary upload outage'));
      }
      return Promise.resolve({});
    });

    const job = store.startUpload({
      kind: 'story',
      file: new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
      draftId: 'duplicate-retry-story', token: 'tok', meta: { mimeType: 'image/jpeg' },
    });

    store.retryUpload(job); // A starting job must not be restarted.
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('failed'));
    expect(initAttempts).toBe(1);
  });

  test('dismissUpload removes a finished job from the tray', async () => {
    const file = new File(['abc'], 'clip.mp4', { type: 'video/mp4' });
    const job = store.startUpload({ kind: 'story', file, draftId: 'story-9', token: 'tok', meta: { mimeType: 'video/mp4' } });
    await vi.waitFor(() => {
      expect(store.getJobs().find((j) => j.id === job.id)?.phase).toBe('completed');
    });

    store.dismissUpload(job.id);
    expect(store.getJobs().find((j) => j.id === job.id)).toBeUndefined();
  });
  test('refreshes a stale access token on a 401 before the upload begins', async () => {
    const { ApiError } = await import('@/lib/api');
    let liveToken = 'expired-access-token';
    const renewAccessToken = vi.fn(async () => {
      liveToken = 'fresh-access-token';
      return liveToken;
    });
    (apiPost as any).mockImplementation((path: string, _payload: unknown, token: string) => {
      if (path.endsWith('/uploading') && token === 'expired-access-token') {
        return Promise.reject(new ApiError(401, 'Unauthorized'));
      }
      if (path.includes('/chunk/init')) return Promise.resolve({ sessionId: 'sess-auth' });
      if (path.includes('/chunk/complete')) return Promise.resolve({ id: 'file-auth' });
      return Promise.resolve({});
    });

    const job = store.startUpload({
      kind: 'story',
      file: new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' }),
      draftId: 'story-auth',
      token: liveToken,
      getAccessToken: () => liveToken,
      renewAccessToken,
      meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('completed'));
    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith('/api/upload/chunk/init', expect.anything(), 'fresh-access-token');
    expect(apiPost).toHaveBeenCalledWith('/api/stories/story-auth/finalize', { fileId: 'file-auth' }, 'fresh-access-token');
  });

  test('recovers from a 401 on the XHR chunk POST without losing the media file', async () => {
    let liveToken = 'old';
    let attempts = 0;
    class AuthenticatedXHR extends FakeXHR {
      private authHeader = '';
      setRequestHeader(name: string, value: string) {
        if (name === 'Authorization') this.authHeader = value;
      }
      send() {
        attempts += 1;
        this.status = this.authHeader === 'Bearer new' ? 200 : 401;
        this.responseText = this.status === 401 ? JSON.stringify({ error: 'Unauthorized' }) : '{}';
        super.send();
      }
    }
    vi.stubGlobal('XMLHttpRequest', AuthenticatedXHR);
    const renewAccessToken = vi.fn(async () => {
      liveToken = 'new';
      return liveToken;
    });
    const job = store.startUpload({
      kind: 'story',
      file: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
      draftId: 'story-part',
      token: liveToken,
      getAccessToken: () => liveToken,
      renewAccessToken,
      meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('completed'));
    expect(attempts).toBe(2);
    expect(renewAccessToken).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith('/api/stories/story-part/finalize', expect.anything(), 'new');
  });

  test('keeps failed upload credentials and the selected file for a real Retry', async () => {
    let failFirstInit = true;
    (apiPost as any).mockImplementation((path: string) => {
      if (path.includes('/chunk/init')) {
        if (failFirstInit) {
          failFirstInit = false;
          return Promise.reject(new Error('Temporary upload failure'));
        }
        return Promise.resolve({ sessionId: 'sess-retry' });
      }
      if (path.includes('/chunk/complete')) return Promise.resolve({ id: 'file-retry' });
      return Promise.resolve({});
    });
    const job = store.startUpload({
      kind: 'story',
      file: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
      draftId: 'story-retry',
      token: 'tok',
      meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('failed'));
    store.retryUpload(job);
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('completed'));
    expect(apiPost).toHaveBeenCalledWith('/api/stories/story-retry/finalize', { fileId: 'file-retry' }, 'tok');
  });


  test('retries a failed finalize using the already uploaded file without transferring it twice', async () => {
    let failFirstFinalize = true;
    (apiPost as any).mockImplementation((path: string) => {
      if (path.includes('/chunk/init')) return Promise.resolve({ sessionId: 'sess-finalize' });
      if (path.includes('/chunk/complete')) return Promise.resolve({ id: 'file-stored' });
      if (path.includes('/finalize') && failFirstFinalize) {
        failFirstFinalize = false;
        return Promise.reject(new Error('Publish response was lost'));
      }
      return Promise.resolve({});
    });
    const job = store.startUpload({
      kind: 'story',
      file: new File(['picture'], 'status.jpg', { type: 'image/jpeg' }),
      draftId: 'story-finalize',
      token: 'tok',
      meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('failed'));
    const failed = store.getJobs().find(item => item.id === job.id)!;
    expect(failed.uploadedFileId).toBe('file-stored');
    store.retryUpload(failed);
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('completed'));
    const calls = (apiPost as any).mock.calls;
    expect(calls.filter(([path]: [string]) => path.includes('/chunk/init'))).toHaveLength(1);
    expect(calls.filter(([path]: [string]) => path.includes('/chunk/complete'))).toHaveLength(1);
    expect(calls.filter(([path]: [string]) => path.includes('/finalize'))).toHaveLength(2);
  });

  test('recovers a completed session whose completion response was lost without uploading chunks again', async () => {
    let firstComplete = true;
    let persistedOnServer = false;
    (apiPost as any).mockImplementation((path: string) => {
      if (path.includes('/chunk/init')) return Promise.resolve({ sessionId: 'sess-complete' });
      if (path.includes('/chunk/complete')) {
        if (firstComplete) {
          firstComplete = false;
          persistedOnServer = true;
          return Promise.reject(new Error('Upload completion response lost'));
        }
        return Promise.resolve({ id: 'file-complete' });
      }
      return Promise.resolve({});
    });
    (apiGet as any).mockImplementation(async () => ({
      status: persistedOnServer ? 'COMPLETE' : 'ACTIVE',
      receivedIndexes: [],
      complete: false,
    }));
    const chunkSends = vi.spyOn(FakeXHR.prototype, 'send');
    const job = store.startUpload({
      kind: 'story',
      file: new File(['picture'], 'status.jpg', { type: 'image/jpeg' }),
      draftId: 'story-complete',
      token: 'tok',
      meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('failed'));
    const failed = store.getJobs().find(item => item.id === job.id)!;
    store.retryUpload(failed);
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('completed'));
    const calls = (apiPost as any).mock.calls;
    expect(calls.filter(([path]: [string]) => path.includes('/chunk/init'))).toHaveLength(1);
    expect(calls.filter(([path]: [string]) => path.includes('/chunk/complete'))).toHaveLength(2);
    expect(chunkSends).toHaveBeenCalledTimes(1);
    chunkSends.mockRestore();
  });


  test.each(['FINALIZING', 'UNRECOGNIZED_STATUS'])('preserves the original session while server reports %s', async (pendingStatus) => {
    let status = 'ACTIVE';
    let completeAttempts = 0;
    (apiPost as any).mockImplementation((route: string) => {
      if (route.includes('/chunk/init')) return Promise.resolve({ sessionId: 'sess-pending' });
      if (route.includes('/chunk/complete')) {
        completeAttempts++;
        if (completeAttempts === 1) {
          status = pendingStatus;
          return Promise.reject(new Error('Completion response lost'));
        }
        return Promise.resolve({ id: 'file-original' });
      }
      return Promise.resolve({});
    });
    (apiGet as any).mockImplementation(async () => ({ status, receivedIndexes: [], complete: false }));
    const sends = vi.spyOn(FakeXHR.prototype, 'send');
    try {
      const job = store.startUpload({
        kind: 'reel', file: new File(['media'], 'clip.mp4', { type: 'video/mp4' }),
        draftId: 'reel-pending', token: 'tok', meta: { mimeType: 'video/mp4' },
      });
      await vi.waitFor(() => expect(store.getJobs().find(j => j.id === job.id)?.phase).toBe('failed'));
      store.retryUpload(store.getJobs().find(j => j.id === job.id)!);
      await vi.waitFor(() => expect(store.getJobs().find(j => j.id === job.id)?.phase).toBe('failed'));
      expect(store.getJobs().find(j => j.id === job.id)?.sessionId).toBe('sess-pending');
      expect(completeAttempts).toBe(1);
      expect(sends).toHaveBeenCalledTimes(1);
      status = 'COMPLETE';
      store.retryUpload(store.getJobs().find(j => j.id === job.id)!);
      await vi.waitFor(() => expect(store.getJobs().find(j => j.id === job.id)?.phase).toBe('completed'));
      expect((apiPost as any).mock.calls.filter(([route]: [string]) => route.includes('/chunk/init'))).toHaveLength(1);
      expect(completeAttempts).toBe(2);
      expect(sends).toHaveBeenCalledTimes(1);
      expect(apiPost).toHaveBeenCalledWith('/api/reels/reel-pending/finalize', expect.objectContaining({ fileId: 'file-original' }), 'tok');
    } finally { sends.mockRestore(); }
  });

  test('reuses a token rotated by AuthProvider during an in-flight 401 without another refresh', async () => {
    const { ApiError } = await import('@/lib/api');
    let latestToken = 'old-token';
    const renew = vi.fn(async () => 'unnecessarily-refreshed-token');
    (apiPost as any).mockImplementation((path: string, _payload: unknown, token: string) => {
      if (path.endsWith('/uploading') && token === 'old-token') {
        latestToken = 'new-token';
        return Promise.reject(new ApiError(401, 'Old request completed after token rotation'));
      }
      if (path.includes('/chunk/init')) return Promise.resolve({ sessionId: 'sess-rotated' });
      if (path.includes('/chunk/complete')) return Promise.resolve({ id: 'file-rotated' });
      return Promise.resolve({});
    });
    const job = store.startUpload({
      kind: 'story',
      file: new File(['photo'], 'status.jpg', { type: 'image/jpeg' }),
      draftId: 'story-rotated',
      token: latestToken,
      getAccessToken: () => latestToken,
      renewAccessToken: renew,
      meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('completed'));
    expect(renew).not.toHaveBeenCalled();
    expect(apiPost).toHaveBeenCalledWith('/api/upload/chunk/init', expect.anything(), 'new-token');
  });


  test('cancelling an active Story upload closes its unpublished draft before offering Retry', async () => {
    let resolveInit: ((value: { sessionId: string }) => void) | undefined;
    (apiPost as any).mockImplementation((path: string) => {
      if (path.includes('/chunk/init')) {
        return new Promise<{ sessionId: string }>((resolve) => { resolveInit = resolve; });
      }
      return Promise.resolve({});
    });

    const job = store.startUpload({
      kind: 'story',
      file: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
      draftId: 'story-cancel',
      token: 'tok',
      meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(resolveInit).toBeDefined());
    store.cancelUpload(job);
    resolveInit!({ sessionId: 'sess-cancel' });

    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('cancelled'));
    expect(apiPost).toHaveBeenCalledWith('/api/upload/chunk/sess-cancel/abort', {}, 'tok');
    expect(apiPost).toHaveBeenCalledWith('/api/stories/story-cancel/fail', {}, 'tok');
    expect(store.getJobs().find(item => item.id === job.id)?.disabled).toBe(false);
    store.dismissUpload(job.id);
    expect(store.getJobs().find(item => item.id === job.id)).toBeUndefined();
  });


  test('recovers a missing provider access token before creating a Status draft', async () => {
    let current: string | null = null;
    const renew = vi.fn(async () => {
      current = 'renewed';
      return current;
    });
    const postDraft = vi.fn(async (accessToken: string) => ({ id: 'draft-renewed', accessToken }));
    const result = await store.requestWithUploadAuth('old', () => current, renew, postDraft);
    expect(result).toEqual({ id: 'draft-renewed', accessToken: 'renewed' });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(postDraft).toHaveBeenCalledTimes(1);
  });

  test('replays only unauthorized draft requests, not validation errors', async () => {
    const { ApiError } = await import('@/lib/api');
    let token = 'old';
    const renew = vi.fn(async () => {
      token = 'new';
      return token;
    });
    const draftRequest = vi.fn(async (accessToken: string) => {
      if (accessToken === 'old') throw new ApiError(401, 'Expired access token');
      return { id: 'draft-ok' };
    });
    await expect(store.requestWithUploadAuth('old', () => token, renew, draftRequest))
      .resolves.toEqual({ id: 'draft-ok' });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(draftRequest).toHaveBeenCalledTimes(2);

    const badDraft = vi.fn(async () => { throw new ApiError(400, 'Invalid caption'); });
    await expect(store.requestWithUploadAuth('new', () => token, renew, badDraft))
      .rejects.toThrow('Invalid caption');
    expect(renew).toHaveBeenCalledTimes(1);
    expect(badDraft).toHaveBeenCalledTimes(1);
  });


  test('preserves the resumable session when the Retry probe hits a transient outage', async () => {
    const { ApiError } = await import('@/lib/api');
    let firstComplete = true;
    let outage = false;
    let sessionChecks = 0;
    (apiPost as any).mockImplementation((path: string) => {
      if (path.includes('/chunk/init')) return Promise.resolve({ sessionId: 'sess-stable' });
      if (path.includes('/chunk/complete')) {
        if (firstComplete) {
          firstComplete = false;
          return Promise.reject(new Error('Temporary completion timeout'));
        }
        return Promise.resolve({ id: 'file-stable' });
      }
      return Promise.resolve({});
    });
    (apiGet as any).mockImplementation(async () => {
      sessionChecks += 1;
      if (outage) throw new ApiError(503, 'Upload service temporarily unavailable');
      return { status: 'ACTIVE', receivedIndexes: [0], complete: true };
    });
    const job = store.startUpload({
      kind: 'story', file: new File(['picture'], 'photo.jpg', { type: 'image/jpeg' }),
      draftId: 'story-stable', token: 'tok', meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(store.getJobs().find(j => j.id === job.id)?.phase).toBe('failed'));
    outage = true;
    store.retryUpload(job);
    await vi.waitFor(() => expect(store.getJobs().find(j => j.id === job.id)?.phase).toBe('failed'));
    expect(store.getJobs().find(j => j.id === job.id)?.sessionId).toBe('sess-stable');
    expect((apiPost as any).mock.calls.filter(([path]: [string]) => path.includes('/chunk/init'))).toHaveLength(1);
    expect(sessionChecks).toBeGreaterThanOrEqual(2);
    outage = false;
    store.retryUpload(job);
    await vi.waitFor(() => expect(store.getJobs().find(j => j.id === job.id)?.phase).toBe('completed'));
    expect((apiPost as any).mock.calls.filter(([path]: [string]) => path.includes('/chunk/init'))).toHaveLength(1);
  });

  test('only starts a new session when the old upload session is explicitly missing', async () => {
    const { ApiError } = await import('@/lib/api');
    let firstComplete = true;
    let oldSessionMissing = false;
    let sessionsCreated = 0;
    (apiPost as any).mockImplementation((path: string) => {
      if (path.includes('/chunk/init')) return Promise.resolve({ sessionId: `sess-${++sessionsCreated}` });
      if (path.includes('/chunk/complete')) {
        if (firstComplete) {
          firstComplete = false;
          return Promise.reject(new Error('Temporary interruption'));
        }
        return Promise.resolve({ id: 'file-recreated' });
      }
      return Promise.resolve({});
    });
    (apiGet as any).mockImplementation(async (path: string) => {
      if (oldSessionMissing && path.endsWith('sess-1')) {
        throw new ApiError(400, 'Upload session not found.');
      }
      return { status: 'ACTIVE', receivedIndexes: [], complete: false };
    });
    const job = store.startUpload({
      kind: 'story', file: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
      draftId: 'story-missing-session', token: 'tok', meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(store.getJobs().find(j => j.id === job.id)?.phase).toBe('failed'));
    oldSessionMissing = true;
    store.retryUpload(job);
    await vi.waitFor(() => expect(store.getJobs().find(j => j.id === job.id)?.phase).toBe('completed'));
    expect(sessionsCreated).toBe(2);
    expect(store.getJobs().find(j => j.id === job.id)?.sessionId).toBe('sess-2');
  });


  test('accepts legacy ACTIVE chunk state responses during a staged backend rollout', async () => {
    (apiGet as any).mockResolvedValue({ receivedIndexes: [], complete: false });
    const job = store.startUpload({
      kind: 'story', file: new File(['photo'], 'status.jpg', { type: 'image/jpeg' }),
      draftId: 'story-legacy', token: 'tok', meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(store.getJobs().find(item => item.id === job.id)?.phase).toBe('completed'));
    expect(apiPost).toHaveBeenCalledWith('/api/stories/story-legacy/finalize', { fileId: 'file-1' }, 'tok');
  });

});