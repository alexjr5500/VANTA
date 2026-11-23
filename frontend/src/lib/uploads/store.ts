'use client';

import { API_BASE_URL, ApiError } from '@/lib/api';
import { apiGet, apiPost, invalidateCache } from '@/lib/apiClient';
import { notifyStoryFeedChanged } from '@/lib/storyEvents';

// ============================================================================
// VANTA background upload manager
// ----------------------------------------------------------------------------
// A reusable, feature-agnostic engine that runs Story/Reel media transfers in
// the BACKGROUND (module-level singleton, so it survives SPA navigation between
// VANTA pages). It uses the resumable chunk protocol against the existing
// `/api/upload/chunk/*` endpoints: files are sliced into fixed-size parts,
// streamed with REAL byte-based progress, and reassembled server-side through
// the existing storage pipeline. Failures are retried per chunk; a retried job
// resumes from the parts already received. Multiple uploads can run at once.
// ============================================================================

export type UploadKind = 'story' | 'reel';
export type UploadPhase = 'starting' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface UploadJobMeta {
  caption?: string;
  title?: string;
  description?: string;
  /** Trimmed video duration in seconds (passed to Reel finalize). */
  duration?: number;
  /** Normalized media MIME (video/mp4, video/webm, image/…). */
  mimeType: string;
}

export interface UploadJob {
  id: string;
  kind: UploadKind;
  label: string;
  fileName: string;
  fileSize: number;
  phase: UploadPhase;
  /** 0–100 — REAL percentage of bytes transferred, never a timer. */
  progress: number;
  bytesSent: number;
  bytesTotal: number;
  error?: string;
  draftId: string;
  sessionId?: string;
  /** Persisted media file ID: a failed finalize can be retried without reuploading bytes. */
  uploadedFileId?: string;
  createdAt: number;
  updatedAt: number;
  /** true while a retry is already running for this job. */
  disabled: boolean;
}

export interface StartUploadInput {
  kind: UploadKind;
  file: File;
  draftId: string;
  token: string;
  /** Provider callbacks keep long-running transfers authenticated after refresh. */
  getAccessToken?: () => string | null;
  renewAccessToken?: () => Promise<string | null>;
  meta: UploadJobMeta;
  /** Called once when the whole publish (upload + finalize) completes. */
  onCompleted?: (job: UploadJob) => void;
}

const CHUNK_SIZE = 5 * 1024 * 1024; // must match backend UPLOAD_CHUNK_SIZE
const MAX_XHR_RETRIES = 3;
const API = (path: string) => `${API_BASE_URL}${path}`;

let jobList: UploadJob[] = [];
const running = new Map<string, AbortController>();
interface UploadCredentials {
  token: string;
  getAccessToken?: () => string | null;
  renewAccessToken?: () => Promise<string | null>;
}
const jobCredentials = new Map<string, UploadCredentials>();

function currentAccessToken(auth: UploadCredentials): string {
  if (auth.getAccessToken) {
    const latest = auth.getAccessToken();
    if (!latest) throw new ApiError(401, 'Your session has expired. Sign in again before retrying.');
    auth.token = latest;
  }
  return auth.token;
}

/** Use newer provider credentials first; refresh only when a fresh token still fails. */
async function withUploadAuth<T>(auth: UploadCredentials, request: (token: string) => Promise<T>): Promise<T> {
  let attempted = auth.token;
  try {
    // The provider may briefly have no access token while restoring a session;
    // its refresh callback can still recover, so keep this INSIDE the 401 catch.
    attempted = currentAccessToken(auth);
    return await request(attempted);
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== 401) throw error;
    // Another request may have refreshed AuthProvider while this one was in
    // flight. Reuse that token instead of rotating credentials once more.
    const latest = auth.getAccessToken?.();
    if (latest && latest !== attempted) {
      auth.token = latest;
      try {
        return await request(latest);
      } catch (retryError) {
        if (!(retryError instanceof ApiError) || retryError.statusCode !== 401) throw retryError;
      }
    }
    if (!auth.renewAccessToken) throw error;
    const renewed = await auth.renewAccessToken();
    if (!renewed) throw new ApiError(401, 'Your session has expired. Sign in again before retrying.');
    auth.token = renewed;
    return request(renewed);
  }
}

/** Auth recovery for draft creation, before a background upload job exists. */
export function requestWithUploadAuth<T>(
  token: string,
  getAccessToken: () => string | null,
  renewAccessToken: () => Promise<string | null>,
  request: (accessToken: string) => Promise<T>,
): Promise<T> {
  return withUploadAuth({ token, getAccessToken, renewAccessToken }, request);
}

