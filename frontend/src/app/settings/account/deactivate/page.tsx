'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { accountApi } from '@/lib/complianceApi';

export default function DeactivatePage() {
  const { token, updateUser } = useAuth();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  const deactivate = async () => {
    if (!token || !acknowledged || lock.current) return;
    if (!window.confirm('Deactivate your VANTA account? You must reactivate within 30 days to avoid permanent deletion.')) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await accountApi.deactivate(reason || undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not deactivate your account.');
      lock.current = false;
      setBusy(false);
      return;
    }
    // The server has already deactivated the account; a local update failure
    // must not invite another destructive request.
    try { await updateUser({ status: 'DEACTIVATED' }); }
    catch { /* The committed server state remains authoritative. */ }
    finally { router.replace('/account/deactivated'); }
  };

  return (
    <div className="space-y-5 pb-24">
      <PageHeader sticky bleed title="Deactivate your account" back="/settings/account" />
      <h2 className="text-lg font-semibold">What happens when you deactivate?</h2>
      <p className="text-sm leading-6 opacity-80">Your account will be disabled. You can restore access by reactivating during the 30-day recovery period.</p>
      <p className="rounded-xl border border-amber-500/35 p-4 text-sm leading-6 text-[var(--foreground)]">If you do not reactivate before the recovery deadline, your account can be permanently deleted. Download your data before deactivating if you want to keep a copy.</p>
      <label className="block space-y-2 text-sm">
        <span>Reason (optional)</span>
        <select value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} className="min-h-12 w-full rounded-xl border border-white/15 bg-[var(--surface)] px-3">
          <option value="">Choose a reason</option>
          <option value="privacy_concerns">Privacy concerns</option>
          <option value="security">Security concerns</option>
          <option value="platform_migration">Moving to another platform</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="flex items-start gap-3 text-sm leading-5">
        <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-amber-400" />
        <span>I understand the 30-day recovery deadline and the risk of permanent deletion.</span>
      </label>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button type="button" disabled={!token || !acknowledged || busy} onClick={() => void deactivate()} className="min-h-12 w-full rounded-xl border border-red-400/60 px-4 font-semibold text-red-400 disabled:opacity-40">{busy ? 'Deactivating…' : 'Deactivate account'}</button>
    </div>
  );
}
