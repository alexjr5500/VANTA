import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const codes = [
  'high_server_error_rate', 'high_api_latency', 'high_aborted_requests',
  'postgres', 'redis_cache', 'redis_realtime',
  'overdue_backlog', 'expired_leases', 'recent_failures', 'queue_monitor_unavailable',
] as const;
export type AlertCode = typeof codes[number];
export type AlertInput = { code: AlertCode; transition: 'degraded' | 'recovered'; severity: 'warning' | 'critical' };
export type AlertSink = (input: AlertInput) => void;
type Config = { url: string; token: string; environment: string; service: string };

export function alertConfig(env: Record<string, string | undefined>): Config | null {
  if (env.VANTA_ALERT_WEBHOOK_ENABLED !== 'true') return null;
  try {
    const url = new URL(env.VANTA_ALERT_WEBHOOK_URL ?? '');
    const allowed = new URL(env.VANTA_ALERT_WEBHOOK_ALLOWED_ORIGIN ?? '');
    const token = env.VANTA_ALERT_WEBHOOK_TOKEN ?? '';
    const environment = env.VANTA_ALERT_ENVIRONMENT ?? '';
    const service = env.VANTA_ALERT_SERVICE ?? '';
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search ||
        allowed.href !== allowed.origin + '/' || url.origin !== allowed.origin ||
        !/^[A-Za-z0-9_-]{1,48}$/.test(environment) || !/^[A-Za-z0-9_-]{1,48}$/.test(service) ||
        token.length < 24 || token.length > 512 || /[^\x21-\x7e]/.test(token)) throw Error();
    return { url: url.href, token, environment, service };
  } catch {
    throw Error('Invalid alert webhook configuration');
  }
}

type Event = AlertInput & { schemaVersion: 1; eventId: string; timestamp: string; environment: string; service: string; instanceId: string };

/** Best-effort bounded in-memory delivery. Receiver must deduplicate eventId. */
export class AlertDelivery {
  private queue: Event[] = [];
  private running?: Promise<void>;
  private closed = false;
  private instanceId = randomUUID();
  constructor(private config: Config | null, private fetcher: typeof fetch = fetch,
    private pause: (ms: number) => Promise<unknown> = sleep) {}

  readonly enqueue: AlertSink = input => {
    if (!this.config || this.closed) return;
    if (!codes.includes(input.code) || !['degraded', 'recovered'].includes(input.transition) ||
        !['warning', 'critical'].includes(input.severity)) return;
    if (this.queue.length >= 24) {
      console.warn('[AlertDelivery] Queue full; event dropped');
      return;
    }
    // Explicit fields only: no caller metadata, request paths or error strings.
    this.queue.push({ schemaVersion: 1, code: input.code, severity: input.severity,
      transition: input.transition, eventId: randomUUID(), timestamp: new Date().toISOString(),
      environment: this.config.environment, service: this.config.service, instanceId: this.instanceId });
    if (!this.running) this.running = this.pump().finally(() => { this.running = undefined; });
  };

  private async pump(): Promise<void> {
    const config = this.config!;
    while (this.queue.length) {
      const event = this.queue.shift()!;
      let delivered = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        let retry = true;
        try {
          const response = await this.fetcher(config.url, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.token,
              'idempotency-key': event.eventId },
            body: JSON.stringify(event),
          });
          void response.body?.cancel().catch(() => {});
          if (response.ok) { delivered = true; break; }
          retry = response.status === 429 || response.status >= 500;
        } catch { /* network failure: bounded retry */ }
        if (!retry || attempt === 2) break;
        await this.pause(250 * 2 ** attempt);
      }
      if (!delivered) console.warn('[AlertDelivery] Event delivery failed');
    }
  }

  async flush(): Promise<void> {
    while (this.running) await this.running;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}
