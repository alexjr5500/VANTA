// Performance monitoring service
// Tracks API latency, database performance, cache hit ratio, etc.
// Provides real-time metrics, alerting, and health checks

interface MetricPoint {
  timestamp: number;
  value: number;
  label?: string;
  tags?: Record<string, string>;
}

interface MetricBucket {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  values: number[];
}

interface AlertRule {
  metricName: string;
  condition: 'gt' | 'lt' | 'gte' | 'lte';
  threshold: number;
  duration: number; // How long condition must be true before alerting (ms)
  cooldown: number; // Min time between alerts (ms)
  severity: 'info' | 'warning' | 'critical';
  message: string;
  lastAlerted?: number;
  triggeredAt?: number;
}

type AlertHandler = (alert: { rule: AlertRule; currentValue: number; metricName: string }) => void;

class MetricsCollector {
  private metrics: Map<string, MetricPoint[]> = new Map();
  private readonly maxPoints: number = 1000;
  private readonly retentionMs: number = 3_600_000; // 1 hour retention
  private alertRules: AlertRule[] = [];
  private alertHandlers: AlertHandler[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodic cleanup of old data
    this.cleanupInterval = setInterval(() => this.cleanup(), 300_000); // 5 min
    this.cleanupInterval.unref?.();
  }

  // Record a metric value
  record(name: string, value: number, label?: string, tags?: Record<string, string>): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    const points = this.metrics.get(name)!;
    points.push({ timestamp: Date.now(), value, label, tags });
    
    // Trim old points to prevent memory leak
    if (points.length > this.maxPoints) {
      points.splice(0, points.length - this.maxPoints);
    }

    // Check alert rules
    this.checkAlerts(name, value);
  }

  // Record a duration metric (automatically tracks count, sum, min, max)
  recordDuration(name: string, durationMs: number, tags?: Record<string, string>): void {
    this.record(name, durationMs, undefined, tags);
    this.record(`${name}.count`, 1, undefined, tags);
  }

  // Increment a counter metric
  increment(name: string, amount: number = 1, tags?: Record<string, string>): void {
    const points = this.metrics.get(name);
    const last = points && points.length > 0 ? points[points.length - 1] : null;
    const currentValue = last ? last.value : 0;
    this.record(name, currentValue + amount, undefined, tags);
  }

  // Get all points for a metric
  get(name: string): MetricPoint[] {
    return this.metrics.get(name) || [];
  }

  // Get aggregated statistics for a metric within a time window
  getStats(name: string, windowMs: number = 300_000): MetricBucket | null {
    const points = this.metrics.get(name);
    if (!points || points.length === 0) return null;

    const cutoff = Date.now() - windowMs;
    const recent = points.filter(p => p.timestamp >= cutoff);
    if (recent.length === 0) return null;

    const values = recent.map(p => p.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const count = values.length;
    
    return {
      count,
      sum,
      avg: sum / count,
      min: values[0],
      max: values[values.length - 1],
      p50: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
      values,
    };
  }

  // Get all metrics summary
  getAllStats(windowMs: number = 300_000): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [name] of this.metrics) {
      const stats = this.getStats(name, windowMs);
      if (stats) {
        result[name] = {
          count: stats.count,
          avg: Math.round(stats.avg * 100) / 100,
          min: stats.min,
          max: stats.max,
          p50: stats.p50,
          p95: stats.p95,
          p99: stats.p99,
          lastValue: this.getLastValue(name),
        };
      }
    }
    return result;
  }

  // Get the most recent value
  getLastValue(name: string): number | null {
    const points = this.metrics.get(name);
    if (!points || points.length === 0) return null;
    return points[points.length - 1].value;
  }

  // Get current rate (per second) for a metric
  getRate(name: string, windowMs: number = 60_000): number {
    const stats = this.getStats(name, windowMs);
    if (!stats) return 0;
    return stats.count / (windowMs / 1000);
  }

  // Add an alert rule
  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
  }

  // Register an alert handler
  onAlert(handler: AlertHandler): void {
    this.alertHandlers.push(handler);
  }

  // Check all alert rules for a metric
  private checkAlerts(name: string, currentValue: number): void {
    const now = Date.now();
    for (const rule of this.alertRules) {
      if (rule.metricName !== name) continue;

      // Check cooldown
      if (rule.lastAlerted && (now - rule.lastAlerted) < rule.cooldown) continue;

      // Check if condition has been true for long enough
      let triggered = false;
      switch (rule.condition) {
        case 'gt': triggered = currentValue > rule.threshold; break;
        case 'lt': triggered = currentValue < rule.threshold; break;
        case 'gte': triggered = currentValue >= rule.threshold; break;
        case 'lte': triggered = currentValue <= rule.threshold; break;
      }

      if (triggered) {
        if (!rule.triggeredAt) {
          rule.triggeredAt = now;
        } else if ((now - rule.triggeredAt) >= rule.duration) {
          // Alert!
          rule.lastAlerted = now;
          rule.triggeredAt = undefined;
          
          const alert = { rule, currentValue, metricName: name };
          for (const handler of this.alertHandlers) {
            try {
              handler(alert);
            } catch {
              // Ignore handler errors
            }
          }
          
          console.warn(`[ALERT] ${rule.severity.toUpperCase()}: ${rule.message} (current: ${currentValue}, threshold: ${rule.threshold})`);
        }
      } else {
        rule.triggeredAt = undefined;
      }
    }
  }

  // Reset all metrics
  reset(): void {
    this.metrics.clear();
  }

  // Cleanup old data
  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    for (const [, points] of this.metrics) {
      while (points.length > 0 && points[0].timestamp < cutoff) {
        points.shift();
      }
    }
  }

  // Destroy collector
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// API Latency tracking middleware
class ApiLatencyTracker {
  private collector: MetricsCollector;

