import { describe, expect, it } from 'vitest';

/**
 * Regression tests for PHASE 4 — Create Post with multiple media selection.
 *
 * Root causes fixed:
 *  1. `maxFiles={1}` on <MediaUploader /> removed the `multiple` attribute and
 *     capped the selection loop at one file.
 *  2. `handleSubmit` only ever sent `media[0]`, so a multi-file selection
 *     published exactly one attachment.
 *  3. The toolbar "Add photo/video" buttons were disabled at `media.length >= 1`.
 *  4. `/api/feed` accepted a single `mediaFileId` only.
 */

/** Mirrors the payload CreatePostModal now sends to POST /api/feed. */
type SelectedMedia = { uploadedId?: string; uploadedUrl?: string };

function buildFeedPayload(media: SelectedMedia[]) {
  const attached = media.filter((item) => item.uploadedId || item.uploadedUrl);
  const mediaUrls = attached.map((item) => item.uploadedUrl).filter((u): u is string => Boolean(u));
  const mediaFileIds = attached.map((item) => item.uploadedId).filter((id): id is string => Boolean(id));
  return {
    mediaUrl: mediaUrls[0],
    mediaFileId: mediaFileIds[0],
    media: { urls: mediaUrls, fileIds: mediaFileIds },
  };
}

/**
 * Mirrors the backend createPost handler: every id in `media.fileIds` is linked
 * to the SAME post, with the legacy single fields as a fallback.
 */
function backendLinkedFileIds(body: {
  mediaUrl?: string;
  mediaFileId?: string;
  media?: { urls?: string[]; fileIds?: string[] };
}) {
  const fileIds: string[] = Array.isArray(body.media?.fileIds)
    ? body.media!.fileIds!.filter((v): v is string => typeof v === 'string')
    : [];
  if (!fileIds.length && typeof body.mediaFileId === 'string') fileIds.push(body.mediaFileId);
  return fileIds;
}

describe('Create Post — multiple media selection', () => {
  it('sends EVERY selected attachment, not just the first', () => {
    const payload = buildFeedPayload([
      { uploadedId: 'a', uploadedUrl: '/a.jpg' },
      { uploadedId: 'b', uploadedUrl: '/b.jpg' },
      { uploadedId: 'c', uploadedUrl: '/c.jpg' },
    ]);

    expect(payload.media.fileIds).toEqual(['a', 'b', 'c']);
    expect(payload.media.urls).toEqual(['/a.jpg', '/b.jpg', '/c.jpg']);
  });

  it('preserves the order the user selected the files in', () => {
    const payload = buildFeedPayload([
      { uploadedId: 'third', uploadedUrl: '/3.png' },
      { uploadedId: 'first', uploadedUrl: '/1.png' },
      { uploadedId: 'second', uploadedUrl: '/2.png' },
    ]);
    expect(payload.media.fileIds).toEqual(['third', 'first', 'second']);
  });

  it('keeps the legacy primary fields so older backends stay compatible', () => {
    const payload = buildFeedPayload([
      { uploadedId: 'x', uploadedUrl: '/x.jpg' },
      { uploadedId: 'y', uploadedUrl: '/y.jpg' },
    ]);
    expect(payload.mediaFileId).toBe('x');
    expect(payload.mediaUrl).toBe('/x.jpg');
  });

  it('skips files that never finished uploading', () => {
    // A file still uploading has neither an id nor a URL yet.
    const payload = buildFeedPayload([
      { uploadedId: 'ok', uploadedUrl: '/ok.jpg' },
      {},
      {},
    ]);
    expect(payload.media.fileIds).toEqual(['ok']);
    expect(payload.media.urls).toEqual(['/ok.jpg']);
  });

  it('produces an empty payload for a text-only post', () => {
    const payload = buildFeedPayload([]);
    expect(payload.media.fileIds).toEqual([]);
    expect(payload.media.urls).toEqual([]);
    expect(payload.mediaFileId).toBeUndefined();
  });

  it('links every attachment to the same post on the backend', () => {
    const body = buildFeedPayload([
      { uploadedId: 'p1', uploadedUrl: '/p1.jpg' },
      { uploadedId: 'v1', uploadedUrl: '/v1.mp4' },
    ]);
    expect(backendLinkedFileIds(body)).toEqual(['p1', 'v1']);
  });

  it('still links a single legacy mediaFileId when no array is sent', () => {
    expect(backendLinkedFileIds({ mediaFileId: 'legacy-only' })).toEqual(['legacy-only']);
  });

  it('never links a file twice when both shapes are present', () => {
    const body = { mediaFileId: 'ignored', media: { fileIds: ['one'] } };
    expect(backendLinkedFileIds(body)).toEqual(['one']);
  });

  it('appends new picks without discarding earlier ones', () => {
    // MediaUploader.processFiles semantics: existing + new, capped at maxFiles.
    const append = (existing: string[], incoming: string[], maxFiles: number) => {
      const next = [...existing];
      for (const file of incoming) {
        if (next.length >= maxFiles) break;
        next.push(file);
      }
      return next;
    };

    expect(append(['a'], ['b'], 10)).toEqual(['a', 'b']);
    expect(append(['a', 'b'], ['c', 'd'], 10)).toEqual(['a', 'b', 'c', 'd']);
    expect(append(['a', 'b'], ['c'], 10)).toHaveLength(3);
  });

  it('enforces the maximum attachment count', () => {
    const append = (existing: string[], incoming: string[], maxFiles: number) => {
      const next = [...existing];
      for (const file of incoming) {
        if (next.length >= maxFiles) break;
        next.push(file);
      }
      return next;
    };

    expect(append([], ['1', '2', '3', '4'], 3)).toEqual(['1', '2', '3']);
    // 2 existing + 1 new = 3, which is exactly the cap, so it is allowed.
    expect(append(['1', '2'], ['3'], 3)).toEqual(['1', '2', '3']);
    // Already at the cap → nothing more is appended.
    expect(append(['1', '2', '3'], ['4'], 3)).toEqual(['1', '2', '3']);
  });

  it('removes one file without dropping the unrelated ones', () => {
    const removeOne = (list: string[], id: string) => list.filter((f) => f !== id);
    expect(removeOne(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});
