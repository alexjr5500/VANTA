// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/apiClient', () => ({
  apiPost: vi.fn(),
  apiGet: vi.fn(),
  invalidateCache: vi.fn(),
}));
vi.mock('@/lib/storyEvents', () => ({ notifyStoryFeedChanged: vi.fn() }));

import { apiPost } from '@/lib/apiClient';
import { dismissUpload, getJobs, retryUpload, startUpload } from './store';

const post = vi.mocked(apiPost);

afterEach(() => {
  for (const job of getJobs()) dismissUpload(job.id);
  vi.resetAllMocks();
});

describe('Status and Reel upload retry', () => {
  it('retains the original file and token after a failed attempt and can retry it', async () => {
    let initCalls = 0;
    post.mockImplementation(async (path: string, _data: unknown, token?: string) => {
      expect(token).toBe('test-upload-token');
      if (path === '/api/upload/chunk/init') {
        initCalls += 1;
        throw new Error('Temporary upload service failure');
      }
      return {} as never;
    });

    const file = new File(['image-data'], 'photo.jpg', { type: 'image/jpeg' });
    const job = startUpload({
      kind: 'story', file, draftId: 'test-story-draft',
      token: 'test-upload-token', meta: { mimeType: 'image/jpeg' },
    });
    await vi.waitFor(() => expect(getJobs().find(j => j.id === job.id)?.phase).toBe('failed'));
    // Wait for the original attempt's finally handler before pressing Retry.
    await vi.waitFor(() => expect(initCalls).toBe(1));
    await new Promise(resolve => setTimeout(resolve, 0));

    retryUpload(getJobs().find(j => j.id === job.id)!);
    await vi.waitFor(() => expect(initCalls).toBe(2));
    await vi.waitFor(() => expect(getJobs().find(j => j.id === job.id)?.phase).toBe('failed'));
    expect(getJobs().find(j => j.id === job.id)?.error).toContain('Temporary upload');
  });

  it('rejects retries of completed or active jobs', async () => {
    let initCalls = 0;
    post.mockImplementation(async (path: string) => {
      if (path === '/api/upload/chunk/init') {
        initCalls += 1;
        throw new Error('Upload init failed');
      }
      return {} as never;
    });

    const job = startUpload({
      kind: 'story',
      file: new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
      draftId: 'second-story-draft', token: 'test-upload-token',
      meta: { mimeType: 'image/jpeg' },
    });
    retryUpload(job); // Starting jobs are not retryable.
    await vi.waitFor(() => expect(getJobs().find(j => j.id === job.id)?.phase).toBe('failed'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(initCalls).toBe(1);
  });
});
