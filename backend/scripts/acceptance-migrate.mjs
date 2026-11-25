import { writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkAcceptanceConfig } from './acceptance-preflight.mjs';

const log = (event, fields = {}) => writeSync(1, '[ACCEPTANCE] ' + event + ' ' + JSON.stringify(fields) + '\n');
const backendDir = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));

/** Never log raw Prisma output, database URLs or exception messages. */
export function summarizeMigration(result) {
  const codes = [...new Set((String(result.stdout || '') + '\n' + String(result.stderr || '')).match(/\bP\d{4}\b/g) || [])].slice(0, 12);
  return { passed: result.status === 0 && !result.error && !result.signal,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    prismaCodes: codes, timedOut: result.error?.code === 'ETIMEDOUT',
    spawnFailed: Boolean(result.error), terminated: Boolean(result.signal) };
}

export function runAcceptanceMigration(env, run = spawnSync, resolveCli = () => require.resolve('prisma/build/index.js')) {
  const report = checkAcceptanceConfig(env, 'http');
  log('migration.guard', report);
  if (!report.passed) return 10;
  log('migration.begin');
  try {
    const result = run(process.execPath, [resolveCli(), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      cwd: backendDir, env: {...env, PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1'},
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 2 * 1024 * 1024,
    });
    const summary = summarizeMigration(result);
    log('migration.result', summary);
    return summary.passed ? 0 : 20;
  } catch {
    log('migration.launch_failed');
    return 21;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runAcceptanceMigration(process.env);
}
