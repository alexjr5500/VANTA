import type { RequestHandler } from 'express';

export type TrafficState = 'starting' | 'serving' | 'draining';
type ProbeResult = { status: 'ready' | 'not_ready'; reason?: 'starting' | 'draining' | 'database' | 'redis' };

/** A single-flight, short-lived readiness probe; timed-out work is not multiplied. */
export class ServerReadiness {
  private state: TrafficState = 'starting';
  private pending?: Promise<boolean>;
  private cached?: { ok: boolean; expires: number };
  constructor(
    private readonly databaseCheck: () => Promise<unknown>,
    private readonly redisCheck: () => boolean = () => true,
    private readonly timeoutMs = 1500,
    private readonly cacheMs = 1000,
  ) {}
  get draining(): boolean { return this.state === 'draining'; }
  markServing(): void { if (!this.draining) this.state = 'serving'; }
  beginDrain(): void { this.state = 'draining'; }
  private databaseReady(): Promise<boolean> {
    if (this.cached && this.cached.expires > Date.now()) return Promise.resolve(this.cached.ok);
    if (!this.pending) {
      this.pending = Promise.resolve().then(this.databaseCheck).then(() => true, () => false)
        .then(ok => {
          this.cached = { ok, expires: Date.now() + this.cacheMs };
          this.pending = undefined;
          return ok;
        });
    }
    const pending = this.pending;
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), this.timeoutMs);
      void pending.then(ok => { clearTimeout(timer); resolve(ok); });
    });
  }
  async readiness(): Promise<ProbeResult> {
    if (this.state !== 'serving') return { status: 'not_ready', reason: this.state };
    const databaseReady = await this.databaseReady();
    if (this.draining) return { status: 'not_ready', reason: 'draining' };
    if (!databaseReady) return { status: 'not_ready', reason: 'database' };
    try {
      if (!this.redisCheck()) return { status: 'not_ready', reason: 'redis' };
    } catch {
      return { status: 'not_ready', reason: 'redis' };
    }
    return { status: 'ready' };
  }
  readonly liveHandler: RequestHandler = (_req, res) => {
    res.set('Cache-Control', 'no-store').status(200).json({ status: 'alive' });
  };
  readonly readyHandler: RequestHandler = async (_req, res) => {
    const result = await this.readiness();
    res.set('Cache-Control', 'no-store').status(result.status === 'ready' ? 200 : 503).json(result);
  };
  readonly drainMiddleware: RequestHandler = (_req, res, next) => {
    if (!this.draining) { next(); return; }
    res.set('Connection', 'close').set('Retry-After', '5').set('Cache-Control', 'no-store')
      .status(503).json({ status: 'unavailable' });
  };
}

/** Stops newly scheduled work and waits for tracked tasks already in flight. */
export class BackgroundDrain {
  private stopping = false;
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  private readonly running = new Set<Promise<unknown>>();
  schedule(task: () => Promise<void>, intervalMs: number): void {
    if (this.stopping) return;
    let active = false;
    const run = () => {
      if (this.stopping || active) return;
      active = true;
      const job = Promise.resolve().then(task);
      this.running.add(job);
      void job.catch(() => console.warn('[BackgroundDrain] Scheduled task failed')).finally(() => {
        active = false;
        this.running.delete(job);
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    this.timers.add(timer);
  }
  async stop(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    await Promise.allSettled([...this.running]);
  }
}

/** An absolute shutdown deadline bounds hung requests and dependency cleanup. */
export async function shutdownWithin(task: () => Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(task).then(() => true, () => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
