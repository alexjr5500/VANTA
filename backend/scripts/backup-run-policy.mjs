// Pure planning guard. It never schedules, writes, deletes, or reserves
// capacity. A caller must obtain an exclusive writer lock and enforce hard
// byte limits during archive generation and transfer, not just estimate.
const MAX = Number.MAX_SAFE_INTEGER;
const MiB = 1024 * 1024;
export const DEFAULT_R2_BUDGET_BYTES = 8_000_000_000; // decimal GB, not a billing cap
export const MIN_SCRATCH_RESERVE_BYTES = 256 * MiB;
export const INVENTORY_MAX_AGE_MS = 5 * 60 * 1000;
const safe = value => Number.isSafeInteger(value) && value >= 0;
const sum = (...values) => {
  if (!values.every(safe)) throw new Error('invalid byte or time estimate');
  const result = values.reduce((a, b) => a + BigInt(b), 0n);
  if (result > BigInt(MAX)) throw new Error('estimate overflow');
  return Number(result);
};

export function assessBackupRun(input) {
  const issues = [];
  if (input?.enabled !== true) issues.push('disabled');
  if (input?.ownerApproved !== true) issues.push('approval_required');
  if (input?.exclusiveLockHeld !== true) issues.push('exclusive_writer_lock_required');
  if (input?.sourceFenced !== true) issues.push('consistent_source_required');
  if (input?.recoveryCopiesVerified !== true) issues.push('independent_recovery_copies_required');
  if (input?.recipientVerified !== true) issues.push('recipient_verification_required');
  if (input?.credentialsRotated !== true) issues.push('production_credentials_required');
  if (input?.dependencyLockVerified !== true) issues.push('locked_dependencies_required');
  if (input?.inventoryComplete !== true) issues.push('complete_bucket_inventory_required');
  if (input?.unresolvedAttempt !== false) issues.push('unresolved_backup_attempt');
  const { nowMs, inventoryAtMs, databaseLimitBytes, mediaLimitBytes, manifestLimitBytes,
    storedBytes, incompleteUploadBytes, scratchFreeBytes, budgetBytes = DEFAULT_R2_BUDGET_BYTES,
    scratchReserveBytes = MIN_SCRATCH_RESERVE_BYTES } = input ?? {};
  let projectedStoredBytes, requiredScratchBytes, newSetLimitBytes;
  try {
    if (![nowMs, inventoryAtMs, databaseLimitBytes, mediaLimitBytes, manifestLimitBytes,
      storedBytes, incompleteUploadBytes, scratchFreeBytes, budgetBytes, scratchReserveBytes].every(safe) ||
      databaseLimitBytes === 0 || mediaLimitBytes === 0 || manifestLimitBytes === 0 ||
      budgetBytes === 0 || scratchReserveBytes < MIN_SCRATCH_RESERVE_BYTES) throw Error('invalid');
    if (inventoryAtMs > nowMs || nowMs - inventoryAtMs > INVENTORY_MAX_AGE_MS) issues.push('stale_inventory');
    newSetLimitBytes = sum(databaseLimitBytes, mediaLimitBytes, manifestLimitBytes);
    projectedStoredBytes = sum(storedBytes, incompleteUploadBytes, newSetLimitBytes);
    // Both data artifacts and the marker may coexist locally. Keep headroom.
    requiredScratchBytes = sum(newSetLimitBytes, scratchReserveBytes);
    if (projectedStoredBytes > budgetBytes) issues.push('bucket_budget_exceeded');
    if (requiredScratchBytes > scratchFreeBytes) issues.push('insufficient_scratch_space');
  } catch { issues.push('invalid_capacity_inputs'); }
  return { allowed: issues.length === 0, issues, projectedStoredBytes, requiredScratchBytes, newSetLimitBytes };
}

// A verified-transfer marker alone is not a successful independent restore.
// Do not infer last success from cron start, exit code, or object existence.
export function backupHealth({ nowMs, lastVerifiedTransferMs, lastIndependentRestoreMs,
  failedAttempt = false, overdueMs = 26 * 60 * 60 * 1000, restoreOverdueMs = 31 * 24 * 60 * 60 * 1000 }) {
  if (![nowMs, overdueMs, restoreOverdueMs].every(safe) || overdueMs === 0 || restoreOverdueMs === 0) throw Error('invalid health clock');
  const stale = (time, limit) => !safe(time) || time > nowMs || nowMs - time > limit;
  const issues = [];
  if (failedAttempt !== false) issues.push('backup_attempt_failed');
  if (stale(lastVerifiedTransferMs, overdueMs)) issues.push('verified_backup_missing_or_overdue');
  if (stale(lastIndependentRestoreMs, restoreOverdueMs)) issues.push('independent_restore_missing_or_overdue');
  return { healthy: issues.length === 0, issues };
}

// Candidate selection only: no automatic deletion, no deletion of incomplete,
// unverified, untrusted or last-known-restorable sets. Operator must verify
// current object identities, provider retention, legal holds and policy again.
export function retentionCandidates({ nowMs, sets, retainDays = 7, keepAtLeast = 2 }) {
  if (!safe(nowMs) || !Number.isInteger(retainDays) || retainDays < 1 || retainDays > 365 ||
      !Number.isInteger(keepAtLeast) || keepAtLeast < 2 || !Array.isArray(sets)) throw Error('invalid retention inputs');
  const ids = new Set();
  for (const set of sets) {
    if (!set || typeof set.id !== 'string' || !set.id || ids.has(set.id) ||
        !safe(set.createdAtMs) || set.createdAtMs > nowMs) throw Error('invalid backup inventory');
    ids.add(set.id);
  }
  const trusted = sets.filter(s => s.transferVerified === true && s.independentRestoreVerified === true &&
    s.provenanceVerified === true).sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id));
  const protectedIds = new Set(trusted.slice(0, keepAtLeast).map(s => s.id));
  const cutoff = nowMs - retainDays * 86400000;
  return trusted.filter(s => !protectedIds.has(s.id) && s.createdAtMs < cutoff &&
    s.legalHold === false && s.retentionLock === false).map(s => s.id);
}