  constructor(collector: MetricsCollector) {
    this.collector = collector;
  }

  middleware() {
    return (req: any, res: any, next: any) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        const route = req.route?.path || req.path || 'unknown';
        const method = req.method;
        const statusCode = res.statusCode;
        const metricName = `api.${method}.${route}`;
        const statusGroup = `${Math.floor(statusCode / 100)}xx`;
        const tags = { method, route, statusCode: String(statusCode) };
        
        this.collector.recordDuration(metricName, duration, tags);
        this.collector.recordDuration(`api.${statusGroup}`, duration, tags);
        this.collector.recordDuration('api.all', duration, tags);
        this.collector.increment(`api.requests.${statusGroup}`, 1, tags);

        // Log slow requests (>1s)
        if (duration > 1000) {
          console.warn(`[SLOW] ${method} ${route} - ${duration}ms (${statusCode})`);
          this.collector.increment('api.slow_requests', 1, tags);
        }
      });

      next();
    };
  }
}

// Database query performance tracker
class DbPerformanceTracker {
  private collector: MetricsCollector;
  private slowQueryThreshold: number = 200; // ms

  constructor(collector: MetricsCollector) {
    this.collector = collector;
  }

  trackQuery(modelName: string, queryTime: number, queryType: string): void {
    const tags = { model: modelName, type: queryType };
    this.collector.recordDuration(`db.${modelName}.${queryType}`, queryTime, tags);
    this.collector.recordDuration('db.all', queryTime, tags);
    this.collector.increment('db.queries', 1, tags);

    if (queryTime > this.slowQueryThreshold) {
      console.warn(`[SLOW DB] ${modelName}.${queryType} - ${queryTime}ms`);
      this.collector.increment('db.slow_queries', 1, tags);
    }
  }

  setSlowQueryThreshold(ms: number): void {
    this.slowQueryThreshold = ms;
  }

  get averageQueryTime(): number {
    const stats = this.collector.getStats('db.all');
    return stats ? Math.round(stats.avg) : 0;
  }

