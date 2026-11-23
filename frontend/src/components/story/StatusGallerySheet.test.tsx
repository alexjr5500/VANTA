import { describe, expect, test } from 'vitest';
import { getStatusGallerySelection } from '@/lib/statusGallerySelection';

describe('Status gallery-first selection rules', () => {
  test('starts empty and offers the secure native photo-picker action', () => {
    const model = getStatusGallerySelection([], 7);
    expect(model).toMatchObject({ count: 0, limit: 7, canAddMore: true, canPreview: false });
    expect(model.tiles).toEqual([]);
  });

  test('shows a real selected image thumbnail with its selection number', () => {
    const model = getStatusGallerySelection([{
      id: 'photo-1', name: 'photo.jpg', kind: 'image',
      objectUrl: 'blob:status-photo', thumbUrl: 'data:image/jpeg;base64,photo-thumbnail', duration: null,
    }], 7);
    expect(model.count).toBe(1);
    expect(model.canPreview).toBe(true);
    expect(model.tiles[0]).toMatchObject({
      name: 'photo.jpg', selectionNumber: 1, previewUrl: 'data:image/jpeg;base64,photo-thumbnail',
    });
  });

  test('uses the original local image blob when a thumbnail cannot be generated', () => {
    const model = getStatusGallerySelection([{
      id: 'photo-2', name: 'capture.heic', kind: 'image',
      objectUrl: 'blob:original-image', thumbUrl: null, duration: null,
    }], 7);
    expect(model.tiles[0].previewUrl).toBe('blob:original-image');
  });

  test('keeps a safe video tile without inventing an image', () => {
    const model = getStatusGallerySelection([{
      id: 'video-1', name: 'clip.mp4', kind: 'video',
      objectUrl: 'blob:video', thumbUrl: null, duration: 12,
    }], 7);
    expect(model.tiles[0].previewUrl).toBeNull();
    expect(model.tiles[0].selectionNumber).toBe(1);
  });

  test('does not offer another picker slot after reaching the selection limit', () => {
    const selection = [{ id: 'a', name: 'a.jpg', kind: 'image' as const, objectUrl: 'blob:a', thumbUrl: null, duration: null }];
    const model = getStatusGallerySelection(selection, 1);
    expect(model.canAddMore).toBe(false);
    expect(model.canPreview).toBe(true);
    expect(getStatusGallerySelection(selection, 999).limit).toBe(7);
  });
});
