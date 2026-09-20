'use client';

// ============================================================================
// STATUS HARD LIMITS — single source of truth on the frontend.
// A "Status" is the text posted to a user's Story/Status tray. The limits are
// enforced here for typing / pasting / editing, and independently re-enforced
// on the backend (services/story.service.ts) so they can NEVER be bypassed.
// ============================================================================

export const STATUS_MAX_CHARS = 700;
export const STATUS_MAX_LINES = 10;

/** Count text length in Unicode code points (emoji count once, not per UTF-16 half). */
export function countStatusChars(text: string): number {
  return Array.from(text || '').length;
}

/** Count logical lines. Any of \n, \r\n or \r terminate a line. */
export function countStatusLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

/** Truncate to max code points — safe for emoji / combining sequences. */
export function truncateToCodePoints(text: string, max: number): string {
  return Array.from(text || '').slice(0, max).join('');
}

/**
 * Clamp arbitrary inbound text (paste, pre-filled edit, autofill, drag-drop)
 * to the hard limits. Order matters:
 *   1. character cap (700 code points),
 *   2. line cap (first 10 logical lines).
 * A trailing newline that would open an 11th line is also removed.
 */
export function clampStatusText(text: string): string {
  let out = truncateToCodePoints(text || '', STATUS_MAX_CHARS);
  const parts = out.split(/\r\n|\r|\n/);
  if (parts.length > STATUS_MAX_LINES) {
    out = parts.slice(0, STATUS_MAX_LINES).join('\n');
  }
  return out;
}

/**
 * Normalize an editor value back into the hard limits while preserving the
 * user's draft for typeahead handling. Used by the Status / Text Story
 * composers on every keystroke, paste and external update.
 */
export function normalizeStatusEditorValue(text: string): string {
  return clampStatusText(text || '');
}

export interface StatusCounts {
  chars: number;
  lines: number;
  /** Characters remaining until the 700 cap (0 means full). */
  charsRemaining: number;
  /** Lines remaining until the 10-line cap (0 means full). */
  linesRemaining: number;
  overChars: boolean;
  overLines: boolean;
}

export function statusCounts(text: string): StatusCounts {
  const chars = countStatusChars(text);
  const lines = countStatusLines(text);
  return {
    chars,
    lines,
    charsRemaining: Math.max(0, STATUS_MAX_CHARS - chars),
    linesRemaining: Math.max(0, STATUS_MAX_LINES - lines),
    overChars: chars > STATUS_MAX_CHARS,
    overLines: lines > STATUS_MAX_LINES,
  };
}