  get slowQueryCount(): number {
    const stats = this.collector.getStats('db.slow_queries');
    return stats ? stats.count : 0;
  }
}

// Cache performance tracker
class CachePerformanceTracker {
  private collector: MetricsCollector;

  constructor(collector: MetricsCollector) {
    this.collector = collector;
  }

  recordHit(cacheLayer: string): void {
    this.collector.increment(`cache.${cacheLayer}.hit`, 1);
  }

  recordMiss(cacheLayer: string): void {
    this.collector.increment(`cache.${cacheLayer}.miss`, 1);
  }

  getHitRate(cacheLayer: string, windowMs: number = 300_000): number {
    const hits = this.collector.getStats(`cache.${cacheLayer}.hit`, windowMs);
    const misses = this.collector.getStats(`cache.${cacheLayer}.miss`, windowMs);
    const totalHits = hits?.count || 0;
    const totalMisses = misses?.count || 0;
    const total = totalHits + totalMisses;
    return total === 0 ? 0 : totalHits / total;
  }

  overallHitRate(windowMs: number = 300_000): number {
    return this.getHitRate('all', windowMs);
  }
}

// Health status tracker
class HealthStatus {
  private statuses: Map<string, { status: 'healthy' | 'degraded' | 'down'; lastCheck: number; message?: string }> = new Map();
  private startTime: number = Date.now();

  setHealthy(service: string, message?: string): void {
    this.statuses.set(service, { status: 'healthy', lastCheck: Date.now(), message });
  }

  setDegraded(service: string, message?: string): void {
    this.statuses.set(service, { status: 'degraded', lastCheck: Date.now(), message });
  }

  setDown(service: string, message?: string): void {
    this.statuses.set(service, { status: 'down', lastCheck: Date.now(), message });
  }

  getStatus(service: string): { status: string; lastCheck: number; message?: string } | undefined {
    return this.statuses.get(service);
  }

  getAllStatuses(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [service, status] of this.statuses) {
      result[service] = status;
    }
    return result;
  }

  get overallHealth(): 'healthy' | 'degraded' | 'down' {
    const statuses = Array.from(this.statuses.values());
    if (statuses.some(s => s.status === 'down')) return 'down';
    if (statuses.some(s => s.status === 'degraded')) return 'degraded';
    return 'healthy';
  }

  get uptime(): number {
    return Date.now() - this.startTime;
  }
}

// Export singleton instances
export const metricsCollector = new MetricsCollector();
export const apiLatencyTracker = new ApiLatencyTracker(metricsCollector);
export const dbPerformanceTracker = new DbPerformanceTracker(metricsCollector);
export const cachePerformanceTracker = new CachePerformanceTracker(metricsCollector);
export const healthStatus = new HealthStatus();

// Convenience middleware
export const apiLatencyMiddleware = apiLatencyTracker.middleware();

// Setup default alert rules for common scenarios
export function setupDefaultAlerts(): void {
  metricsCollector.addAlertRule({
    metricName: 'api.all',
    condition: 'gt',
    threshold: 2000, // 2 seconds
    duration: 60_000, // 1 minute
    cooldown: 300_000, // 5 minutes
    severity: 'warning',
    message: 'High API latency detected (>2s avg)',
  });

  metricsCollector.addAlertRule({
    metricName: 'api.requests.5xx',
    condition: 'gt',
    threshold: 10, // 10 errors per minute
    duration: 30_000,
    cooldown: 300_000,
    severity: 'critical',
    message: 'High error rate (>10 5xx/min)',
  });

  metricsCollector.addAlertRule({
    metricName: 'cache.all.hit',
    condition: 'lt',
    threshold: 0.5, // 50% hit rate
    duration: 300_000, // 5 minutes
    cooldown: 600_000, // 10 minutes
    severity: 'warning',
    message: 'Low cache hit rate (<50%)',
  });
}