import { MAX_STATUS_MEDIA_FILES } from '@/lib/storyMedia';

export interface StatusGalleryMedia {
  id: string;
  name: string;
  kind: 'image' | 'video';
  thumbUrl: string | null;
  objectUrl: string;
  duration: number | null;
}

/**
 * Device photos are only visible after the user selects them in the native
 * picker. Build the inline gallery from those real, user-chosen media files.
 */
export function getStatusGallerySelection(
  selected: ReadonlyArray<StatusGalleryMedia>,
  selectionLimit: number,
) {
  const limit = Math.max(0, Math.min(
    MAX_STATUS_MEDIA_FILES,
    Number.isFinite(selectionLimit) ? Math.trunc(selectionLimit) : 0,
  ));
  return {
    count: selected.length,
    limit,
    canAddMore: selected.length < limit,
    canPreview: selected.length > 0,
    tiles: selected.map((item, index) => ({
      ...item,
      selectionNumber: index + 1,
      previewUrl: item.kind === 'image' ? (item.thumbUrl || item.objectUrl) : item.thumbUrl,
    })),
  };
}
