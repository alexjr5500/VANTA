'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { timeAgoShort } from '@/lib/appealUi';
import { getAccountAppealOverview, type AppealOverview } from '@/lib/appealApi';
import type { AppealRecord } from '@/lib/adminApi';
import { AbuseNote, AccountNoticeShell, CenteredSpinner, NoticeRows } from '../AccountNotice';
import { AppealSection } from '../AppealSection';

function SuspendedContent() {
  const router = useRouter();
  const { token, refreshToken, user, isLoading: authLoading, logout } = useAuth();
  const [overview, setOverview] = useState<AppealOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const result = await getAccountAppealOverview(token);
      setOverview(result);
    } catch (caught: any) {
      setError(caught?.message || 'Could not load your account notice.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!token && !refreshToken) {
      router.replace('/login');
      return;
    }
    if (user && user.status && user.status !== 'SUSPENDED') {
      router.replace('/reels');
      return;
    }
    if (token) void load();
    else setLoading(false);
  }, [authLoading, token, refreshToken, user, router, load]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  };

  const account = overview?.account;
  const untilLabel = account?.suspendedUntil
    ? new Date(account.suspendedUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const onSubmitted = (appeal: AppealRecord) => {
    setOverview((prev) => (prev ? { ...prev, appeal } : prev));
  };

  return (
    <>
      <AccountNoticeShell
        eyebrow="VANTA · Account notice"
        icon={<ShieldAlert size={26} />}
        title="Account Suspended"
        description="This account has been suspended by VANTA moderation. You can still sign in, but certain account features are temporarily unavailable. You may submit an appeal if you believe this action was made in error."
      >
        {loading ? (
          <CenteredSpinner label="Loading your notice…" />
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="mt-2 inline-flex items-center gap-1.5 font-semibold underline">
              <RefreshCw size={13} aria-hidden /> Try again
            </button>
          </div>
        ) : (
          <NoticeRows
            rows={[
              { label: 'Account', value: <strong className="text-white">@{account?.username || user?.username || '—'}</strong> },
              account?.suspendedReason ? { label: 'Reason', value: account.suspendedReason } : null,
              account?.suspendedAt ? { label: 'Suspended', value: timeAgoShort(account.suspendedAt) } : null,
              {
                label: 'Duration',
                value: untilLabel ? `Until ${untilLabel}` : 'In effect until reviewed or lifted',
              },
            ]}
          />
        )}
      </AccountNoticeShell>

      {token && overview ? (
        <div className="mx-auto w-full max-w-xl px-5">
          <AppealSection
            credential={token}
            latestAppeal={overview.appeal}
            sectionLabel="Suspended account appeal"
            onSubmitted={onSubmitted}
          />
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-xl px-5">
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          {signingOut ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <LogOut size={15} aria-hidden />}
          Sign out
        </button>
        <AbuseNote />
      </div>
    </>
  );
}

export default function SuspendedAccountPage() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center"><Loader2 className="animate-spin text-white/40" aria-label="Loading" /></main>}>
      <SuspendedContent />
    </Suspense>
  );
}
