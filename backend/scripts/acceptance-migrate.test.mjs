import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAcceptanceMigration, summarizeMigration } from './acceptance-migrate.mjs';

test('migration guard refuses unknown environment without invoking Prisma', () => {
  assert.equal(runAcceptanceMigration({}, () => { throw new Error('must not run'); }, () => { throw new Error('must not resolve'); }), 10);
});
test('migration summary returns fixed failure metadata, not raw error strings', () => {
  const report = summarizeMigration({status: 1, stdout: 'fixture-secret', stderr: 'Error P3005 postgres://user:password@host/db'});
  assert.deepEqual(report, {passed:false, exitCode:1, prismaCodes:['P3005'], timedOut:false, spawnFailed:false, terminated:false});
  assert.equal(summarizeMigration({status: 0}).passed, true);
  assert.equal(summarizeMigration({status: null,error:{code:'ETIMEDOUT'}}).timedOut, true);
});
