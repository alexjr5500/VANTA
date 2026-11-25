import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Offline evaluator: never sends requests or collects personal content.
const budgets = Object.freeze({
  cached_api: 100,
  feed_api: 300,
  chat_delivery: 200,
  reel_first_frame: 1000,
  app_usable: 2000,
});
const userFlows = new Set(['chat_delivery', 'reel_first_frame', 'app_usable']);
const matchingFields = ['metric', 'device', 'os', 'networkProfile', 'region', 'cacheState', 'workload', 'protocol', 'measurementMethod'];
const validLabel = value => typeof value === 'string' && value.length >= 1 && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value);
const rank = (values, p) => values[Math.ceil(values.length * p / 100) - 1];

function validate(run) {
  if (!run || typeof run !== 'object' || run.schemaVersion !== 1) throw Error('Invalid benchmark schema');
  for (const key of [...matchingFields, 'app', 'version', 'sessionId']) {
    if (!validLabel(run[key])) throw Error('Missing benchmark metadata');
  }
  if (!Object.hasOwn(budgets, run.metric)) throw Error('Unknown metric');
  if (!['cold', 'warm', 'not_applicable'].includes(run.cacheState)) throw Error('Invalid cache state');
  if (!['staging', 'ordinary_client'].includes(run.scope)) throw Error('Invalid benchmark scope');
  if (!Array.isArray(run.samples) || run.samples.length < 30 || run.samples.length > 1000) throw Error('Require 30–1000 recorded attempts per run');
  for (const sample of run.samples) {
    if (!sample || typeof sample !== 'object' || typeof sample.ok !== 'boolean') throw Error('Invalid sample');
    if (sample.ok) {
      if (typeof sample.ms !== 'number' || !Number.isFinite(sample.ms) || sample.ms < 0 || sample.ms > 120000) throw Error('Invalid successful timing');
    } else if (sample.ms !== null) throw Error('Failed attempts must record null latency');
  }
}

function summarize(run) {
  const durations = run.samples.filter(s => s.ok).map(s => s.ms).sort((a,b) => a-b);
  const failures = run.samples.length - durations.length;
  return {
    attempts: run.samples.length, successes: durations.length, failures,
    errorRate: failures / run.samples.length,
    p50Ms: durations.length ? rank(durations, 50) : null,
    p95Ms: durations.length ? rank(durations, 95) : null,
    p99Ms: durations.length ? rank(durations, 99) : null,
    // Fixed good-network objectives are not a constrained-network SLA.
    budgetMs: budgets[run.metric],
    budgetMet: run.networkProfile === 'good' && failures === 0 && durations.length >= 30 &&
      rank(durations, 95) < budgets[run.metric],
    budgetApplicable: run.networkProfile === 'good',
  };
}

export function evaluateComparison(baseline, candidate) {
  validate(baseline); validate(candidate);
  if (baseline.sessionId === candidate.sessionId) throw Error('Independent sessions required');
  if (candidate.app.toLowerCase() !== 'vanta') throw Error('Candidate must be VANTA');
  const competitor = baseline.app.toLowerCase() !== 'vanta';
  if (competitor && (!userFlows.has(candidate.metric) || baseline.scope !== 'ordinary_client' || candidate.scope !== 'ordinary_client')) {
    throw Error('Competitor comparisons require equivalent ordinary-client user flows');
  }
  if (!competitor && baseline.scope !== candidate.scope) throw Error('Scope mismatch');
  const mismatches = matchingFields.filter(key => baseline[key] !== candidate[key]);
  if (baseline.samples.length !== candidate.samples.length) mismatches.push('sampleCount');
  const before = summarize(baseline), after = summarize(candidate);
  const comparable = mismatches.length === 0;
  const complete = before.failures === 0 && after.failures === 0;
  const p95ChangePercent = comparable && complete && before.p95Ms > 0
    ? (after.p95Ms - before.p95Ms) / before.p95Ms * 100 : null;
  return {
    schemaVersion: 1, metric: candidate.metric,
    comparisonType: competitor ? 'competitor' : 'vanta_before_after',
    comparable, mismatches, complete, baseline: before, candidate: after,
    p95ChangePercent,
    // Descriptive result only: no statistical confidence or general superiority claim.
    interpretation: !comparable ? 'conditions_mismatch' : !complete ? 'failed_attempts_present'
      : p95ChangePercent === null ? 'zero_baseline'
      : p95ChangePercent < 0 ? 'lower_observed_p95' : p95ChangePercent > 0 ? 'higher_observed_p95' : 'equal_observed_p95',
    superiorityEstablished: false,
  };
}

async function readRun(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 512 * 1024) throw Error('Invalid benchmark input size');
  return JSON.parse(await readFile(path, 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw Error('Two local JSON benchmark files required');
    const report = evaluateComparison(await readRun(process.argv[2]), await readRun(process.argv[3]));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.comparable && report.complete ? 0 : 1;
  } catch {
    console.error('Benchmark inputs invalid or not eligible for comparison');
    process.exitCode = 2;
  }
}
