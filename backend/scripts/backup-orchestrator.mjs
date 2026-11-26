import { createHash, sign, verify, createPrivateKey, createPublicKey } from 'node:crypto';
import { assessBackupRun } from './backup-run-policy.mjs';
import { backupPrefix, verifiedBackupSet, parseBackupManifest } from './backup-r2-multipart.mjs';

const check = (value, message = 'Backup orchestration gate failed') => { if (!value) throw Error(message); };
const safe = value => Number.isSafeInteger(value) && value >= 0;
const fingerprint = key => createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');

// A signed marker authenticates its manifest against a separately pinned
// Ed25519 public key. It does not prove the writer or database was uncompromised.
export function signBackupManifest({ manifest, privateKey, scope, capturedAtMs }) {
  check(safe(capturedAtMs) && ['acceptance', 'production'].includes(scope));
  const key = createPrivateKey(privateKey);
  check(key.asymmetricKeyType === 'ed25519');
  const data = { scope, capturedAtMs, manifest };
  const bytes = Buffer.from(JSON.stringify(data));
  return Buffer.from(JSON.stringify({ version: 1, data, signer: fingerprint(createPublicKey(key)),
    signature: sign(null, bytes, key).toString('base64') }) + '\n');
}

export function verifySignedBackupManifest({ bytes, publicKey, expectedFingerprint, expectedRunId, scope }) {
  check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 16 * 1024);
  const key = createPublicKey(publicKey);
  check(key.asymmetricKeyType === 'ed25519' && fingerprint(key) === expectedFingerprint);
  const value = JSON.parse(bytes.toString('utf8'));
  check(value?.version === 1 && Object.keys(value).length === 4 && value.signer === expectedFingerprint &&
    value.data?.scope === scope && safe(value.data.capturedAtMs) && Object.keys(value.data).length === 3 &&
    typeof value.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(value.signature));
  check(verify(null, Buffer.from(JSON.stringify(value.data)), key, Buffer.from(value.signature, 'base64')),
    'Backup manifest signature verification failed');
  return { capturedAtMs: value.data.capturedAtMs,
    manifest: parseBackupManifest(Buffer.from(JSON.stringify(value.data.manifest)), expectedRunId, scope) };
}

/** Complete one explicitly approved backup attempt. No default scheduler and
 * no implicit source or credentials. Adapters must implement real independent
 * checks; a caller-supplied flag is not a fence. The lock/fence is held until
 * both source captures finish. A lost lock must prohibit publishing a marker.
 * The durable attempt journal must survive process failure and block retries
 * until reconciliation. No automatic deletion or retry after remote effects.
 */
export async function runBackupSet({ scope, runId, policy, adapters }) {
  check(['acceptance', 'production'].includes(scope)); backupPrefix(scope, runId);
  // Reject without obtaining source access if there is no explicit approval.
  check(policy?.enabled === true && policy.ownerApproved === true, 'Backup not approved');
  let lease, fence, journaled = false, transferred = false, phase = 'lock';
  try {
    lease = await adapters.acquireExclusiveWriter();
    check(lease && await lease.healthy(), 'Backup writer busy');
    phase = 'inventory';
    const observed = await adapters.measureCapacity();
    const pre = assessBackupRun({ ...policy, ...observed, enabled: policy.enabled,
      ownerApproved: policy.ownerApproved, exclusiveLockHeld: true, sourceFenced: true });
    // sourceFenced is provisional only for the capacity calculation; no
    // capture occurs until a real fence is obtained and checked below.
    check(pre.allowed, 'Backup policy rejected: ' + pre.issues.join(','));
    phase = 'journal';
    await adapters.beginAttempt({ scope, runId }); journaled = true;
    phase = 'fence';
    fence = await adapters.fenceSources();
    check(fence && await fence.healthy() && await lease.healthy(), 'Source fence unavailable');
    const capturedAtMs = Date.now();
    const db = await adapters.capture('database.dump.age', policy.databaseLimitBytes);
    check(await fence.healthy() && await lease.healthy(), 'Source fence lost during database capture');
    const media = await adapters.capture('media.tar.age', policy.mediaLimitBytes);
    check(await fence.healthy() && await lease.healthy(), 'Source fence lost during media capture');
    for (const [file, limit] of [[db, policy.databaseLimitBytes], [media, policy.mediaLimitBytes]]) {
      check(file && typeof file.path === 'string' && safe(file.bytes) && file.bytes > 0 && file.bytes <= limit);
    }
    // Release the application maintenance fence before external uploads.
    await fence.release(); fence = undefined;
    phase = 'upload';
    const database = await adapters.upload('database.dump.age', db.path, policy.databaseLimitBytes);
    check(await lease.healthy(), 'Backup writer lock lost');
    const mediaArtifact = await adapters.upload('media.tar.age', media.path, policy.mediaLimitBytes);
    check(await lease.healthy(), 'Backup writer lock lost');
    const manifest = verifiedBackupSet(database, mediaArtifact, runId, scope);
    phase = 'marker';
    const signed = await adapters.signManifest({ manifest, scope, capturedAtMs });
    const markerFile = await adapters.encryptManifest(signed, policy.manifestLimitBytes);
    check(markerFile && typeof markerFile.path === 'string' && safe(markerFile.bytes) &&
      markerFile.bytes > 0 && markerFile.bytes <= policy.manifestLimitBytes);
    check(await lease.healthy(), 'Backup writer lock lost before marker');
    const marker = await adapters.upload('manifest.json.age', markerFile.path, policy.manifestLimitBytes);
    check(marker?.verified === true && marker.key === backupPrefix(scope, runId) + 'manifest.json.age' &&
      marker.bytes === markerFile.bytes && /^[a-f0-9]{64}$/.test(marker.sha256));
    check(await lease.healthy(), 'Backup writer lock lost after marker');
    phase = 'record';
    await adapters.recordVerifiedTransfer({ scope, runId, capturedAtMs, marker, manifest });
    transferred = true;
    return { runId, capturedAtMs, marker, transferVerified: true, independentRestoreVerified: false };
  } catch (error) {
    // Error details from providers may contain credentials. Report only phase.
    if (journaled) await adapters.recordFailure({ scope, runId, phase }).catch(() => {});
    throw Error('Backup attempt failed at ' + phase + '; reconcile before retry');
  } finally {
    // Even if one cleanup fails, attempt the other. Do not clear the durable
    // attempt journal on failure or pretend the source is safely unfenced.
    try { if (fence) await fence.release(); }
    finally {
      try { if (journaled) await adapters.cleanupLocal({ scope, runId, transferred }); }
      finally { if (lease) await lease.release(); }
    }
  }
}
