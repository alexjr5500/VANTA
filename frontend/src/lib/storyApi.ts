'use client';

// ============================================================================
// STORY / STATUS API — one typed layer over the existing backend endpoints.
// Preserves the production Story data model; no new endpoints invented.
// ============================================================================

import { apiGet, apiPost, apiUpload } from '@/lib/apiClient';

export interface StoryAuthor {
  id: string;
  username: string;
  fullName?: string | null;
  avatar?: string | null;
  verified?: boolean;
}

export interface StoryItem {
  id: string;
  userId: string;
  mediaUrl: string;
  mediaType?: string; // IMAGE | VIDEO | TEXT
  caption?: string | null;
  textStyle?: string | null;
  duration?: number;
  expiresAt?: string;
  createdAt?: string;
  views?: number;
  viewed?: boolean;
  likeCount?: number;
  reshareCount?: number;
  commentCount?: number;
  likedByMe?: boolean;
  resharedFromId?: string | null;
  resharedFromUserId?: string | null;
  resharedFromUsername?: string | null;
  user?: StoryAuthor;
}

export interface StoryGroup {
  user: StoryAuthor;
  stories: StoryItem[];
  hasUnviewed: boolean;
}

export interface StoryUsage {
  used: number;
  limit: number;
  unlimited?: boolean;
}

/** Text Story / Status style payload authored by the premium text canvas. */
export interface TextStoryStyle {
  /** Curated background key from storyBackgrounds.ts */
  background?: string;
  font?: string;
  /** CSS font-size in px */
  size?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  weight?: number;
  italic?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
  /** Vertical placement: top / middle / bottom (plus pixel offset via gp). */
  alignY?: 'top' | 'middle' | 'bottom';
  /** Padding/position offset hint used by the viewer. */
  offsetY?: number;
  uppercase?: boolean;
  /** Optional caption text rendered beneath the styled headline. */
  caption?: string;
}

/** Group the flat `/api/stories` response by user (owner) — one tray entry per user. */
export function buildStoryGroups(raw: any): StoryGroup[] {
  const groups: StoryGroup[] = [];
  const byUser = new Map<string, StoryGroup>();
  const rawAny: any = raw;
  const entries: any[] = Array.isArray(rawAny) ? rawAny : rawAny?.stories ?? rawAny?.data ?? [];
  for (const entry of entries) {
    if (Array.isArray(entry?.stories)) {
      const user: StoryAuthor = entry.user || entry.author || {};
      const id = user.id || entry.userId || entry.ownerId;
      const key = String(id || JSON.stringify(user));
      let group = byUser.get(key);
      if (!group) {
        group = { user, stories: [], hasUnviewed: Boolean(entry.hasUnviewed) };
        byUser.set(key, group);
        groups.push(group);
      }
      for (const story of entry.stories || []) {
        group.stories.push(story);
        if (story && !story.viewed) group.hasUnviewed = true;
      }
    } else if (entry?.id && (entry.mediaUrl || entry.mediaType === 'TEXT')) {
      const user: StoryAuthor = entry.user || entry.author || {};
      const id = user.id || entry.userId;
      const key = String(id || entry.id);
      let group = byUser.get(key);
      if (!group) {
        group = { user, stories: [], hasUnviewed: Boolean(!entry.viewed) };
        byUser.set(key, group);
        groups.push(group);
      }
      group.stories.push(entry);
      if (entry && !entry.viewed) group.hasUnviewed = true;
    }
  }
  return groups;
}

/** Fetch the active Story/Status tray (grouped by user server-side). */
export function fetchStoryGroups(token?: string): Promise<StoryGroup[]> {
  return apiGet<StoryGroup[]>('/api/stories', token, { skipCache: true }).then(raw =>
    buildStoryGroups(raw as any)
  );
}

/** Today's published Status usage for the quota counter (used / limit). */
export function fetchStatusUsage(token?: string): Promise<StoryUsage> {
  return apiGet<StoryUsage>('/api/stories/usage', token, { skipCache: true });
}

/** Publish a Text Story / Status. `style` (optional) is serialized to JSON. */
export function publishTextStory(
  token: string,
  text: string,
  style?: TextStoryStyle
): Promise<StoryItem> {
  return apiPost<StoryItem>(
    '/api/stories/text',
    {
      text,
      textStyle: style && Object.keys(style).length > 0 ? JSON.stringify(style) : undefined,
    },
    token
  );
}

/** Upload a media file for a Story via the existing /api/upload pipeline. */
export function uploadStoryMedia(
  file: File,
  token: string,
  onProgress?: (percent: number) => void
): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('category', 'story');
  return apiUpload<{ id: string; url: string }>(
    '/api/upload',
    fd,
    token,
    'POST',
    onProgress
  );
}

/** Publish a photo/video Story from an already-uploaded media file. */
export function publishMediaStory(
  token: string,
  mediaFileId: string,
  caption?: string
): Promise<StoryItem> {
  return apiPost<StoryItem>(
    '/api/stories',
    { mediaFileId, caption: caption || undefined },
    token
  );
}

/** Record a Story view (deduplicated server-side). */
export function recordStoryView(storyId: string, token?: string): Promise<{ counted: boolean; views: number }> {
  return apiPost<{ counted: boolean; views: number }>(
    `/api/stories/${encodeURIComponent(storyId)}/view`,
    {},
    token
  );
}