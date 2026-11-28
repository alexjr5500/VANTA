import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessBackupRun, backupHealth, retentionCandidates, DEFAULT_R2_BUDGET_BYTES, MIN_SCRATCH_RESERVE_BYTES } from './backup-run-policy.mjs';
const nowMs = 100 * 86400000;
const base = {
  enabled: true, ownerApproved: true, exclusiveLockHeld: true, sourceFenced: true,
  recoveryCopiesVerified: true, recipientVerified: true, credentialsRotated: true,
  dependencyLockVerified: true, inventoryComplete: true, unresolvedAttempt: false,
  nowMs, inventoryAtMs: nowMs - 1000, databaseLimitBytes: 100_000_000,
  mediaLimitBytes: 500_000_000, manifestLimitBytes: 65536, storedBytes: 1_000_000_000,
  incompleteUploadBytes: 0, scratchFreeBytes: 1_000_000_000,
};
test('allows only an approved, fenced, bounded plan with fresh inventory', () => {
  const result = assessBackupRun(base);
  assert.equal(result.allowed, true);
  assert.equal(result.projectedStoredBytes, 1600065536);
  assert.equal(result.requiredScratchBytes, 600065536 + MIN_SCRATCH_RESERVE_BYTES);
  for (const flag of ['enabled','ownerApproved','exclusiveLockHeld','sourceFenced','recoveryCopiesVerified','recipientVerified','credentialsRotated','dependencyLockVerified','inventoryComplete']) {
    assert.equal(assessBackupRun({ ...base, [flag]: false }).allowed, false, flag);
  }
  assert.equal(assessBackupRun({ ...base, unresolvedAttempt: true }).allowed, false);
});
test('counts incomplete uploads and refuses budget or scratch overrun', () => {
  const atLimit = { ...base, storedBytes: DEFAULT_R2_BUDGET_BYTES - 600065536 };
  assert.equal(assessBackupRun(atLimit).allowed, true);
  assert.ok(assessBackupRun({ ...atLimit, incompleteUploadBytes: 1 }).issues.includes('bucket_budget_exceeded'));
  assert.ok(assessBackupRun({ ...base, scratchFreeBytes: 600065536 }).issues.includes('insufficient_scratch_space'));
});
test('fails closed on stale, missing, invalid and overflowing capacity data', () => {
  assert.equal(assessBackupRun({}).allowed, false);
  for (const patch of [{ inventoryAtMs: nowMs - 300001 }, { inventoryAtMs: nowMs + 1 },
    { storedBytes: -1 }, { mediaLimitBytes: NaN }, { databaseLimitBytes: Number.MAX_SAFE_INTEGER },
    { scratchReserveBytes: 0 }, { incompleteUploadBytes: undefined }]) {
    assert.equal(assessBackupRun({ ...base, ...patch }).allowed, false);
  }
});
test('health distinguishes transferred backup from independent recovery', () => {
  assert.equal(backupHealth({ nowMs, lastVerifiedTransferMs: nowMs, lastIndependentRestoreMs: nowMs }).healthy, true);
  assert.ok(backupHealth({ nowMs, lastVerifiedTransferMs: nowMs }).issues.includes('independent_restore_missing_or_overdue'));
  assert.ok(backupHealth({ nowMs, lastVerifiedTransferMs: nowMs - 27 * 3600000, lastIndependentRestoreMs: nowMs }).issues.includes('verified_backup_missing_or_overdue'));
  assert.ok(backupHealth({ nowMs, lastVerifiedTransferMs: nowMs, lastIndependentRestoreMs: nowMs, failedAttempt: true }).issues.includes('backup_attempt_failed'));
});
test('retention protects two independently restored sets and excludes uncertain or held objects', () => {
  const set = (id, days, extras = {}) => ({ id, createdAtMs: nowMs - days * 86400000,
    transferVerified: true, independentRestoreVerified: true, provenanceVerified: true, legalHold: false, retentionLock: false, ...extras });
  const sets = [set('new', 1), set('old-protected', 8), set('eligible', 9),
    set('not-restored', 10, { independentRestoreVerified: false }), set('hold', 11, { legalHold: true }),
    set('locked', 12, { retentionLock: true }), set('untrusted', 13, { provenanceVerified: false })];
  assert.deepEqual(retentionCandidates({ nowMs, sets }), ['eligible']);
  assert.deepEqual(retentionCandidates({ nowMs, sets: sets.slice(0, 2) }), []);
  assert.throws(() => retentionCandidates({ nowMs, sets: [sets[0], sets[0]] }));
  assert.throws(() => retentionCandidates({ nowMs, sets, keepAtLeast: 1 }));
});
