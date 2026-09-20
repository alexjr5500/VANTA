// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  STATUS_MAX_CHARS,
  STATUS_MAX_LINES,
  countStatusChars,
  countStatusLines,
  clampStatusText,
  normalizeStatusEditorValue,
  statusCounts,
} from './statusLimits';

describe('statusLimits hard limits (700 chars / 10 lines)', () => {
  it('counts characters as Unicode code points', () => {
    expect(countStatusChars('')).toBe(0);
    expect(countStatusChars('Hello VANTA')).toBe(11);
    // Emoji is a surrogate pair — must count as ONE character.
    expect(countStatusChars('🔥')).toBe(1);
    // ZWJ family: each emoji + ZWJ counts as one code point.
    expect(countStatusChars('👨‍👩‍👧')).toBe(5);
  });

  it('counts logical lines for \\n, \\r\\n and \\r', () => {
    expect(countStatusLines('a\nb\nc')).toBe(3);
    expect(countStatusLines('a\r\nb\rc')).toBe(3);
    expect(countStatusLines('')).toBe(0);
    expect(countStatusLines('single')).toBe(1);
  });

  it('accepts exactly 700 characters and rejects 701 via clamp', () => {
    const ok = 'a'.repeat(STATUS_MAX_CHARS);
    expect(clampStatusText(ok)).toHaveLength(STATUS_MAX_CHARS);

    const overflow = 'a'.repeat(STATUS_MAX_CHARS + 50);
    const clamped = clampStatusText(overflow);
    expect(clamped).toHaveLength(STATUS_MAX_CHARS);
  });

  it('clamps pasted content to 10 lines (truncates the 11th line)', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
    const clamped = clampStatusText(lines);
    expect(countStatusLines(clamped)).toBe(STATUS_MAX_LINES);
    expect(clamped.split('\n')[0]).toBe('line 1');
    expect(clamped.split('\n')[9]).toBe('line 10');
  });

  it('removes a trailing newline that would open an extra line', () => {
    // 10 full lines + trailing \n => still 10 lines after clamp.
    const text = Array.from({ length: STATUS_MAX_LINES }, () => 'x').join('\n') + '\n';
    expect(countStatusLines(text)).toBe(11);
    expect(countStatusLines(normalizeStatusEditorValue(text))).toBe(STATUS_MAX_LINES);
  });

  it('handles unicode and emoji pasted content without splitting surrogate pairs', () => {
    const text = '🚀VANTA🚀\n' + '🔥'.repeat(100) + '\nEnd';
    const clamped = clampStatusText(text);
    // A lone surrogate is a high surrogate not followed by a low one, or a low
    // surrogate not preceded by a high one. Code-point-safe clamping (Array.from
    // + slice) must never leave any behind.
    const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(LONE_SURROGATE.test(clamped)).toBe(false);
    // And the emoji that were pasted are still intact.
    expect(clamped).toContain('🚀');
    expect(clamped).toContain('🔥');
    expect(clampStatusText('🚀').length).toBe(2); // one code point = two UTF-16 units
  });

  it('computes status counters for the UI (chars + lines remaining)', () => {
    const counts = statusCounts('Hello\nVANTA');
    expect(counts.chars).toBe(11);
    expect(counts.lines).toBe(2);
    expect(counts.charsRemaining).toBe(STATUS_MAX_CHARS - 11);
    expect(counts.linesRemaining).toBe(STATUS_MAX_LINES - 2);
    expect(counts.overChars).toBe(false);
    expect(counts.overLines).toBe(false);
  });

  it('flags over-limit states', () => {
    const overChars = statusCounts('x'.repeat(STATUS_MAX_CHARS + 1));
    expect(overChars.overChars).toBe(true);

    const overLines = statusCounts('x\n'.repeat(STATUS_MAX_LINES));
    expect(overLines.overLines).toBe(true);
  });
});