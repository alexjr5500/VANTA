'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getWithdrawals, reserveWithdrawalPayout, approveWithdrawal, rejectWithdrawal, type AdminWithdrawal } from '@/lib/adminApi';
import { withdrawalActions, canSubmitWithdrawalAction, type WithdrawalAction } from '@/lib/withdrawalReview';

const PAGE_SIZE = 25;
const reviewRoles = ['ADMIN', 'ADMINISTRATOR', 'CEO', 'SUPER_ADMIN'];
const filters = [
  ['active', 'Active / unresolved'], ['PENDING', 'Pending'], ['PAYOUT_RESERVED', 'Payout reserved'],
  ['PROCESSING', 'Legacy processing'], ['APPROVED', 'Legacy approved'], ['COMPLETED', 'Completed'],
  ['FAILED', 'Failed'], ['CANCELLED', 'Cancelled'], ['all', 'All withdrawals'],
];
const labels: Record<WithdrawalAction, string> = { reserve: 'Reserve payout', settle: 'Verify settlement', reject: 'Reject / refund' };
const money = (n: number) => Number.isFinite(n) ? n.toFixed(2) : 'Unavailable';

export default function WithdrawalQueue({ onChanged }: { onChanged: () => void }) {
  const { user, token } = useAuth();
  const canReview = !!user && reviewRoles.includes(user.role ?? '');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminWithdrawal[]>([]);
  const [loadedScope, setLoadedScope] = useState<{ token: string; status: string; page: number } | null>(null);
  const currentQueue = !!token && loadedScope?.token === token && loadedScope.status === status && loadedScope.page === page;
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<{ row: AdminWithdrawal; action: WithdrawalAction } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const session = useRef(token);
  session.current = token;

  const clearReview = useCallback(() => {
    setSelected(null); setReviewed(false); setConfirmation(''); setEvidence('');
  }, []);

  const load = useCallback(async () => {
    const request = ++generation.current;
    clearReview();
    setLoadedScope(null); setRows([]); setMore(false); setLoading(true); setError('');
    if (!token || !canReview) {
      setLoading(false);
      return;
    }
    try {
      const result = await getWithdrawals(token, PAGE_SIZE + 1, status, page * PAGE_SIZE);
      if (request !== generation.current || session.current !== token) return;
      if (!Array.isArray(result)) throw new Error('Invalid withdrawal queue response');
      setLoadedScope({ token, status, page });
      setRows(result.slice(0, PAGE_SIZE));
      setMore(result.length > PAGE_SIZE);
    } catch {
      if (request === generation.current && session.current === token) setError('Unable to load a current withdrawal queue. Refresh before taking any action.');
    } finally {
      if (request === generation.current && session.current === token) setLoading(false);
    }
  }, [token, canReview, status, page, clearReview]);

  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);

  const select = (row: AdminWithdrawal, action: WithdrawalAction) => {
    if (!currentQueue || loading || busy || mutation.current || error || !withdrawalActions(row).includes(action)) return;
    clearReview(); setNotice(''); setSelected({ row, action });
  };

  const submit = async () => {
    if (!token || !canReview || !currentQueue || !selected || loading || error || mutation.current) return;
    const { row, action } = selected;
    if (!canSubmitWithdrawalAction(row, action, confirmation, reviewed, evidence)) return;
    const requestToken = token;
    mutation.current = true;
    setBusy(true); setNotice('');
    try {
      const result = action === 'reserve'
        ? await reserveWithdrawalPayout(token, row.id, true)
        : action === 'settle'
          ? await approveWithdrawal(token, row.id, evidence.trim())
          : await rejectWithdrawal(token, row.id, evidence.trim());
      const expected = action === 'reserve' ? 'PAYOUT_RESERVED' : action === 'settle' ? 'COMPLETED' : 'FAILED';
      if (result?.withdrawal?.id !== row.id || result.withdrawal.status !== expected) throw new Error('Unexpected withdrawal response');
      if (session.current === requestToken) {
        setNotice(action === 'reserve' ? 'Reservation recorded. VANTA has not sent a payment.' : action === 'settle' ? 'Settlement verification completed.' : 'Rejection and refund recorded.');
        onChanged();
      }
    } catch {
      if (session.current === requestToken) setNotice('Outcome not confirmed. No automatic retry was made. Review the refreshed server state and reconcile before any further action.');
    } finally {
      clearReview();
      if (session.current === requestToken) await load();
      mutation.current = false;
      setBusy(false);
    }
  };

  if (!canReview) return null;
  return (
    <GlassCard>
      <section aria-labelledby="withdrawal-queue-title" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="withdrawal-queue-title" className="text-lg font-semibold text-white">Withdrawal review</h2>
            <p className="text-sm text-gray-400">Manual settlement review. Reserving a request does not send money.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Withdrawal status" value={status} disabled={busy} onChange={e => { clearReview(); setStatus(e.target.value); setPage(0); }} className="glass rounded-xl px-3 py-2 text-sm text-white">
              {filters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <Button type="button" variant="ghost" size="sm" disabled={busy || loading} onClick={() => void load()}>Refresh queue</Button>
          </div>
        </div>
        {notice && <p role="status" className="rounded-lg border border-white/10 p-3 text-sm text-gray-200">{notice}</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {loading ? <p className="text-sm text-gray-400">Loading current withdrawals…</p> : !error && rows.length === 0 ? <p className="text-sm text-gray-400">No withdrawals match this page.</p> : null}
        {currentQueue && !loading && !error && rows.map(row => {
          const actions = withdrawalActions(row);
          return (
            <article key={row.id} className="rounded-xl border border-white/10 p-3 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <div className="text-sm font-medium text-white">{row.user?.username ? '@' + row.user.username : row.userId}</div>
                <span className="text-xs text-gray-300">{row.status}</span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs text-gray-300 sm:grid-cols-3">
                <div><dt className="text-gray-500">Requested (USD)</dt><dd>{money(row.amount)}</dd></div>
                <div><dt className="text-gray-500">Fee (USD)</dt><dd>{money(row.fee)}</dd></div>
                <div><dt className="text-gray-500">Net ({row.currency})</dt><dd>{money(row.netAmount)}</dd></div>
                <div><dt className="text-gray-500">Network</dt><dd>{row.cryptoNetwork || 'Unknown'}</dd></div>
                <div><dt className="text-gray-500">Requested at</dt><dd>{new Date(row.createdAt).toLocaleString()}</dd></div>
                <div><dt className="text-gray-500">Operator</dt><dd className="break-all">{row.processedBy || '—'}</dd></div>
                <div className="col-span-full"><dt className="text-gray-500">Withdrawal ID</dt><dd className="break-all font-mono">{row.id}</dd></div>
                <div className="col-span-full"><dt className="text-gray-500">Destination</dt><dd className="break-all font-mono">{row.walletAddress || 'Unavailable'}</dd></div>
                {row.transactionHash !== null && <div className="col-span-full"><dt className="text-gray-500">Recorded settlement reference</dt><dd className="break-all font-mono">{row.transactionHash || 'Invalid reference'}</dd></div>}
              </dl>
              {actions.length > 0 ? <div className="flex flex-wrap gap-2">
                {actions.map(action => <Button key={action} type="button" size="sm" variant={action === 'reject' ? 'danger' : 'outline'} disabled={busy} onClick={() => select(row, action)}>{labels[action]}</Button>)}
              </div> : <p className="text-xs text-gray-400">Read-only. Legacy, final or ambiguous records require reconciliation; no override is available here.</p>}
              {row.status === 'PAYOUT_RESERVED' && <p className="text-xs text-amber-300">Reserved funds cannot be ordinarily refunded. An uncertain settlement remains reserved for reconciliation.</p>}
              {selected?.row.id === row.id && (
                <div className="space-y-3 rounded-xl border border-amber-400/30 p-3">
                  <h3 className="font-medium text-white">{labels[selected.action]}</h3>
                  <p className="text-xs text-gray-300">{selected.action === 'reserve' ? 'Review treasury/provider history and confirm no prior payout. Reservation blocks ordinary cancellation and refunds.' : selected.action === 'settle' ? 'Submit only independently reconciled settlement evidence. The server verifies the transaction before completion.' : 'Reject only after reconciling that no payment was initiated. A successful rejection refunds the reserved earnings.'}</p>
                  <label className="flex items-start gap-2 text-sm text-gray-200">
                    <input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} />
                    {selected.action === 'settle' ? 'I reviewed the request and its settlement evidence.' : 'I reconciled the request and confirmed no external payout was initiated.'}
                  </label>
                  <label className="block text-xs text-gray-300">Type the withdrawal ID to confirm
                    <input autoComplete="off" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-white" />
                  </label>
                  {selected.action !== 'reserve' && <label className="block text-xs text-gray-300">{selected.action === 'settle' ? 'On-chain transaction hash' : 'Rejection reason (10–500 characters)'}
                    <input autoComplete="off" spellCheck={false} value={evidence} maxLength={selected.action === 'settle' ? 66 : 500} disabled={busy} onChange={e => setEvidence(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-white" />
                  </label>}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant={selected.action === 'reject' ? 'danger' : 'primary'} loading={busy} disabled={!canSubmitWithdrawalAction(row, selected.action, confirmation, reviewed, evidence)} onClick={() => void submit()}>Confirm {labels[selected.action].toLowerCase()}</Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={clearReview}>Close review</Button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
        <div className="flex items-center justify-center gap-3 text-xs text-gray-400">
          <Button type="button" variant="ghost" size="sm" disabled={loading || busy || page === 0} onClick={() => { clearReview(); setPage(p => p - 1); }}>Previous</Button>
          Page {page + 1}
          <Button type="button" variant="ghost" size="sm" disabled={loading || busy || !more} onClick={() => { clearReview(); setPage(p => p + 1); }}>Next</Button>
        </div>
      </section>
    </GlassCard>
  );
}
