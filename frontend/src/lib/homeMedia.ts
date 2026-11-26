import { resolveMediaUrl } from './mediaUrl';

export interface HomeMediaSource {
  type?: string;
  url?: string | null;
  thumbnailUrl?: string | null;
  uploadedFile?: { url?: string | null; thumbnailUrl?: string | null } | null;
}

export const isHomeVideo = (media?: HomeMediaSource | null) => media?.type?.toUpperCase() === 'VIDEO';

function normalize(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  // Reject unsupported schemes and filesystem paths, without changing valid CDN URLs.
  const raw = value.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^(?:https?:\/\/|blob:|data:image\/)/i.test(raw)) return '';
  return resolveMediaUrl(raw);
}

/** Original media is used for playback; a video is never passed to an img element. */
export function homeMediaSource(media?: HomeMediaSource | null): string {
  return normalize(media?.uploadedFile?.url) || normalize(media?.url);
}

/** Prefer a real thumbnail for video and the original for full-size photographs. */
export function homeImageCandidates(media?: HomeMediaSource | null, thumbnailFirst = false): string[] {
  if (!media) return [];
  const thumbs = [media.thumbnailUrl, media.uploadedFile?.thumbnailUrl];
  const originals = [media.uploadedFile?.url, media.url];
  const ordered = isHomeVideo(media) ? thumbs : thumbnailFirst ? [...thumbs, ...originals] : [...originals, ...thumbs];
  return [...new Set(ordered.map(normalize).filter(Boolean))];
}
