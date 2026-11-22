import { randomUUID } from 'crypto';
import { DurableJob, DurableQueueRepository } from './durable-queue.repository';

export type DurableJobHandler = (job: DurableJob) => Promise<void>;

export interface DurableWorkerOptions {
  workerId?: string;
  concurrency?: number;
  leaseMs?: number;
  pollIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  excludedJobTypes?: readonly string[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Explicitly-started PostgreSQL worker. It has no import-time side effects:
 * callers must opt in by constructing and starting it after database startup.
 */
export class DurableQueueWorker {
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly excludedJobTypes: readonly string[];
  private stopping = false;
  private started = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly repository: DurableQueueRepository,
    private readonly handlers: ReadonlyMap<string, DurableJobHandler>,
    options: DurableWorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `vanta-worker-${randomUUID()}`;
    this.concurrency = options.concurrency ?? 2;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    this.retryMaxMs = options.retryMaxMs ?? 30_000;
    this.excludedJobTypes = options.excludedJobTypes ?? [];

    if (!this.workerId.trim()) throw new Error('workerId is required');
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error('concurrency must be a positive integer');
    if (!Number.isFinite(this.leaseMs) || this.leaseMs < 3_000) throw new Error('leaseMs must be at least 3000ms');
    if (!Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 1) throw new Error('pollIntervalMs must be positive');
    if (!Number.isFinite(this.retryBaseMs) || this.retryBaseMs < 0) throw new Error('retryBaseMs must be non-negative');
    if (!Number.isFinite(this.retryMaxMs) || this.retryMaxMs < this.retryBaseMs) throw new Error('retryMaxMs must be >= retryBaseMs');
  }

  get id(): string { return this.workerId; }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.loops = Array.from({ length: this.concurrency }, () => this.poll());
  }

  /** Stop claiming new work and wait for already-claimed handlers to settle. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.stopping = true;
    await Promise.all(this.loops);
    this.loops = [];
    this.started = false;
  }

  private async poll(): Promise<void> {
    while (!this.stopping) {
      let job: DurableJob | null = null;
      try {
        job = await this.repository.claim(this.workerId, this.leaseMs, this.excludedJobTypes);
      } catch (error) {
        console.error('[DurableQueueWorker] Claim failed:', error);
      }

      if (this.stopping) break;
      if (!job) {
        await sleep(this.pollIntervalMs);
        continue;
      }

      // A single job's handler or persistence failure must never reject this
      // polling loop and silently reduce worker concurrency.
      try {
        await this.process(job);
      } catch (error) {
        console.error(`[DurableQueueWorker] Unexpected processing failure for ${job.id}; lease recovery will retry it:`, error);
      }
    }
  }

  private async process(job: DurableJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      try {
        const failed = await this.repository.failPermanently(
          job.id,
          this.workerId,
          new Error(`No durable handler registered for job type: ${job.type}`),
        );
        if (!failed) console.warn(`[DurableQueueWorker] Lost ownership before failing unsupported job ${job.id}`);
      } catch (error) {
        // Leave the lease intact. Another claim can recover it after expiry.
        console.error(`[DurableQueueWorker] Could not record unsupported job ${job.id}; lease recovery will retry it:`, error);
      }
      return;
    }

    let leaseLost = false;
    let heartbeatStopped = false;
    let heartbeatPromise: Promise<void> | null = null;
    const heartbeat = async (): Promise<void> => {
      if (heartbeatStopped || heartbeatPromise || leaseLost) return;
      heartbeatPromise = (async () => {
        try {
          const renewed = await this.repository.renewLease(job.id, this.workerId, this.leaseMs);
          if (!renewed) leaseLost = true;
        } catch (error) {
          console.error(`[DurableQueueWorker] Lease renewal failed for ${job.id}:`, error);
          leaseLost = true;
        } finally {
          heartbeatPromise = null;
        }
      })();
      await heartbeatPromise;
    };
    const heartbeatTimer = setInterval(() => { void heartbeat(); }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
    const stopHeartbeat = async (): Promise<void> => {
      heartbeatStopped = true;
      clearInterval(heartbeatTimer);
      // Do not race a final lease renewal against complete/fail: a delayed
      // heartbeat could otherwise extend a lease after ownership was released.
      const inFlightHeartbeat = heartbeatPromise;
      if (inFlightHeartbeat) await inFlightHeartbeat;
    };

    let handlerFailed = false;
    let handlerError: unknown;
    try {
      await handler(job);
    } catch (error) {
      handlerFailed = true;
      handlerError = error;
    }

    await stopHeartbeat();
    if (leaseLost) {
      console.warn(`[DurableQueueWorker] Lease lost while processing ${job.id}; leaving it for lease recovery`);
      return;
    }

    if (handlerFailed) {
      const exponent = Math.max(0, job.attempts - 1);
      const delay = Math.min(this.retryBaseMs * (2 ** exponent), this.retryMaxMs);
      const jitteredDelay = Math.round(delay * (0.8 + Math.random() * 0.4));
      try {
        const failed = await this.repository.fail(job.id, this.workerId, handlerError, jitteredDelay);
        if (!failed) console.warn(`[DurableQueueWorker] Lost ownership before recording failure for ${job.id}`);
      } catch (error) {
        // Do not crash the poller or acknowledge the job. Its lease will expire
        // and a later worker can safely reclaim it (at-least-once delivery).
        console.error(`[DurableQueueWorker] Could not persist failure for ${job.id}; lease recovery will retry it:`, error);
      }
      console.error(`[DurableQueueWorker] Handler failed for ${job.id}:`, handlerError);
      return;
    }

    try {
      const completed = await this.repository.complete(job.id, this.workerId);
      if (!completed) console.warn(`[DurableQueueWorker] Lost ownership before completing ${job.id}`);
    } catch (error) {
      // Completion is not assumed. Keep the active lease so PostgreSQL can
      // recover the job after expiry rather than falsely reporting success.
      console.error(`[DurableQueueWorker] Could not persist completion for ${job.id}; lease recovery will retry it:`, error);
    }
  }
}
