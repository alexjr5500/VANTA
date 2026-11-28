import { DurableQueueHealth } from './durable-queue.health';

export type DurableQueueAlertSeverity = 'warning' | 'critical';
export type DurableQueueAlertCode = 'overdue_backlog' | 'expired_leases' | 'recent_failures';
export interface DurableQueueAlert {
  code: DurableQueueAlertCode;
  severity: DurableQueueAlertSeverity;
  observed: number;
  threshold: number;
}
export interface DurableQueueMonitorReport {
  status: 'ok' | 'warning' | 'critical';
  health: DurableQueueHealth;
  alerts: DurableQueueAlert[];
}

/**
 * Fixed conservative defaults for a staging signal. These are thresholds,
 * not a substitute for baselining actual traffic and worker capacity.
 * Failures use a rolling 15-minute window to avoid permanent alerts.
 */
const LIMITS = {
  backlogWarningSeconds: 120,
  backlogCriticalSeconds: 600,
  expiredWarning: 1,
  expiredCritical: 3,
  failedWarning: 1,
  failedCritical: 5,
} as const;

export function evaluateDurableQueueHealth(health: DurableQueueHealth): DurableQueueMonitorReport {
  const alerts: DurableQueueAlert[] = [];
  const check = (
    code: DurableQueueAlertCode,
    observed: number,
    warning: number,
    critical: number,
  ) => {
    if (!Number.isFinite(observed) || observed < 0) throw new Error('Invalid queue metric: ' + code);
    if (observed >= critical) alerts.push({ code, severity: 'critical', observed, threshold: critical });
    else if (observed >= warning) alerts.push({ code, severity: 'warning', observed, threshold: warning });
  };
  check('overdue_backlog', health.oldestPendingAgeSeconds, LIMITS.backlogWarningSeconds, LIMITS.backlogCriticalSeconds);
  check('expired_leases', health.expiredLeases, LIMITS.expiredWarning, LIMITS.expiredCritical);
  check('recent_failures', health.recentFailures, LIMITS.failedWarning, LIMITS.failedCritical);
  return {
    status: alerts.some(a => a.severity === 'critical') ? 'critical' : alerts.length ? 'warning' : 'ok',
    health,
    alerts,
  };
}
