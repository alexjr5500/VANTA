import { describe, expect, it, vi } from 'vitest';
import { createFrameCoalescer, viewportChanged } from './viewportScheduling';

describe('mobile viewport scheduling', () => {
  it('coalesces a burst into one frame and allows subsequent changes', () => {
    const callbacks: Array<() => void> = [];
    const request = vi.fn((fn: () => void) => { callbacks.push(fn); return callbacks.length - 1; });
    const update = vi.fn();
    const scheduler = createFrameCoalescer(request, vi.fn(), update);
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(request).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    callbacks[0]();
    expect(update).toHaveBeenCalledTimes(1);
    scheduler.schedule();
    callbacks[1]();
    expect(update).toHaveBeenCalledTimes(2);
  });
  it('cancels pending work on disposal, including frame handle zero', () => {
    let callback!: () => void;
    const cancel = vi.fn();
    const update = vi.fn();
    const scheduler = createFrameCoalescer(fn => { callback = fn; return 0; }, cancel, update);
    scheduler.schedule();
    scheduler.dispose();
    callback();
    scheduler.schedule();
    expect(cancel).toHaveBeenCalledWith(0);
    expect(update).not.toHaveBeenCalled();
  });
  it('suppresses identical viewport values but detects keyboard and geometry changes', () => {
    const base = { height: 800, offsetTop: 0, keyboard: 0, open: false };
    expect(viewportChanged(base, { ...base })).toBe(false);
    expect(viewportChanged(base, { ...base, height: 500, keyboard: 300, open: true })).toBe(true);
    expect(viewportChanged(base, { ...base, offsetTop: 20 })).toBe(true);
  });
});
