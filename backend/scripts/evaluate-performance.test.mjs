import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateComparison } from './evaluate-performance.mjs';

const run = (overrides = {}) => ({
  schemaVersion: 1, app: 'VANTA', version: 'synthetic-v1', sessionId: 'a',
  metric: 'reel_first_frame', scope: 'ordinary_client', device: 'synthetic-device',
  os: 'synthetic-os', networkProfile: 'good', region: 'test-region',
  cacheState: 'cold', workload: 'synthetic-reel-30s', protocol: 'v1',
  measurementMethod: 'first-rendered-frame', samples: Array.from({ length: 40 }, () => ({ ok: true, ms: 1200 })),
  ...overrides,
});
const candidate = overrides => run({ sessionId: 'b', version: 'synthetic-v2',
  samples: Array.from({ length: 40 }, (_, i) => ({ ok: true, ms: i < 38 ? 800 : 1500 })), ...overrides });

test('reports nearest-rank p95 and strict budget using synthetic observations', () => {
  const result = evaluateComparison(run(), candidate());
  assert.equal(result.comparable, true);
  assert.equal(result.candidate.p95Ms, 800);
  assert.equal(result.candidate.p99Ms, 1500);
  assert.equal(result.candidate.budgetMet, true);
  assert.ok(Math.abs(result.p95ChangePercent + 100/3) < 1e-9);
  assert.equal(result.superiorityEstablished, false);
});
test('rejects mismatched conditions and unequal sample counts', () => {
  const result = evaluateComparison(run(), candidate({ cacheState: 'warm', device: 'other',
    samples: Array.from({ length: 30 }, () => ({ ok: true, ms: 800 })) }));
  assert.equal(result.comparable, false);
  assert.deepEqual(result.mismatches, ['device', 'cacheState', 'sampleCount']);
  assert.equal(result.p95ChangePercent, null);
});
test('does not hide failed attempts behind successful latency', () => {
  const c = candidate();
  c.samples[0] = { ok: false, ms: null };
  const result = evaluateComparison(run(), c);
  assert.equal(result.complete, false);
  assert.equal(result.candidate.failures, 1);
  assert.equal(result.candidate.budgetMet, false);
  assert.equal(result.p95ChangePercent, null);
});
test('rejects invalid samples and repeated sessions', () => {
  for (const samples of [[], [{ ok: true, ms: 1 }], Array.from({ length: 30 }, () => ({ ok: true, ms: NaN }))]) {
    assert.throws(() => evaluateComparison(run(), candidate({ samples })));
  }
  assert.throws(() => evaluateComparison(run(), candidate({ sessionId: 'a' })));
});
test('competitor data allowed only for comparable user-visible ordinary-client flows', () => {
  assert.equal(evaluateComparison(run({ app: 'Other app' }), candidate()).comparisonType, 'competitor');
  assert.throws(() => evaluateComparison(run({ app: 'Other app', metric: 'feed_api' }), candidate({ metric: 'feed_api' })));
  assert.throws(() => evaluateComparison(run({ app: 'Other app', scope: 'staging' }), candidate()));
});
test('good-network budgets not applied to constrained profile', () => {
  const result = evaluateComparison(run({ networkProfile: 'constrained' }), candidate({ networkProfile: 'constrained' }));
  assert.equal(result.candidate.budgetApplicable, false);
  assert.equal(result.candidate.budgetMet, false);
});
