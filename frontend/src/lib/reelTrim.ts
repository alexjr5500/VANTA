/**
 * Backward-compatible shim for the VANTA "Upload Reel" flow.
 *
 * All trimming capability now lives in the shared, feature-agnostic
 * `@/lib/videoTrim` engine that powers every VANTA video upload flow
 * (Reel, Post, Story, Chat, Fundraiser cover) through the shared
 * <VideoTrimEditor /> component. Existing imports keep working via the
 * aliases below.
 */
export {
  VIDEO_MAX_DURATION_SECONDS as REEL_MAX_DURATION_SECONDS,
  VIDEO_MAX_SIZE_BYTES as REEL_MAX_SIZE_BYTES,
  ALLOWED_VIDEO_TYPES as REEL_ALLOWED_TYPES,
  VIDEO_MIN_GAP_SECONDS as REEL_MIN_GAP_SECONDS,
  formatVideoTime as formatReelTime,
  parseVideoTimeInput as parseReelTimeInput,
  clampTime,
  formatFileSize,
  getTrimmingSupport,
  probeDuration,
  generateFilmstrip,
  trimVideoSegment,
} from './videoTrim';
export type { TrimmingSupport, TrimVideoOptions } from './videoTrim';