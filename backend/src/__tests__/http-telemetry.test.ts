import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { HttpTelemetry, HttpAlertGate, evaluateHttpWindow, type HttpWindow } from '../services/http-telemetry';

describe('bounded HTTP telemetry', () => {
  let now = 0;
  let tracker: HttpTelemetry;
  beforeEach(() => { now = 0; tracker = new HttpTelemetry(() => now); });
  function request(status: number) {
    const response = Object.assign(new EventEmitter(), { statusCode: status, writableFinished: false });
    const next = jest.fn();
    tracker.middleware({} as Request, response as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    return response;
  }
  it('counts completions, errors and aborts exactly once and retains active count across windows', () => {
    const ok = request(200);
    const fail = request(503);
    const aborted = request(200);
    const pending = request(200);
    now = 40;
    ok.writableFinished = true; ok.emit('finish'); ok.emit('close');
    fail.writableFinished = true; fail.emit('finish'); fail.emit('close');
    aborted.emit('close');
    const first = tracker.snapshotAndReset();
    expect(first).toMatchObject({ completed: 2, serverErrors: 1, aborted: 1, active: 1, errorRate: 0.5, p95UpperMs: 50 });
    now = 70;
    pending.writableFinished = true; pending.emit('finish');
    expect(tracker.snapshotAndReset()).toMatchObject({ completed: 1, serverErrors: 0, aborted: 0, active: 0, errorRate: 0 });
    expect(tracker.snapshotAndReset()).toMatchObject({ completed: 0, errorRate: null, p95UpperMs: null });
  });
  it('has fixed histogram size and explicit overflow instead of reporting a false 30s bound', () => {
    const response = request(200);
    now = 31000;
    response.writableFinished = true; response.emit('finish');
    const result = tracker.snapshotAndReset();
    expect(result.histogram).toHaveLength(16);
    expect(result.p95UpperMs).toBeNull();
    expect(result.p95Overflow).toBe(true);
  });
  it('requires sustained traffic and cooldown; quiet windows clear previous violations', () => {
    const bad: HttpWindow = { durationMs: 60000, completed: 100, aborted: 15, serverErrors: 8,
      errorRate: 0.08, p95UpperMs: 1500, p95Overflow: false, active: 0, histogram: [] };
    const quiet: HttpWindow = { ...bad, completed: 0, aborted: 0, serverErrors: 0,
      errorRate: null, p95UpperMs: null };
    const gate = new HttpAlertGate(() => now, 300000);
    expect(evaluateHttpWindow(bad)).toHaveLength(3);
    expect(evaluateHttpWindow({ ...bad, completed: 1, aborted: 0, serverErrors: 1 })).toEqual([]);
    expect(gate.evaluate(bad)).toEqual([]);
    now += 60000;
    expect(gate.evaluate(bad)).toHaveLength(3);
    now += 60000;
    expect(gate.evaluate(bad)).toEqual([]);
    expect(gate.evaluate(quiet)).toEqual([]);
    now += 300000;
    expect(gate.evaluate(bad)).toEqual([]);
    expect(gate.evaluate(bad)).toHaveLength(3);
  });
});
