import { DependencyProbe, DependencyAlertGate } from '../services/dependency-telemetry';

describe('dependency telemetry', () => {
  it('distinguishes disabled and unavailable and sanitizes failures', async () => {
    const check = jest.fn(async () => { throw Error('private detail'); });
    await expect(new DependencyProbe(false, check).sample()).resolves.toEqual({ status: 'disabled', latencyMs: null });
    expect(check).not.toHaveBeenCalled();
    await expect(new DependencyProbe(true, check).sample()).resolves.toMatchObject({ status: 'unavailable' });
  });
  it('measures slow successful operations', async () => {
    let now = 0;
    const p = new DependencyProbe(true, async () => { now = 300; return true; }, 2000, 250, () => now);
    await expect(p.sample()).resolves.toEqual({ status: 'slow', latencyMs: 300 });
  });
  it('does not accumulate commands after timeout and recovers after settlement', async () => {
    let finish!: (v: boolean) => void;
    const check = jest.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const p = new DependencyProbe(true, check, 10);
    const first = p.sample();
    expect(p.sample()).toBe(first);
    await expect(first).resolves.toEqual({ status: 'timeout', latencyMs: 10 });
    await expect(p.sample()).resolves.toMatchObject({ status: 'timeout' });
    expect(check).toHaveBeenCalledTimes(1);
    finish(true);
    await new Promise<void>(r => setImmediate(r));
    const second = p.sample();
    await Promise.resolve();
    finish(true);
    await expect(second).resolves.toMatchObject({ status: 'ok' });
    expect(check).toHaveBeenCalledTimes(2);
  });
  it('emits one sustained alert and one recovery', () => {
    const gate = new DependencyAlertGate();
    expect(gate.evaluate('postgres', 'timeout')).toBeNull();
    expect(gate.evaluate('postgres', 'unavailable')).toBe('degraded');
    expect(gate.evaluate('postgres', 'timeout')).toBeNull();
    expect(gate.evaluate('redis_cache', 'disabled')).toBeNull();
    expect(gate.evaluate('postgres', 'ok')).toBe('recovered');
    expect(gate.evaluate('postgres', 'ok')).toBeNull();
  });
});
