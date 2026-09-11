/**
 * Multi-attachment draft management for the VANTA chat composer.
 *
 * The composer can hold several pending media attachments at once. Each is a
 * draft with its own upload lifecycle (ready → uploading → sending → done) plus
 * local file metadata and a preview object URL for the caption input area.
 *
 * This module is deliberately pure and DOM-free so the multi-select + remove +
 * single-send behaviour can be unit-tested in the `node` vitest environment.
 */

export interface AttachmentDraft {
  /** Local File or trimmed File object to upload. */
  file: File;
  /** Object URL shown as the thumbnail while composing. */
  previewUrl: string;
  /** "IMAGE" or "VIDEO". */
  fileType: 'IMAGE' | 'VIDEO';
  /** Upload lifecycle progress 0-100. */
  progress: number;
  status: 'ready' | 'uploading' | 'sending' | 'failed';
  error?: string;
  /** Stable id so individual items can be removed/replaced reliably. */
  id: string;
}

export interface AttachmentDraftInput {
  file: File;
  fileType: 'IMAGE' | 'VIDEO';
}

let nextId = 0;
/** Deterministic-ish id generator (injectable for tests via `resetDraftIds`). */
export function draftId(): string {
  nextId += 1;
  return `draft-${nextId}`;
}

export function resetDraftIds(): void {
  nextId = 0;
}

/**
 * Add one or more validated media files to a draft list. Returns a new array
 * where every new file gets a fresh draft (rewinding existing preview URLs is
 * the caller's responsibility inside the React component).
 */
export function addDrafts(
  existing: AttachmentDraft[],
  inputs: AttachmentDraftInput[],
  makePreviewUrl: (file: File) => string
): AttachmentDraft[] {
  const created: AttachmentDraft[] = inputs.map((input) => ({
    file: input.file,
    previewUrl: makePreviewUrl(input.file),
    fileType: input.fileType,
    progress: 0,
    status: 'ready' as const,
    id: draftId(),
  }));
  return [...existing, ...created];
}

/** Remove a single draft by id without disturbing the others. */
export function removeDraft(existing: AttachmentDraft[], id: string): AttachmentDraft[] {
  return existing.filter((draft) => draft.id !== id);
}

/** True when any draft is still uploading/sending (gate concurrent sends). */
export function hasBusyDraft(drafts: AttachmentDraft[]): boolean {
  return drafts.some((draft) => draft.status === 'uploading' || draft.status === 'sending');
}

/**
 * True when the composer has something to send: non-empty text, at least one
 * ready draft, or one already in-flight (used to keep the send affordance).
 */
export function canSend(drafts: AttachmentDraft[], text: string): boolean {
  return Boolean(text.trim()) || drafts.length > 0;
}

/** Number of drafts that are actually ready (not failed / not removed). */
export function readyDraftCount(drafts: AttachmentDraft[]): number {
  return drafts.filter((draft) => draft.status === 'ready').length;
}