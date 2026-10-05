'use client';

// ============================================================================
// STORY / STATUS MEDIA — multi-file selection rules for the Create Status flow.
//
// A VANTA Status post is backed by Story rows where ONE row holds ONE media
// item (the existing production data model — see backend Story model). A
// multi-media status therefore publishes multiple Story rows, and every row
// counts against the same daily quota server-side. These helpers keep the
// composer honest against those rules while the backend remains authoritative
// (quota + 24h expiration are enforced in the backend transaction, never here).
// ============================================================================

import { ApiError } from '@/lib/api';

/** Production-safe maximum media files per single Status creation session. */
export const MAX_STATUS_MEDIA_FILES = 7;

/** Matches the backend daily Status quota (7 PUBLISHED rows per day). */
export const DAILY_STATUS_LIMIT_FRONTEND = 7;

export const STORY_ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
export const STORY_ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const STORY_MAX_IMAGE_BYTES = 15 * 1024 * 1024; // matches backend UPLOAD_LIMITS.IMAGE
export const STORY_MAX_VIDEO_BYTES = 100 * 1024 * 1024; // matches backend UPLOAD_LIMITS.VIDEO

export type StoryMediaKind = 'image' | 'video';

/** Return the media kind for a file, or null when the file type is unsupported. */
export function storyMediaKindOf(file: Pick<File, 'name' | 'type'>): StoryMediaKind | null {
  const mime = String(file.type || '').toLowerCase().split(';')[0].trim();
  const extension = (file.name.split('.').pop() || '').toLowerCase();
  if (STORY_ACCEPTED_IMAGE_TYPES.includes(mime) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(extension)) {
    return 'image';
  }
  if (STORY_ACCEPTED_VIDEO_TYPES.includes(mime) || ['mp4', 'webm', 'mov', 'quicktime'].includes(extension)) {
    return 'video';
  }
  return null;
}

/**
 * Validate a candidate file for a Status. Returns a human-readable error
 * message, or null when the file can be added. User-friendly on purpose —
 * never an internal error code.
 */
export function validateStoryMediaFile(file: File | null | undefined): string | null {
  if (!file) return 'No file was selected.';
  const kind = storyMediaKindOf(file);
  if (!kind) {
    return 'Unsupported file. Choose a photo (JPG, PNG, WebP, GIF, AVIF) or a short video (MP4, WebM, MOV).';
  }
  if (kind === 'image' && file.size > STORY_MAX_IMAGE_BYTES) {
    return 'This image is larger than the 15MB limit. Please choose a smaller photo.';
  }
  if (kind === 'video' && file.size > STORY_MAX_VIDEO_BYTES) {
    return 'This video is larger than the 100MB limit. Please choose a shorter video.';
  }
  return null;
}

/**
 * Turn an arbitrary publish/upload failure into a message people can actually
 * act on. Avoids leaking raw API codes ("ERR_UPLOAD_500") while still showing
 * the server's own words when they already read like a product message.
 */
export function toUserFacingStoryError(reason: unknown): string {
  const asObject = reason && typeof reason === 'object' ? (reason as { statusCode?: number; message?: unknown }) : null;
  if (asObject?.statusCode === 401 || (reason instanceof ApiError && reason.statusCode === 401)) {
    return 'Your session has expired. Please sign in again and try posting.';
  }
  const message =
    reason instanceof Error
      ? reason.message
      : typeof asObject?.message === 'string'
        ? asObject.message
        : String(reason || '');
  const lower = message.toLowerCase();
  if (/reached today's status limit|status limit of/i.test(message)) {
    return 'You’ve reached today’s Status publishing limit. It resets at midnight — or become a verified creator for unlimited posts.';
  }
  if (/too many pending/i.test(message)) {
    return 'You have too many pending uploads right now. Retry or remove them from the upload tray first.';
  }
  if (/session|expired|unauthorized|sign in/i.test(lower)) {
    return 'Your session has expired. Please sign in again and try posting.';
  }
  if (/network|connection|timed? ?out|failed to fetch|internet/i.test(lower)) {
    return 'A network problem interrupted posting. Check your connection and try again.';
  }
  if (/cancell?ed/i.test(lower)) {
    return 'Posting was cancelled. Your selected files are still here — post them whenever you’re ready.';
  }
  if (/too large|exceeds|limit/i.test(lower)) {
    return 'One of your files is too large for a Status. Remove it and try again.';
  }
  return message || 'Your Status could not be posted. Please try again.';
}

/**
 * Calculate how many media files a user may still add to one Status.
 *  - Verified creators are unlimited by backend entitlement → the production
 *    cap (MAX_STATUS_MEDIA_FILES) is the only limit.
 *  - Standard users are additionally bounded by today's remaining daily quota,
 *    because every media item publishes its own Story row server-side.
 * The server remains the authority — this is purely a UX guard.
 */
export function storyMediaCapacity(options: {
  verified?: boolean;
  usedToday?: number;
  limit?: number;
}): number {
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) ? options.limit : DAILY_STATUS_LIMIT_FRONTEND;
  const used = Math.max(0, Number.isFinite(options.usedToday ?? NaN) ? (options.usedToday || 0) : 0);
  if (options.verified) return MAX_STATUS_MEDIA_FILES;
  const remaining = Math.max(0, limit - used);
  return Math.min(MAX_STATUS_MEDIA_FILES, remaining);
}