function finishUploadAttempt(jobId: string, controller: AbortController): void {
  if (running.get(jobId) === controller) running.delete(jobId);
  const phase = jobList.find((job) => job.id === jobId)?.phase;
  if (phase === 'completed') {
    jobCredentials.delete(jobId);
    FILE_CACHE.delete(jobId);
    META_CACHE.delete(jobId);
  }
  // Failed/cancelled jobs retain file + credentials only until Retry/Dismiss.
}
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getJobs = (): UploadJob[] => jobList;
/** Number of jobs still actively transferring or finalizing. */
export const getActiveUploadCount = () =>
  jobList.filter((job) => job.phase === 'starting' || job.phase === 'uploading' || job.phase === 'processing').length;

function patchJob(id: string, data: Partial<UploadJob>) {
  const found = jobList.find((job) => job.id === id);
  if (!found) return;
  jobList = jobList.map((job) => (job.id === id ? { ...job, ...data, updatedAt: Date.now() } : job));
  emit();
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ApiError(499, 'Upload cancelled');
}

export function startUpload(input: StartUploadInput): UploadJob {
  const job: UploadJob = {
    id: makeId(),
    kind: input.kind,
    label: input.kind === 'story' ? 'Story' : 'Reel',
    fileName: input.file.name,
    fileSize: input.file.size,
    phase: 'starting',
    progress: 0,
    bytesSent: 0,
    bytesTotal: input.file.size,
    draftId: input.draftId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    disabled: false,
  };
  jobList = [job, ...jobList];
  const credentials: UploadCredentials = {
    token: input.token,
    getAccessToken: input.getAccessToken,
    renewAccessToken: input.renewAccessToken,
  };
  jobCredentials.set(job.id, credentials);
  cacheUploadAssets(job.id, input.file, input.meta);
  emit();

  const controller = new AbortController();
  running.set(job.id, controller);
  void runUpload(job, input.file, credentials, input.meta, controller.signal, input.onCompleted)
    .finally(() => finishUploadAttempt(job.id, controller));
  return job;
}

/** Finalize using the uploaded File ID; safe to rerun after a lost response. */
async function finalizeUploadedFile(job: UploadJob, auth: UploadCredentials, meta: UploadJobMeta, fileId: string): Promise<void> {
  if (job.kind === 'story') {
    await withUploadAuth(auth, token => apiPost(`/api/stories/${job.draftId}/finalize`, { fileId }, token));
    notifyStoryFeedChanged();
    invalidateCache('stories');
  } else {
    await withUploadAuth(auth, token => apiPost(
      `/api/reels/${job.draftId}/finalize`,
      { fileId, duration: typeof meta.duration === 'number' ? meta.duration : undefined }, token
    ));
    invalidateCache('reels');
  }
}

