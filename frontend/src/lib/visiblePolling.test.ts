import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVisiblePolling } from './visiblePolling';

afterEach(() => vi.useRealTimers());

describe('visible polling', () => {
  it('skips unavailable ticks, refreshes on resume and prevents overlapping requests', async () => {
    vi.useFakeTimers();
    let available = false;
    let notify!: () => void;
    let finish!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const onValue = vi.fn();
    const unsubscribe = vi.fn();
    const stop = startVisiblePolling({
      intervalMs: 1000, isAvailable: () => available,
      subscribe: callback => { notify = callback; return unsubscribe; },
      load, onValue,
    });
    try {
      await vi.advanceTimersByTimeAsync(3000);
      expect(load).not.toHaveBeenCalled();
      available = true; notify();
      await vi.advanceTimersByTimeAsync(3000);
      expect(load).toHaveBeenCalledTimes(1);
      finish('first'); await Promise.resolve();
      expect(onValue).toHaveBeenCalledWith('first');
      await vi.advanceTimersByTimeAsync(1000);
      expect(load).toHaveBeenCalledTimes(2);
      available = false;
      finish('hidden'); await Promise.resolve();
      expect(onValue).toHaveBeenCalledTimes(1);
      available = true; notify();
      expect(load).toHaveBeenCalledTimes(3);
      stop();
      finish('disposed'); await Promise.resolve();
      expect(onValue).toHaveBeenCalledTimes(1);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(load).toHaveBeenCalledTimes(3);
    } finally { stop(); }
  });
});
