// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addDrafts,
  removeDraft,
  canSend,
  hasBusyDraft,
  readyDraftCount,
  resetDraftIds,
  type AttachmentDraft,
} from './attachmentDrafts';

/**
 * Regression coverage for the VANTA chat composer's multi-attachment draft model.
 * These tests pin the "exactly ONE send affordance + select several / remove one"
 * behaviour that was previously a single-attachment, two-send-button flow.
 */

const makeFile = (name: string, type: string): File =>
  new File(['x'], name, { type });

const toPreview = (_file: File) => `blob:http://vanta.local/${_file.name}`;

function makeDraft(file: File, fileType: 'IMAGE' | 'VIDEO' = 'IMAGE'): AttachmentDraft {
  return {
    file,
    fileType,
    previewUrl: toPreview(file),
    progress: 0,
    status: 'ready',
    id: `d-${file.name}`,
  };
}

describe('attachmentDrafts (multi-select composer)', () => {
  beforeEach(() => resetDraftIds());

  it('adds several selected media files as separate drafts in one operation', () => {
    const draft = makeDraft(makeFile('a.jpg', 'image/jpeg'));
    const next = addDrafts(
      [draft],
      [
        { file: makeFile('b.jpg', 'image/jpeg'), fileType: 'IMAGE' },
        { file: makeFile('c.mp4', 'video/mp4'), fileType: 'VIDEO' },
      ],
      toPreview
    );
    expect(next).toHaveLength(3);
    expect(next.map(d => d.file.name)).toEqual(['a.jpg', 'b.jpg', 'c.mp4']);
    expect(next[2].fileType).toBe('VIDEO');
  });

  it('removes a single attachment without touching the others', () => {
    const list = [
      makeDraft(makeFile('a.jpg', 'image/jpeg')),
      makeDraft(makeFile('b.jpg', 'image/jpeg')),
      makeDraft(makeFile('c.mp4', 'video/mp4'), 'VIDEO'),
    ];
    const kept = removeDraft(list, 'd-b.jpg');
    expect(kept.map(d => d.file.name)).toEqual(['a.jpg', 'c.mp4']);
  });

  it('exposes exactly one send affordance when there is text, media, or both', () => {
    // Text only -> can send.
    expect(canSend([], 'hello')).toBe(true);
    // Media only -> can send through the SAME single send action.
    expect(canSend([makeDraft(makeFile('a.jpg', 'image/jpeg'))], '')).toBe(true);
    // Media + caption -> still can send (single submit = one logical message).
    expect(canSend([makeDraft(makeFile('a.jpg', 'image/jpeg'))], 'caption')).toBe(true);
    // Nothing -> cannot send.
    expect(canSend([], '')).toBe(false);
  });

  it('gates the send while any attachment is uploading/sending (no double-sends)', () => {
    const busy = [makeDraft(makeFile('a.jpg', 'image/jpeg'), 'IMAGE')];
    busy[0].status = 'uploading';
    expect(hasBusyDraft(busy)).toBe(true);
    busy[0].status = 'ready';
    expect(hasBusyDraft(busy)).toBe(false);
  });

  it('counts only ready attachments for the preview counter', () => {
    const list = [
      makeDraft(makeFile('a.jpg', 'image/jpeg')),
      makeDraft(makeFile('b.jpg', 'image/jpeg')),
      makeDraft(makeFile('c.mp4', 'video/mp4'), 'VIDEO'),
    ];
    expect(readyDraftCount(list)).toBe(3);
    list[1].status = 'failed';
    expect(readyDraftCount(list)).toBe(2);
  });

  it('assigns unique stable ids so individual removes stay correct', () => {
    const list = addDrafts([], [
      { file: makeFile('a.jpg', 'image/jpeg'), fileType: 'IMAGE' },
      { file: makeFile('b.jpg', 'image/jpeg'), fileType: 'IMAGE' },
    ], toPreview);
    const ids = new Set(list.map(d => d.id));
    expect(ids.size).toBe(2);
  });
});