async function runUpload(
  job: UploadJob,
  file: File,
  auth: UploadCredentials,
  meta: UploadJobMeta,
  signal: AbortSignal,
  onCompleted?: (job: UploadJob) => void
): Promise<void> {
  try {
    // 1. Re-open the draft for this upload attempt (idempotent; also re-opens a
    //    FAILED draft on retry).
    await withUploadAuth(auth, token => apiPost(`/api/${job.kind === 'story' ? 'stories' : 'reels'}/${job.draftId}/uploading`, {}, token));

    // If only finalization failed, the file has ALREADY been stored. Do not
    // re-send it or consume another upload session on Retry.
    if (job.uploadedFileId) {
      throwIfAborted(signal);
      patchJob(job.id, { phase: 'processing', progress: 100, bytesSent: file.size });
      await finalizeUploadedFile(job, auth, meta, job.uploadedFileId);
      patchJob(job.id, { phase: 'completed', progress: 100, bytesSent: file.size, error: undefined, disabled: false });
      try { onCompleted?.(job); } catch { /* Callback must not turn a published Status into a failed one. */ }
      return;
    }

    // 2. Reuse the existing resumable session when it is still active, otherwise
    //    create a fresh one. This is what lets an interrupted upload resume from
    //    the parts already received instead of restarting from zero.
    if (job.sessionId) {
      try {
        const state = await withUploadAuth(auth, token => apiGet<any>(`/api/upload/chunk/${job.sessionId}`, token, { skipCache: true }));
        if (!state || (state.status && state.status !== 'ACTIVE' && state.status !== 'COMPLETE')) {
          job.sessionId = undefined;
        } else if (state.status === 'COMPLETE') {
          // Chunk completion succeeded before its response was lost. The API
          // returns the existing uploadedFile by the original record ID.
          const completed = await withUploadAuth(auth, token => apiPost<any>(
            '/api/upload/chunk/complete', { sessionId: job.sessionId }, token
          ));
          job.uploadedFileId = completed.id;
          patchJob(job.id, { phase: 'processing', uploadedFileId: completed.id, progress: 100, bytesSent: file.size });
          await finalizeUploadedFile(job, auth, meta, completed.id);
          patchJob(job.id, { phase: 'completed', progress: 100, bytesSent: file.size, error: undefined, disabled: false });
          try { onCompleted?.(job); } catch { /* Notification callbacks must not invalidate a completed upload. */ }
          return;
        }
      } catch (error) {
        // A completed upload must keep its media ID even when finalizing fails.
        // Retrying will call finalize with the same file instead of reuploading.
        if (job.uploadedFileId) throw error;
        job.sessionId = undefined;
      }
    }
    if (!job.sessionId) {
      const mimeType =
        meta.mimeType ||
        file.type ||
        (file.name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : file.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'image/jpeg');
      const init = await withUploadAuth(auth, token => apiPost<any>(
        '/api/upload/chunk/init',
        {
          fileName: file.name,
          fileSize: file.size,
          mimeType,
          category: job.kind, // 'story' | 'reel'
          recordType: job.kind === 'story' ? 'Story' : 'Video',
          recordId: job.draftId,
        },
        token
      ));
      job.sessionId = init.sessionId;
    }
    throwIfAborted(signal);
    patchJob(job.id, { phase: 'uploading', sessionId: job.sessionId, bytesTotal: file.size, error: undefined });

    // 3. Resume-aware chunk loop with byte-accurate progress.
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    let receivedIndexes: number[] = [];
    try {
      const state = await withUploadAuth(auth, token => apiGet<any>(`/api/upload/chunk/${job.sessionId}`, token, { skipCache: true }));
      if (state && Array.isArray(state.receivedIndexes)) receivedIndexes = state.receivedIndexes;
    } catch {
      // session not probeable — upload from the first chunk
    }
    throwIfAborted(signal);

    const received = new Set(receivedIndexes);
    for (let i = 0; i < totalChunks; i++) {
      throwIfAborted(signal);
      const start = i * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      if (received.has(i)) {
        patchJob(job.id, { bytesSent: end, progress: Math.round((end / file.size) * 100) });
        continue;
      }
      const chunk = file.slice(start, end);
      await withUploadAuth(auth, token => uploadPart(job, token, chunk, i, start, signal));
      patchJob(job.id, { bytesSent: end, progress: Math.round((end / file.size) * 100) });
    }

    throwIfAborted(signal);
    patchJob(job.id, { phase: 'processing', progress: 100, bytesSent: file.size });

    // 4. Reassemble + persist through the existing storage pipeline server-side.
    const completed = await withUploadAuth(auth, token => apiPost<any>('/api/upload/chunk/complete', { sessionId: job.sessionId }, token));
    throwIfAborted(signal);

    // 5. Finalize the record — the Story/Reel becomes PUBLISHED only now, when
    //    its media URL actually exists. Never before.
    // Retain the persisted file before finalization: retrying a finalize or
    // recovering from a dropped response must NEVER upload the same bytes twice.
    job.uploadedFileId = completed.id;
    patchJob(job.id, { uploadedFileId: completed.id });
    await finalizeUploadedFile(job, auth, meta, completed.id);

    patchJob(job.id, { phase: 'completed', progress: 100, bytesSent: file.size, error: undefined, disabled: false });
    try { onCompleted?.(job); } catch { /* A user-provided callback cannot undo published media. */ }
  } catch (error) {
    const cancelled = isAbortError(error) || (error instanceof ApiError && error.statusCode === 499);
    if (cancelled) {
      // Cancel the server session only AFTER the client transfer has stopped.
      // Cancellation may happen before init returns the session ID; cleaning up
      // here prevents orphaned chunks in that case.
      if (job.sessionId) {
        try {
          await withUploadAuth(auth, token => apiPost(`/api/upload/chunk/${job.sessionId}/abort`, {}, token));
        } catch {
          // May already be completed or network unavailable; safe to continue.
        }
      }
      // Cancelled sessions still own an unpublished Story/Reel draft. Clean it
      // server-side before showing Retry, avoiding a concurrent fail/uploading race.
      try {
        await withUploadAuth(auth, token => apiPost(`/api/${job.kind === 'story' ? 'stories' : 'reels'}/${job.draftId}/fail`, {}, token));
      } catch {
        // If offline, the user can still retry or dismiss the cancelled job.
      }
      patchJob(job.id, { phase: 'cancelled', disabled: false });
    } else {
      const message = error instanceof Error ? error.message : 'Upload failed unexpectedly';
      try {
        await withUploadAuth(auth, token => apiPost(`/api/${job.kind === 'story' ? 'stories' : 'reels'}/${job.draftId}/fail`, {}, token));
      } catch {
        // server may be unreachable — the client failure state is still shown
      }
      // Show Retry only after the server's failed-draft update settles, so a
      // rapid retry cannot race with the previous attempt's fail request.
      patchJob(job.id, { phase: 'failed', error: message, disabled: false });
    }
  }
}

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

