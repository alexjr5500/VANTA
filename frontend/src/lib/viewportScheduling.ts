type ViewportValues = { height: number; offsetTop: number; keyboard: number; open: boolean };

export function viewportChanged(previous: ViewportValues, next: ViewportValues): boolean {
  return previous.height !== next.height || previous.offsetTop !== next.offsetTop ||
    previous.keyboard !== next.keyboard || previous.open !== next.open;
}

/** Merge bursts of resize/scroll/focus events into one visual frame. */
export function createFrameCoalescer(
  request: (callback: () => void) => number,
  cancel: (handle: number) => void,
  update: () => void,
) {
  let pending: number | null = null;
  let disposed = false;
  return {
    schedule() {
      if (disposed || pending !== null) return;
      pending = request(() => {
        pending = null;
        if (!disposed) update();
      });
    },
    dispose() {
      disposed = true;
      if (pending !== null) cancel(pending);
      pending = null;
    },
  };
}
