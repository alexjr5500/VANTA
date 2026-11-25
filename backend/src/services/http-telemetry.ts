import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';

const BOUNDS_MS = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 30000] as const;
export interface HttpWindow {
  durationMs: number;
  completed: number;
  aborted: number;
  serverErrors: number;
  errorRate: number | null;
  p95UpperMs: number | null;
  p95Overflow: boolean;
  active: number;
  histogram: number[];
}

export class HttpTelemetry {
  private started: number;
  private completed = 0;
  private aborted = 0;
  private serverErrors = 0;
  private active = 0;
  private histogram = Array<number>(BOUNDS_MS.length + 1).fill(0);

  constructor(private readonly now = () => performance.now()) { this.started = now(); }

  readonly middleware: RequestHandler = (_req, res, next) => {
    const started = this.now();
    this.active++;
    let settled = false;
    const settle = (aborted: boolean) => {
      if (settled) return;
      settled = true;
      this.active--;
      if (aborted) { this.aborted++; return; }
      this.completed++;
      if (res.statusCode >= 500 && res.statusCode <= 599) this.serverErrors++;
      const duration = Math.max(0, this.now() - started);
      const bucket = BOUNDS_MS.findIndex(bound => duration <= bound);
      this.histogram[bucket < 0 ? BOUNDS_MS.length : bucket]++;
    };
    res.once('finish', () => settle(false));
    res.once('close', () => settle(!res.writableFinished));
    next();
  };

  snapshotAndReset(): HttpWindow {
    const now = this.now();
    const target = Math.ceil(this.completed * 0.95);
    let total = 0;
    let index = -1;
    if (target > 0) {
      index = this.histogram.findIndex(n => { total += n; return total >= target; });
    }
    const result: HttpWindow = {
      durationMs: Math.max(0, now - this.started),
      completed: this.completed, aborted: this.aborted, serverErrors: this.serverErrors,
      errorRate: this.completed ? this.serverErrors / this.completed : null,
      p95UpperMs: index >= 0 && index < BOUNDS_MS.length ? BOUNDS_MS[index] : null,
      p95Overflow: index === BOUNDS_MS.length,
      active: this.active, histogram: [...this.histogram],
    };
    this.started = now;
    this.completed = this.aborted = this.serverErrors = 0;
    this.histogram.fill(0);
    return result;
  }
}

export type HttpAlert = 'high_server_error_rate' | 'high_api_latency' | 'high_aborted_requests';

/** Fixed conservative initial staging thresholds; do not page on a single sparse sample. */
export function evaluateHttpWindow(window: HttpWindow): HttpAlert[] {
  const alerts: HttpAlert[] = [];
  if (window.completed >= 20) {
    if (window.serverErrors >= 3 && window.errorRate !== null && window.errorRate >= 0.05) alerts.push('high_server_error_rate');
    if (window.p95Overflow || (window.p95UpperMs !== null && window.p95UpperMs > 1000)) alerts.push('high_api_latency');
  }
  if (window.completed + window.aborted >= 20 && window.aborted >= 3 &&
      window.aborted / (window.completed + window.aborted) >= 0.10) alerts.push('high_aborted_requests');
  return alerts;
}

/** Two consecutive bad windows required; per-code cooldown avoids a log flood. */
export class HttpAlertGate {
  private previous = new Set<HttpAlert>();
  private last = new Map<HttpAlert, number>();
  constructor(private readonly now = () => performance.now(), private readonly cooldownMs = 300000) {}
  evaluate(window: HttpWindow): HttpAlert[] {
    const current = evaluateHttpWindow(window);
    const now = this.now();
    const emitted = current.filter(code => this.previous.has(code) &&
      (!this.last.has(code) || now - this.last.get(code)! >= this.cooldownMs));
    emitted.forEach(code => this.last.set(code, now));
    this.previous = new Set(current);
    return emitted;
  }
}

export function startHttpTelemetry(telemetry: HttpTelemetry): () => void {
  const gate = new HttpAlertGate();
  const timer = setInterval(() => {
    const window = telemetry.snapshotAndReset();
    console.info(JSON.stringify({ event: 'vanta.http.window', schemaVersion: 1, scope: 'process',
      timestamp: new Date().toISOString(), boundsMs: BOUNDS_MS, ...window }));
    for (const code of gate.evaluate(window)) {
      console.warn(JSON.stringify({ event: 'vanta.http.alert', schemaVersion: 1,
        timestamp: new Date().toISOString(), scope: 'process', code, completed: window.completed,
        aborted: window.aborted, serverErrors: window.serverErrors, p95UpperMs: window.p95UpperMs,
        p95Overflow: window.p95Overflow }));
    }
  }, 60000);
  timer.unref?.();
  return () => clearInterval(timer);
}
