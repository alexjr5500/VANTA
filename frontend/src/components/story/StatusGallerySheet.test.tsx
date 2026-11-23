import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import StatusGallerySheet from './StatusGallerySheet';

const noOp = () => undefined;
const baseProps = {
  source: 'gallery-mixed' as const,
  selected: [],
  selectionLimit: 7,
  onGallery: noOp,
  onCameraPhoto: noOp,
  onCameraVideo: noOp,
  onRemove: noOp,
  onNext: noOp,
};

describe('Status gallery-first selection', () => {
  test('shows the real device picker entry instead of fake camera-roll thumbnails', () => {
    const html = renderToStaticMarkup(<StatusGallerySheet {...baseProps} />);
    expect(html).toContain('Recents');
    expect(html).toContain('Photos &amp; videos');
    expect(html).toContain('Only photos and videos you choose are added');
    expect(html).not.toContain('Next (');
    expect(html).not.toContain('Selected media 1');
  });

  test('renders genuine chosen thumbnail, selection number, removal and Next action', () => {
    const html = renderToStaticMarkup(
      <StatusGallerySheet
        {...baseProps}
        selected={[{
          id: 'photo-1',
          name: 'photo.jpg',
          kind: 'image' as const,
          objectUrl: 'blob:status-photo',
          thumbUrl: 'data:image/jpeg;base64,photo-thumbnail',
          duration: null,
        }]}
      />
    );
    expect(html).toContain('data:image/jpeg;base64,photo-thumbnail');
    expect(html).toContain('Selected media 1');
    expect(html).toContain('Remove photo.jpg');
    expect(html).toContain('Next (1)');
    expect(html).toContain('1 / 7 selected');
  });

  test('shows file validation errors before opening the editor', () => {
    const html = renderToStaticMarkup(
      <StatusGallerySheet {...baseProps} error="This image is larger than the 15MB limit." />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('larger than the 15MB limit');
    expect(html).not.toContain('Next (');
  });

  test('does not offer another gallery slot when the selection reaches its limit', () => {
    const html = renderToStaticMarkup(
      <StatusGallerySheet
        {...baseProps}
        selectionLimit={1}
        selected={[{
          id: 'video-1',
          name: 'clip.mp4',
          kind: 'video' as const,
          objectUrl: 'blob:status-video',
          thumbUrl: null,
          duration: 12,
        }]}
      />
    );
    expect(html).toContain('Next (1)');
    expect(html).toContain('Remove clip.mp4');
    expect(html).not.toContain('Choose more photos and videos');
  });
});
