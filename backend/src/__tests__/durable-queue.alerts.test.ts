import { evaluateDurableQueueHealth } from '../services/durable-queue.alerts';
import { DurableQueueHealth } from '../services/durable-queue.health';

const baseline: DurableQueueHealth = {
  pending: 0, active: 0, completed: 20, failed: 4,
  oldestPendingAgeSeconds: 0, expiredLeases: 0, recentFailures: 0,
};

describe('durable queue alert thresholds', () => {
  it('does not alert on historical failures or future-scheduled work', () => {
    expect(evaluateDurableQueueHealth({ ...baseline, pending: 3 })).toEqual({
      status: 'ok', health: { ...baseline, pending: 3 }, alerts: [],
    });
  });
  it('warns on overdue work, expired leases and recent failures without exposing job details', () => {
    const report = evaluateDurableQueueHealth({
      ...baseline, oldestPendingAgeSeconds: 130, expiredLeases: 1, recentFailures: 2,
    });
    expect(report.status).toBe('warning');
    expect(report.alerts.map(a => a.code)).toEqual(['overdue_backlog', 'expired_leases', 'recent_failures']);
    expect(JSON.stringify(report)).not.toMatch(/lastError|payload|workerId|deviceId/);
  });
  it('marks extreme backlog, expired leases and repeated failures critical', () => {
    const report = evaluateDurableQueueHealth({
      ...baseline, oldestPendingAgeSeconds: 601, expiredLeases: 3, recentFailures: 5,
    });
    expect(report.status).toBe('critical');
    expect(report.alerts).toHaveLength(3);
    expect(report.alerts.every(a => a.severity === 'critical')).toBe(true);
  });
  it('rejects invalid metrics instead of suppressing an alert', () => {
    expect(() => evaluateDurableQueueHealth({ ...baseline, recentFailures: NaN })).toThrow('Invalid queue metric');
  });
});
