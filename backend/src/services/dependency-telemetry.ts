import { performance } from 'node:perf_hooks';

export type Status = 'ok' | 'slow' | 'unavailable' | 'timeout' | 'disabled';
export type Sample = { status: Status; latencyMs: number | null };
type Name = 'postgres' | 'redis_cache' | 'redis_realtime';

/** Keep one bounded result even if the underlying command never settles. */
export class DependencyProbe {
  private pending?: Promise<Sample>;
  constructor(private enabled: boolean, private check: () => Promise<boolean>,
    private timeoutMs = 2000, private slowMs = 250, private now = () => performance.now()) {}
  sample(): Promise<Sample> {
    if (!this.enabled) return Promise.resolve({ status: 'disabled', latencyMs: null });
    if (this.pending) return this.pending;
    const start = this.now();
    this.pending = new Promise<Sample>(resolve => {
      const timer = setTimeout(() => resolve({ status: 'timeout', latencyMs: this.timeoutMs }), this.timeoutMs);
      void Promise.resolve().then(this.check).then(ok => {
        const latencyMs = Math.max(0, this.now() - start);
        resolve({ status: !ok ? 'unavailable' : latencyMs > this.slowMs ? 'slow' : 'ok', latencyMs });
      }, () => {
        resolve({ status: 'unavailable', latencyMs: Math.max(0, this.now() - start) });
      }).finally(() => { clearTimeout(timer); this.pending = undefined; });
    });
    return this.pending;
  }
}

export class DependencyAlertGate {
  private streak = new Map<Name, number>();
  private active = new Set<Name>();
  evaluate(name: Name, status: Status): 'degraded' | 'recovered' | null {
    if (status === 'disabled' || status === 'ok') {
      this.streak.delete(name);
      const wasActive = this.active.delete(name);
      return status === 'ok' && wasActive ? 'recovered' : null;
    }
    const count = Math.min(2, (this.streak.get(name) ?? 0) + 1);
    this.streak.set(name, count);
    if (count < 2 || this.active.has(name)) return null;
    this.active.add(name);
    return 'degraded';
  }
}

export class DependencyTelemetry {
  private gate = new DependencyAlertGate();
  constructor(private probes: Record<Name, DependencyProbe>) {}
  async sample(): Promise<void> {
    const names: Name[] = ['postgres', 'redis_cache', 'redis_realtime'];
    const samples = await Promise.all(names.map(name => this.probes[name].sample()));
    const timestamp = new Date().toISOString();
    console.info(JSON.stringify({ event: 'vanta.dependencies.window', schemaVersion: 1, timestamp,
      scope: 'process', dependencies: Object.fromEntries(names.map((name, i) => [name, samples[i]])) }));
    names.forEach((name, i) => {
      const status = samples[i].status;
      const transition = this.gate.evaluate(name, status);
      if (!transition) return;
      const log = transition === 'degraded' ? console.warn : console.info;
      log(JSON.stringify({ event: 'vanta.dependencies.alert', schemaVersion: 1, timestamp,
        scope: 'process', dependency: name, transition, status }));
    });
  }
}
