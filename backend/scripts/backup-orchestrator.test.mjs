import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, createHash } from 'node:crypto';
import { runBackupSet, signBackupManifest, verifySignedBackupManifest } from './backup-orchestrator.mjs';
import { backupPrefix, verifiedBackupSet } from './backup-r2-multipart.mjs';
const keys = generateKeyPairSync('ed25519');
const privateKey = keys.privateKey.export({ type:'pkcs8', format:'pem' });
const publicKey = keys.publicKey.export({ type:'spki', format:'pem' });
const fp = createHash('sha256').update(keys.publicKey.export({ type:'spki', format:'der' })).digest('hex');
const hash = 'a'.repeat(64);
function fixture(failAt) {
  const runId = randomUUID(), scope = 'acceptance', calls = [], now = Date.now();
  const policy = { enabled:true, ownerApproved:true, recoveryCopiesVerified:true, recipientVerified:true,
    credentialsRotated:true, dependencyLockVerified:true, databaseLimitBytes:1024, mediaLimitBytes:2048, manifestLimitBytes:4096 };
  const event = name => { calls.push(name); if (name === failAt) throw Error('simulated failure'); };
  const adapters = {
    acquireExclusiveWriter: async () => { event('lock'); return { healthy:async()=>failAt!=='lost-lock', release:async()=>event('unlock') }; },
    measureCapacity:async()=>({ nowMs:now, inventoryAtMs:now, storedBytes:0, incompleteUploadBytes:0,
      scratchFreeBytes:1024**3, inventoryComplete:true, unresolvedAttempt:false }),
    beginAttempt:async()=>event('journal'),
    fenceSources:async()=>{ event('fence'); return { healthy:async()=>failAt!=='lost-fence', release:async()=>event('unfence') }; },
    capture:async(kind)=>{event('capture:'+kind);return { path:kind, bytes:512 };},
    upload:async(kind)=>{event('upload:'+kind);return { key:backupPrefix(scope,runId)+kind, bytes:512, sha256:hash, verified:true };},
    signManifest:async(data)=>{event('sign');return signBackupManifest({...data,privateKey});},
    encryptManifest:async(bytes)=>{event('encrypt');assert.equal(verifySignedBackupManifest({bytes,publicKey,expectedFingerprint:fp,expectedRunId:runId,scope}).manifest.runId,runId);return {path:'marker',bytes:512};},
    recordVerifiedTransfer:async()=>event('record'),
    recordFailure:async({phase})=>event('failure:'+phase),
    cleanupLocal:async()=>event('cleanup'),
  };
  return { args:{scope,runId,policy,adapters},calls };
}
test('one complete run fences sources, releases before upload, publishes signed encrypted marker last',async()=>{
  const {args,calls}=fixture();const result=await runBackupSet(args);
  assert.equal(result.transferVerified,true);assert.equal(result.independentRestoreVerified,false);
  assert.deepEqual(calls,['lock','journal','fence','capture:database.dump.age','capture:media.tar.age','unfence',
    'upload:database.dump.age','upload:media.tar.age','sign','encrypt','upload:manifest.json.age','record','cleanup','unlock']);
});
test('rejects disabled policy, unavailable lock, lost source fence and failed capture without uploading',async()=>{
  const f=fixture();await assert.rejects(runBackupSet({...f.args,policy:{...f.args.policy,enabled:false}}));assert.deepEqual(f.calls,[]);
  for(const phase of ['lost-lock','lost-fence','capture:media.tar.age']){
    const {args,calls}=fixture(phase);await assert.rejects(runBackupSet(args));
    assert.ok(!calls.some(s=>s.startsWith('upload:')));assert.equal(calls.at(-1),'unlock');
  }
});
test('no success record after failed data or marker upload, journal failure retained',async()=>{
  for(const phase of ['upload:media.tar.age','upload:manifest.json.age']){
    const {args,calls}=fixture(phase);await assert.rejects(runBackupSet(args));
    assert.ok(!calls.includes('record'));assert.ok(calls.some(s=>s.startsWith('failure:')));assert.equal(calls.at(-1),'unlock');
  }
});
test('signature binds exact run and scope; wrong key and tampered manifest rejected',()=>{
  const runId=randomUUID(),scope='production',artifact=kind=>({key:backupPrefix(scope,runId)+kind,bytes:512,sha256:hash,verified:true});
  const manifest=verifiedBackupSet(artifact('database.dump.age'),artifact('media.tar.age'),runId,scope);
  const bytes=signBackupManifest({manifest,privateKey,scope,capturedAtMs:1000});
  const input={bytes,publicKey,expectedFingerprint:fp,expectedRunId:runId,scope};
  assert.equal(verifySignedBackupManifest(input).manifest.runId,runId);
  const changed=JSON.parse(bytes);changed.data.manifest.artifacts[0].bytes++;
  assert.throws(()=>verifySignedBackupManifest({...input,bytes:Buffer.from(JSON.stringify(changed))}));
  assert.throws(()=>verifySignedBackupManifest({...input,expectedFingerprint:'b'.repeat(64)}));
  assert.throws(()=>verifySignedBackupManifest({...input,scope:'acceptance'}));
});
