import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, percentile, runBenchmark } from './staging-load-test.mjs';

const origin = 'https://vanta-acceptance-staging.up.railway.app';
const env = { VANTA_STAGING_LOAD_TEST: 'yes', VANTA_LOAD_TEST_ORIGIN: origin, VANTA_LOAD_TEST_ALLOWED_ORIGIN: origin };
const ready = () => new Response(JSON.stringify({ status: 'ready' }), { status: 200 });

test('requires approval, exact staging origin, read-only endpoints and bounded load', () => {
  assert.throws(() => readConfig({ ...env, VANTA_STAGING_LOAD_TEST: 'no' }));
  assert.throws(() => readConfig({ ...env, VANTA_LOAD_TEST_ORIGIN: 'https://vanta.up.railway.app' }));
  assert.throws(() => readConfig({ ...env, VANTA_LOAD_TEST_ALLOWED_ORIGIN: 'https://other-staging.up.railway.app' }));
  assert.throws(() => readConfig({ ...env, VANTA_LOAD_TEST_PATH: '/api/wallet/transfer' }));
  assert.throws(() => readConfig({ ...env, VANTA_LOAD_TEST_CONCURRENCY: '11' }));
  assert.throws(() => readConfig({ ...env, VANTA_LOAD_TEST_REQUESTS: '301' }));
  assert.equal(readConfig(env).requests, 100);
});

test('nearest rank percentiles', () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([5, 1, 2, 3, 4], 50), 3);
  assert.equal(percentile([5, 1, 2, 3, 4], 95), 5);
});

test('measures successful responses and respects concurrency/request budget', async () => {
  let active = 0, peak = 0, calls = 0;
  const config = readConfig({ ...env, VANTA_LOAD_TEST_REQUESTS: '6', VANTA_LOAD_TEST_CONCURRENCY: '2', VANTA_LOAD_TEST_P95_MS: '1000' });
  const result = await runBenchmark(config, async (_url, opts) => {
    assert.equal(opts.redirect, 'manual');
    assert.equal(opts.method, 'GET');
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--; return ready();
  });
  assert.equal(result.passed, true);
  assert.equal(result.attempted, 6);
  assert.equal(calls, 7);
  assert.ok(peak <= 2);
  assert.equal(result.errors, 0);
  assert.ok(result.p99Ms >= result.p50Ms);
});

test('fails preflight on redirects, incorrect responses and errors', async () => {
  for (const response of [() => new Response('', { status: 302 }), () => new Response('{"status":"ok"}'), () => new Response('', { status: 503 })]) {
    const result = await runBenchmark(readConfig(env), async () => response());
    assert.equal(result.passed, false);
    assert.equal(result.attempted, 0);
  }
});

test('stops new work after three failures without claiming performance success', async () => {
  let calls = 0;
  const result = await runBenchmark(readConfig({ ...env, VANTA_LOAD_TEST_CONCURRENCY: '1' }),
    async () => ++calls === 1 ? ready() : new Response('', { status: 503 }));
  assert.equal(result.passed, false);
  assert.equal(result.attempted, 3);
  assert.equal(result.errors, 3);
  assert.equal(result.stoppedEarly, true);
});

test('replica gate requires distinct valid markers and rejects missing headers', async () => {
  const config = readConfig({ ...env, VANTA_LOAD_TEST_REQUESTS: '4', VANTA_LOAD_TEST_CONCURRENCY: '1', VANTA_LOAD_TEST_MIN_INSTANCES: '2', VANTA_LOAD_TEST_P95_MS: '1000' });
  const ids = ['a1b2c3d4-1111-4111-8111-111111111111', 'a1b2c3d4-2222-4222-8222-222222222222'];
  let call = 0;
  const result = await runBenchmark(config, async () => new Response('{"status":"ready"}', {
    headers: { 'x-vanta-probe-instance': ids[call++ % 2] },
  }));
  assert.equal(result.passed, true);
  assert.deepEqual(result.instanceRequestCounts, [2, 2]);
  assert.equal(result.observedInstances, 2);
  const missing = await runBenchmark(config, async () => ready());
  assert.equal(missing.passed, false);
  assert.equal(missing.missingInstance, 4);
});
