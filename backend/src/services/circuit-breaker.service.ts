// Circuit Breaker pattern for fault tolerance
// Prevents cascading failures by detecting when a service is unhealthy

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold: number;    // Number of failures before opening
  successThreshold: number;    // Number of successes before closing (in half-open)
  timeout: number;             // Time (ms) before switching from open to half-open
  monitorInterval: number;     // Time (ms) between stats reporting
  name: string;                // Circuit breaker name for logging
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30_000,            // 30 seconds
  monitorInterval: 60_000,     // 1 minute
  name: 'default',
};

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private totalCalls: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get currentState(): CircuitState {
    return this.state;
  }

  get stats() {
    return {
      name: this.options.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      failureRate: this.totalCalls > 0 ? this.totalFailures / this.totalCalls : 0,
    };
  }

  // Execute a function with circuit breaker protection
  async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.state === 'OPEN') {
      // Check if timeout has elapsed to try half-open
      if (Date.now() - this.lastFailureTime >= this.options.timeout) {
        this.state = 'HALF_OPEN';
        console.log(`[CircuitBreaker:${this.options.name}] Half-open - testing service`);
      } else {
        // Circuit is open, use fallback if available
        if (fallback) {
          return fallback();
        }
        throw new Error(`Circuit breaker '${this.options.name}' is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (fallback) {
        return fallback();
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.totalSuccesses++;
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.reset();
        console.log(`[CircuitBreaker:${this.options.name}] Closed - service recovered`);
      }
    } else {
      this.reset();
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.options.failureThreshold) {
      if (this.state === 'CLOSED' || this.state === 'HALF_OPEN') {
        this.state = 'OPEN';
        console.error(`[CircuitBreaker:${this.options.name}] OPEN - service failing (${this.failureCount} failures)`);
      }
    }

    if (this.state === 'HALF_OPEN') {
      // Revert to open immediately on failure in half-open state
      this.state = 'OPEN';
      this.lastFailureTime = Date.now();
    }
  }

  private reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
  }
}

// Circuit breaker registry
class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  get(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ name, ...options }));
    }
    return this.breakers.get(name)!;
  }

  getAllStats(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [name, breaker] of this.breakers) {
      result[name] = breaker.stats;
    }
    return result;
  }

  resetAll(): void {
    this.breakers.clear();
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();
export { CircuitBreaker, CircuitBreakerOptions };