/** Stream one chunk part via XHR (true byte progress), retrying 5xx/network blips. */
function uploadPart(
  job: UploadJob,
  token: string,
  chunk: Blob,
  index: number,
  startByte: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const attempt = (retry: number) => {
      const xhr = new XMLHttpRequest();
      const onAbortSignal = () => xhr.abort();
      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable) return;
        const sent = Math.min(job.fileSize, startByte + event.loaded);
        patchJob(job.id, { bytesSent: sent, progress: Math.round((sent / job.fileSize) * 100) });
      });
      xhr.addEventListener('load', () => {
        signal.removeEventListener('abort', onAbortSignal);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        let message = `Chunk upload failed (${xhr.status}).`;
        try {
          const data = JSON.parse(xhr.responseText);
          if (data?.error) message = data.error;
        } catch {
          // non-JSON error body
        }
        if (retry < MAX_XHR_RETRIES && xhr.status >= 500) {
          window.setTimeout(() => attempt(retry + 1), 1000 * (retry + 1));
          return;
        }
        reject(new ApiError(xhr.status || 500, message));
      });
      xhr.addEventListener('error', () => {
        signal.removeEventListener('abort', onAbortSignal);
        if (retry < MAX_XHR_RETRIES) {
          window.setTimeout(() => attempt(retry + 1), 1000 * (retry + 1));
          return;
        }
        reject(new ApiError(0, 'Network error while uploading. Check your connection and try again.'));
      });
      xhr.addEventListener('abort', () => {
        signal.removeEventListener('abort', onAbortSignal);
        reject(new ApiError(499, 'Upload cancelled'));
      });
      if (signal.aborted) {
        reject(new ApiError(499, 'Upload cancelled'));
        return;
      }
      signal.addEventListener('abort', onAbortSignal, { once: true });

      const form = new FormData();
      form.append('sessionId', job.sessionId ?? '');
      form.append('index', String(index));
      form.append('chunk', chunk, 'part');
      xhr.open('POST', API('/api/upload/chunk/part'));
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(form);
    };
    attempt(0);
  });
}

/** Retry a failed (or cancelled) job. Resumes from chunks already on the server. */
export function retryUpload(job: UploadJob): void {
  const existing = jobList.find((item) => item.id === job.id);
  if (!existing || existing.disabled || (existing.phase !== 'failed' && existing.phase !== 'cancelled')) return;
  const auth = jobCredentials.get(job.id);
  const file = FILE_CACHE.get(job.id);
  if (!auth || !file) {
    patchJob(job.id, {
      phase: 'failed',
      error: 'The original file is no longer available. Start a new upload instead.',
      disabled: false,
    });
    return;
  }

  // Cancelled sessions cannot be resumed; a failed session is probed first.
  if (existing.phase === 'cancelled') job.sessionId = undefined;
  patchJob(job.id, { phase: 'starting', progress: 0, error: undefined, disabled: true });
  const controller = new AbortController();
  running.set(job.id, controller);
  void runUpload(job, file, auth, metaOf(job), controller.signal)
    .finally(() => finishUploadAttempt(job.id, controller));
}

/** Cancel an in-progress upload (aborts the transfer + cleans the server session). */
export function cancelUpload(job: UploadJob): void {
  const controller = running.get(job.id);
  if (controller) {
    // runUpload owns the ordered abort -> fail cleanup, even if the session ID
    // is not known until the pending /init call finishes.
    controller.abort();
  } else {
    jobList = jobList.filter((item) => item.id !== job.id);
    FILE_CACHE.delete(job.id);
    META_CACHE.delete(job.id);
    jobCredentials.delete(job.id);
    emit();
  }
}

/** Remove a finished/failed/cancelled job from the tray entirely. */
export function dismissUpload(jobId: string): void {
  jobList = jobList.filter((item) => item.id !== jobId);
  FILE_CACHE.delete(jobId);
  META_CACHE.delete(jobId);
  jobCredentials.delete(jobId);
  running.get(jobId)?.abort();
  running.delete(jobId);
  emit();
}

// ---- File/meta retention so Retry can reuse the original File object --------

const FILE_CACHE = new Map<string, File>();
const META_CACHE = new Map<string, UploadJobMeta>();
const metaOf = (job: UploadJob): UploadJobMeta => META_CACHE.get(job.id) ?? { mimeType: '' };

/** Store the File + meta so a Retry later in the same session still works.
 *  In-memory only — SPA navigation keeps the module singleton alive. */
export function cacheUploadAssets(id: string, file: File, meta: UploadJobMeta): void {
  FILE_CACHE.set(id, file);
  META_CACHE.set(id, meta);
}

export const subscribeUploads = subscribe;