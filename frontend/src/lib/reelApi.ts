'use client';

import { apiPost } from '@/lib/apiClient';

// Reel (Video) API helpers for the background-publish lifecycle:
//   1. createReelDraft   — instant draft (UPLOADING, no media yet)
//   2. setReelUploading   — re-open a failed draft for a retry
//   3. finalizeReel       — bind uploaded media + publish (PUBLISHED)
//   4. failReelUpload     — mark the draft FAILED when the upload can't finish
// The media itself streams through the reusable `/api/upload/chunk/*` pipeline
// (see the background upload manager) instead of a single blocking request.

export interface ReelDraft {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  publishStatus: string;
  creatorId: string;
  createdAt: string;
}

export function createReelDraft(
  token: string,
  input: { title: string; description?: string }
): Promise<{ message: string; video: ReelDraft }> {
  return apiPost<{ message: string; video: ReelDraft }>(
    '/api/reels',
    { title: input.title, description: input.description || undefined },
    token
  );
}

export function setReelUploading(token: string, reelId: string): Promise<{ video: ReelDraft }> {
  return apiPost<{ video: ReelDraft }>(`/api/reels/${encodeURIComponent(reelId)}/uploading`, {}, token);
}

export function finalizeReel(
  token: string,
  reelId: string,
  fileId: string,
  duration?: number
): Promise<{ message: string; video: ReelDraft }> {
  return apiPost<{ message: string; video: ReelDraft }>(
    `/api/reels/${encodeURIComponent(reelId)}/finalize`,
    { fileId, duration: typeof duration === 'number' ? duration : undefined },
    token
  );
}

export function failReelUpload(token: string, reelId: string): Promise<{ video: ReelDraft }> {
  return apiPost<{ video: ReelDraft }>(`/api/reels/${encodeURIComponent(reelId)}/fail`, {}, token);
}