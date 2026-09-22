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
  setRequestHeader() {}
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
    (apiGet as any).mockResolvedValue({ receivedIndexes: [], complete: false });
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

  test('dismissUpload removes a finished job from the tray', async () => {
    const file = new File(['abc'], 'clip.mp4', { type: 'video/mp4' });
    const job = store.startUpload({ kind: 'story', file, draftId: 'story-9', token: 'tok', meta: { mimeType: 'video/mp4' } });
    await vi.waitFor(() => {
      expect(store.getJobs().find((j) => j.id === job.id)?.phase).toBe('completed');
    });

    store.dismissUpload(job.id);
    expect(store.getJobs().find((j) => j.id === job.id)).toBeUndefined();
  });
});