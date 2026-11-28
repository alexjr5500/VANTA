interface VisiblePollingOptions<T> {
  intervalMs: number;
  isAvailable: () => boolean;
  subscribe: (notify: () => void) => () => void;
  load: () => Promise<T>;
  onValue: (value: T) => void;
}

/** One request at a time; skip hidden/offline ticks and ignore disposed results. */
export function startVisiblePolling<T>(options: VisiblePollingOptions<T>): () => void {
  let disposed = false;
  let running = false;
  const tick = async () => {
    if (disposed || running || !options.isAvailable()) return;
    running = true;
    try {
      const value = await options.load();
      if (!disposed && options.isAvailable()) options.onValue(value);
    } catch {
      // Preserve the last successful value; retry on the next normal tick.
    } finally { running = false; }
  };
  const notify = () => { void tick(); };
  const unsubscribe = options.subscribe(notify);
  const interval = setInterval(notify, options.intervalMs);
  notify();
  return () => {
    disposed = true;
    clearInterval(interval);
    unsubscribe();
  };
}
