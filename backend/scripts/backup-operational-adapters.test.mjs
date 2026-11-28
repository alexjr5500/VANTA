import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openBackupJournal, measureR2Inventory, measureScratchFreeBytes } from './backup-operational-adapters.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'vanta-backup-journal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test('exclusive persistent lock blocks another runner; unfinished journal survives release', async t => {
  const dir = await fixture(t), a = await openBackupJournal(dir), b = await openBackupJournal(dir);
  const lock = await a.acquireExclusiveWriter();
  assert.ok(await lock.healthy()); assert.equal(await b.acquireExclusiveWriter(), null);
  const runId = randomUUID();
  assert.equal(await a.unresolvedAttempt(), false);
  await a.beginAttempt({ scope:'production', runId });
  await lock.release();
  const second = await b.acquireExclusiveWriter();
  assert.equal(await b.unresolvedAttempt(), true);
  await assert.rejects(b.beginAttempt({ scope:'production', runId:randomUUID() }));
  assert.equal((await b.readCurrent()).runId, runId);
  await second.release();
});
test('failed attempts remain blocked; successful transfer is not independent recovery', async t => {
  const dir = await fixture(t), a = await openBackupJournal(dir), lock = await a.acquireExclusiveWriter(), runId = randomUUID();
  await a.beginAttempt({scope:'acceptance',runId});
  await a.recordVerifiedTransfer({scope:'acceptance',runId,capturedAtMs:Date.now(),marker:{verified:true},manifest:{runId}});
  assert.equal((await a.readCurrent()).independentRestoreVerified,false);
  assert.equal(await a.unresolvedAttempt(),false);
  const next = randomUUID(); await a.beginAttempt({scope:'acceptance',runId:next});
  await a.recordFailure({scope:'acceptance',runId:next,phase:'upload'});
  assert.equal(await a.unresolvedAttempt(),true);
  assert.equal((await a.readCurrent()).state,'failed');
  assert.ok(await measureScratchFreeBytes(dir) > 0);
  await lock.release();
});
const sdk={ ListObjectsV2Command:class{constructor(input){this.input=input;this.name='objects'}},ListMultipartUploadsCommand:class{constructor(input){this.input=input;this.name='uploads'}}};
test('counts all pages and blocks incomplete upload, duplicate keys and truncated inventory',async()=>{
  const client={send:async c=>c.name==='uploads'?{Uploads:[],IsTruncated:false}:c.input.ContinuationToken?{Contents:[{Key:'b',Size:20}],IsTruncated:false}:{Contents:[{Key:'a',Size:10}],IsTruncated:true,NextContinuationToken:'next'}};
  const args={client,sdk,bucket:'vanta-backups'};
  assert.equal((await measureR2Inventory(args)).storedBytes,30);
  await assert.rejects(measureR2Inventory({...args,maxPages:1}));
  await assert.rejects(measureR2Inventory({...args,client:{send:async c=>c.name==='uploads'?{Uploads:[{Key:'x'}]}:{Contents:[]}}}));
  await assert.rejects(measureR2Inventory({...args,client:{send:async c=>c.name==='uploads'?{}:{Contents:[{Key:'a',Size:1},{Key:'a',Size:1}]}}}));
});

test('historic run IDs and cross-scope attempts are rejected before new capture', async t => {
  const dir=await fixture(t), j=await openBackupJournal(dir), lock=await j.acquireExclusiveWriter();
  const a=randomUUID(), b=randomUUID();
  for(const runId of [a,b]){
    await j.beginAttempt({scope:'production',runId});
    await j.recordVerifiedTransfer({scope:'production',runId,capturedAtMs:Date.now(),marker:{verified:true},manifest:{runId}});
  }
  await assert.rejects(j.beginAttempt({scope:'production',runId:a}), /already used/);
  await assert.rejects(j.beginAttempt({scope:'acceptance',runId:randomUUID()}), /scope/);
  assert.equal((await j.readCurrent()).runId,b);
  await lock.release();
});
