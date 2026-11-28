import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const endpoints = new Set(['/health/live', '/health/ready', '/api/version']);
function integer(value, fallback, min, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('Invalid bounded test setting');
  return n;
}

export function readConfig(env) {
  if (env.VANTA_STAGING_LOAD_TEST !== 'yes') throw Error('Explicit staging load test approval required');
  const origin = new URL(env.VANTA_LOAD_TEST_ORIGIN ?? '');
  const allowed = new URL(env.VANTA_LOAD_TEST_ALLOWED_ORIGIN ?? '');
  // The staging name is an additional guardrail, not proof of environment identity.
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port ||
      origin.pathname !== '/' || origin.search || origin.hash || origin.origin !== allowed.origin ||
      allowed.username || allowed.password || allowed.pathname !== '/' || allowed.search || allowed.hash ||
      !/^[a-z0-9-]*staging[a-z0-9-]*\.up\.railway\.app$/.test(origin.hostname)) {
    throw Error('Exact approved Railway staging origin required');
  }
  const path = env.VANTA_LOAD_TEST_PATH ?? '/health/ready';
  if (!endpoints.has(path)) throw Error('Endpoint not approved for read-only benchmark');
  const minInstances = integer(env.VANTA_LOAD_TEST_MIN_INSTANCES, 0, 0, 10);
  if (minInstances && path !== '/health/ready') throw Error('Replica sampling requires readiness endpoint');
  return {
    origin: origin.origin, path, minInstances,
    requests: integer(env.VANTA_LOAD_TEST_REQUESTS, 100, 1, 300),
    concurrency: integer(env.VANTA_LOAD_TEST_CONCURRENCY, 2, 1, 10),
    timeoutMs: integer(env.VANTA_LOAD_TEST_TIMEOUT_MS, 3000, 100, 5000),
    p95BudgetMs: integer(env.VANTA_LOAD_TEST_P95_MS, 300, 1, 5000),
  };
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p / 100) - 1)];
}

async function probe(config, fetcher) {
  const started = performance.now();
  let response;
  try {
    response = await fetcher(config.origin + config.path, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(config.timeoutMs),
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return { ok: false, status: response.status };
    }
    // Bound even unexpectedly large successful responses; include response body time.
    const reader = response.body?.getReader();
    let bytes = 0;
    const chunks = [];
    if (!reader) return { ok: false, status: 'invalid_body' };
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 16384) { await reader.cancel(); return { ok: false, status: 'oversized' }; }
        chunks.push(Buffer.from(item.value));
      }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const expected = config.path === '/health/live' ? data?.status === 'alive'
      : config.path === '/health/ready' ? data?.status === 'ready' : data?.version === 'v1';
    const marker = response.headers.get('x-vanta-probe-instance');
    const instanceId = marker && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marker) ? marker.toLowerCase() : null;
    return { ok: expected, status: expected ? 200 : 'invalid_body', ms: performance.now() - started, instanceId };
  } catch {
    return { ok: false, status: 'network_or_invalid_response' };
  }
}

export async function runBenchmark(config, fetcher = fetch) {
  const started = performance.now();
  const preflight = await probe(config, fetcher);
  if (!preflight.ok) return { passed: false, reason: 'preflight_failed', status: preflight.status, attempted: 0 };
  let issued = 0;
  let errors = 0;
  const durations = [];
  const outcomes = {};
  const instances = new Map();
  let missingInstance = 0;
  const worker = async () => {
    while (issued < config.requests && errors < 3) {
      issued++;
      const result = await probe(config, fetcher);
      outcomes[result.status] = (outcomes[result.status] ?? 0) + 1;
      if (result.ok) {
        durations.push(result.ms);
        if (result.instanceId) instances.set(result.instanceId, (instances.get(result.instanceId) ?? 0) + 1);
        else missingInstance++;
      } else errors++;
      // Limit issue rate per worker even when endpoints are extremely fast.
      await sleep(100);
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.concurrency, config.requests) }, worker));
  const elapsedSeconds = (performance.now() - started) / 1000;
  const p95 = percentile(durations, 95);
  const replicaCheck = !config.minInstances || (missingInstance === 0 && instances.size >= config.minInstances);
  return {
    passed: issued === config.requests && errors === 0 && p95 !== null && p95 <= config.p95BudgetMs && replicaCheck,
    observedInstances: instances.size, instanceRequestCounts: [...instances.values()].sort((a,b) => b-a),
    missingInstance, replicaCheck, minInstances: config.minInstances ?? 0,
    attempted: issued, successful: durations.length, errors, outcomes,
    stoppedEarly: issued < config.requests,
    p50Ms: percentile(durations, 50), p95Ms: p95, p99Ms: percentile(durations, 99),
    p95BudgetMs: config.p95BudgetMs, elapsedSeconds,
    requestsPerSecond: issued / elapsedSeconds,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runBenchmark(readConfig(process.env));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  } catch {
    console.error('Benchmark configuration or execution failed');
    process.exitCode = 2;
  }
}
