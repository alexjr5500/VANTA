'use client';

import { useState, useRef } from 'react';
import Button from '@/components/ui/Button';
import { getWithdrawalRecoveryHistory, recordWithdrawalRecovery, type AdminWithdrawal, type WithdrawalRecoveryOutcome, type WithdrawalRecoveryReview } from '@/lib/adminApi';

const outcomes: { key: WithdrawalRecoveryOutcome; label: string }[] = [
  { key: 'UNKNOWN', label: 'Uncertain / evidence incomplete' },
  { key: 'PAYOUT_PENDING', label: 'External payout pending' },
  { key: 'PAYOUT_FAILED_REPORTED', label: 'External failure reported' },
  { key: 'PAYOUT_FOUND', label: 'Candidate payout found' },
  { key: 'NO_PAYOUT_FOUND', label: 'No payout located in reviewed history' },
];

export default function WithdrawalRecoveryPanel({ row, token, disabled }: { row: AdminWithdrawal; token: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<WithdrawalRecoveryReview[]>([]);
  const [more, setMore] = useState(false);
  const [outcome, setOutcome] = useState<WithdrawalRecoveryOutcome>('UNKNOWN');
  const [caseReference, setCaseReference] = useState('');
  const [notes, setNotes] = useState('');
  const [candidateHash, setCandidateHash] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const validHash = /^0x[a-fA-F0-9]{64}$/.test(candidateHash.trim());
  const valid = ready && confirmed && /^[A-Za-z0-9._-]{5,80}$/.test(caseReference.trim()) &&
    notes.trim().length >= 20 && notes.trim().length <= 1000 &&
    (!candidateHash.trim() || validHash) && (outcome !== 'PAYOUT_FOUND' || validHash);

  async function refresh() {
    setReady(false);
    try {
      const result = await getWithdrawalRecoveryHistory(token, row.id);
      if (result.status !== row.status || result.financialActionAuthorized !== false || !Array.isArray(result.entries)) {
        setMessage('Withdrawal changed. Refresh the main queue before reviewing.');
        return;
      }
      setHistory(result.entries); setMore(result.more); setReady(true);
    } catch { setMessage('Recovery history unavailable. Refresh before recording a review.'); }
  }

  async function load() {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setBusy(true); setOpen(true); setMessage('');
    try { await refresh(); } finally { inFlight.current = false; setBusy(false); }
  }

  async function submit() {
    if (disabled || inFlight.current || !valid) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const result = await recordWithdrawalRecovery(token, row.id, {
        expectedStatus: row.status, outcome, caseReference: caseReference.trim(), notes: notes.trim(),
        candidateHash: candidateHash.trim() || undefined,
      });
      if (result.review.withdrawalId !== row.id || result.review.financialActionAuthorized !== false || result.review.independentlyVerified !== false) throw new Error('Unexpected response');
      setMessage('Review recorded. Funds remain unchanged.');
    } catch {
      setMessage('Review outcome uncertain. No automatic retry. Check refreshed review history before submitting another.');
    } finally {
      setConfirmed(false); setNotes(''); setCandidateHash(''); setCaseReference(''); setOutcome('UNKNOWN');
      await refresh(); inFlight.current = false; setBusy(false);
    }
  }

  if (!open) return <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void load()}>Recovery review</Button>;
  const field = 'mt-1 w-full rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-white';
  return <section className="space-y-3 rounded-xl border border-amber-400/30 p-3">
    <h3 className="font-medium text-white">Recovery evidence only</h3>
    <p className="text-xs text-amber-300">No review can initiate a payment, release a reservation or authorize a refund. Failed or missing evidence does not prove no payout occurred. Do not include keys, credentials or personal data in notes.</p>
    {message && <p role="status" className="text-xs text-gray-200">{message}</p>}
    <div className="flex gap-2">
      <Button type="button" size="sm" variant="ghost" disabled={busy || disabled} onClick={() => void load()}>Refresh history</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setOpen(false); setReady(false); setConfirmed(false); }}>Close</Button>
    </div>
    {history.map(review => <div key={review.id} className="rounded-lg border border-white/10 p-2 text-xs text-gray-300 space-y-1">
      <p>{new Date(review.createdAt).toLocaleString()} · {review.outcome}</p>
      <p className="break-all">Case {review.caseReference} · Operator {review.adminId}</p>
      <p>Reported at {review.observedStatus} · Matching pending ledger entries: {review.exactPendingLedgerCount}</p>
      {review.candidateHash && <p className="break-all font-mono">Unverified candidate: {review.candidateHash}</p>}
      <p className="break-words">{review.notes}</p>
    </div>)}
    {more && <p className="text-xs text-gray-400">Showing the latest 20 reviews; older evidence remains in audit history.</p>}
    {ready && history.length === 0 && <p className="text-xs text-gray-400">No recorded recovery reviews.</p>}
    {ready && <div className="space-y-2">
      <label className="block text-xs text-gray-300">Reported outcome
        <select className={field} disabled={busy || disabled} value={outcome} onChange={e => { setOutcome(e.target.value as WithdrawalRecoveryOutcome); setConfirmed(false); }}>
          {outcomes.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>
      <label className="block text-xs text-gray-300">Case reference
        <input className={field} autoComplete="off" maxLength={80} disabled={busy || disabled} value={caseReference} onChange={e => { setCaseReference(e.target.value); setConfirmed(false); }} />
      </label>
      <label className="block text-xs text-gray-300">Candidate transaction hash (unverified)
        <input className={field} autoComplete="off" spellCheck={false} maxLength={66} disabled={busy || disabled} value={candidateHash} onChange={e => { setCandidateHash(e.target.value); setConfirmed(false); }} />
      </label>
      <label className="block text-xs text-gray-300">Evidence reviewed, time range and unresolved questions (20–1000 characters)
        <textarea className={field} maxLength={1000} rows={3} disabled={busy || disabled} value={notes} onChange={e => { setNotes(e.target.value); setConfirmed(false); }} />
      </label>
      <label className="flex items-start gap-2 text-xs text-gray-300">
        <input type="checkbox" checked={confirmed} disabled={busy || disabled} onChange={e => setConfirmed(e.target.checked)} />
        I confirm this is an evidence record, not authorization to pay or refund.
      </label>
      <Button type="button" size="sm" loading={busy} disabled={disabled || !valid} onClick={() => void submit()}>Record recovery evidence</Button>
    </div>}
  </section>;
}
