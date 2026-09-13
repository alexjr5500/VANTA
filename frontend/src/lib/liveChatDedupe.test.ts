// @vitest-environment node
/**
 * Regression coverage for Live chat message reconciliation (liveChatDedupe).
 *
 * Historically the Live overlays appended every `new_comment` and every
 * `host_chat_history` payload verbatim, so the same server message arriving
 * through multiple near-simultaneous paths (history load, live push, extra
 * `user_<hostId>` push for the host, post-reconnect overlap) rendered twice.
 * These tests pin that each message lands exactly once by stable id, and that
 * the visible overlay stays compact while older messages remain reachable —
 * i.e. never destructively deleted.
 */
import { describe, expect, it } from 'vitest';
import { reconcileLiveChat, type ChatLineLike } from './liveChatDedupe';

// A history message (has an id) and a wall-clock at.
const base = (id: string, message: string, at: number, userId = 'u1'): ChatLineLike => ({
  id,
  message,
  userId,
  at,
  kind: 'comment',
});

describe('reconcileLiveChat deduplication', () => {
  it('collapses the exact same message delivered twice into one line', () => {
    const m = base('msg-42', 'hello everyone', 1000);
    // History load + a duplicate live push (the host `user_<hostId>` path).
    const result = reconcileLiveChat([], [m, m, m]);
    expect(result.visible.map((x) => x.id)).toEqual(['msg-42']);
    expect(result.visible).toHaveLength(1);
  });

  it('dedups across a history reload that overlaps already-applied messages', () => {
    const history = [base('1', 'one', 1), base('2', 'two', 2), base('3', 'three', 3)];
    const working = [base('2', 'two', 2), base('3', 'three', 3), base('4', 'four', 4)];
    const result = reconcileLiveChat(working, history);
    expect(result.visible.map((x) => x.id).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('keeps oldest-first ordering when timestamps are present', () => {
    const result = reconcileLiveChat([], [base('b', 'newer', 2000), base('a', 'older', 1000)]);
    expect(result.visible.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('dedups duplicate pushes while preserving arrival order', () => {
    const batch = [base('1', 'one', 1), base('2', 'two', 2), base('2', 'two', 2), base('3', 'three', 3)];
    const result = reconcileLiveChat([], batch);
    expect(result.visible.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('uses a custom idOf when the message id lives elsewhere', () => {
    const lines = [{ _id: 'x9', message: 'hi' }, { _id: 'x9', message: 'hi' }];
    const result = reconcileLiveChat([], lines, { idOf: (l) => (l as { _id?: unknown })._id });
    expect(result.visible).toHaveLength(1);
  });

  it('collapses same-author+topic clones only when no id is available', () => {
    const a = { message: 'dup', userId: 'u1', at: 1 };
    const b = { message: 'dup', userId: 'u1', at: 2 };
    const c = { message: 'dup', userId: 'u2', at: 3 };
    const result = reconcileLiveChat([], [a, b, c]);
    // a & b are identical no-id clones → one; c is a different author → kept.
    expect(result.visible).toHaveLength(2);
  });
});

describe('reconcileLiveChat working-set / overflow semantics', () => {
  it('caps the visible set to maxVisible while keeping the rest as overflow', () => {
    const batch = Array.from({ length: 90 }, (_, i) => base(`m${i}`, `msg ${i}`, i));
    const result = reconcileLiveChat([], batch, { maxVisible: 80 });
    expect(result.visible).toHaveLength(80);
    // Nothing is deleted — the oldest 10 remain accessible.
    expect(result.overflow.map((x) => x.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    // The visible slice is the newest 80 (m10..m89).
    expect(result.visible[0].id).toBe('m10');
    expect(result.visible[79].id).toBe('m89');
  });

  it('preserves earlier overflow when a new overflow arrives', () => {
    const first = reconcileLiveChat([], Array.from({ length: 90 }, (_, i) => base(`a${i}`, `x ${i}`, i)), { maxVisible: 80, maxOverflow: 100 });
    const second = reconcileLiveChat([], Array.from({ length: 90 }, (_, i) => base(`b${i}`, `y ${i}`, 1000 + i)), { maxVisible: 80, maxOverflow: 100 });
    // first.overflow = a0..a9, second.overflow = b0..b9. Composing them (a "full
    // chat" view) keeps both old and new content, proving nothing was
    // destructively dropped from the earlier overflow.
    const composed = reconcileLiveChat(first.overflow, second.overflow, { maxVisible: 1000, maxOverflow: 200 });
    expect(composed.visible.map((x) => x.id)).toContain('a0');
    expect(composed.visible.map((x) => x.id)).toContain('a9');
    expect(composed.visible.map((x) => x.id)).toContain('b0');
    expect(composed.visible.map((x) => x.id)).toContain('b9');
  });
});