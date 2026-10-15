'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Ban, Loader2, RefreshCw } from 'lucide-react';
import { timeAgoShort } from '@/lib/appealUi';
import {
  clearAppealContext,
  getAccountAppealOverview,
  readAppealContext,
  type AppealOverview,
} from '@/lib/appealApi';
import type { AppealRecord } from '@/lib/adminApi';
import { AbuseNote, AccountNoticeShell, CenteredSpinner, InlineStatus, NoticeRows } from '../AccountNotice';
import { AppealSection } from '../AppealSection';

function BannedContent() {
  // The banned screen intentionally runs WITHOUT an app session. The only
  // credential available is the short-lived appeal token issued at login
  // (kept in session storage so a reload keeps the screen usable).
  const [appealToken] = useState<string | null>(() => readAppealContext().appealToken);
  const [storedUsername] = useState<string | null>(() => readAppealContext().username);
  const [overview, setOverview] = useState<AppealOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const load = useCallback(async () => {
    if (!appealToken) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setInvalid(false);
    try {
      const result = await getAccountAppealOverview(appealToken);
      setOverview(result);
    } catch (caught: any) {
      const code = caught?.data?.code;
      if (code === 'APPEAL_TOKEN_INVALID' || caught?.statusCode === 401 || caught?.statusCode === 403) {
        setInvalid(true);
      } else {
        setInvalid(true);
      }
    } finally {
      setLoading(false);
    }
  }, [appealToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmitted = (appeal: AppealRecord) => {
    setOverview((prev) => (prev ? { ...prev, appeal } : prev));
  };

  const handleStartOver = () => {
    clearAppealContext();
    window.location.href = '/login';
  };

  if (loading) {
    return (
      <AccountNoticeShell
        eyebrow="VANTA · Account notice"
        icon={<Ban size={26} />}
        title="Account Banned"
        description="Checking your account status…"
      >
        <CenteredSpinner label="Loading your notice…" />
      </AccountNoticeShell>
    );
  }

  if (invalid || (!overview && !appealToken)) {
    return (
      <AccountNoticeShell
        eyebrow="VANTA · Account notice"
        icon={<Ban size={26} />}
        title="Account Banned"
        description="This appeal session is no longer valid. It may have expired, or the account may no longer be banned."
      >
        <InlineStatus tone="info">
          To appeal a ban, sign in with the banned account on the login page — a fresh appeal
          session is created automatically when your credentials are verified.
        </InlineStatus>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#d6a83f] px-5 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90"
          >
            Back to sign in
          </Link>
          <button
            type="button"
            onClick={handleStartOver}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 px-5 py-3 text-sm font-semibold text-white/80 hover:bg-white/5"
          >
            <RefreshCw size={15} aria-hidden /> Start over
          </button>
        </div>
      </AccountNoticeShell>
    );
  }

  const account = overview?.account;

  return (
    <>
      <AccountNoticeShell
        eyebrow="VANTA · Account notice"
        icon={<Ban size={26} />}
        title="Account Banned"
        description="This account has been banned from VANTA. You cannot sign in to the normal application while this ban is active. If you believe this decision was made in error, you may submit an appeal for review."
      >
        <NoticeRows
          rows={[
            { label: 'Account', value: <strong className="text-white">@{account?.username || storedUsername || '—'}</strong> },
            account?.bannedReason ? { label: 'Reason', value: account.bannedReason } : null,
            account?.bannedAt ? { label: 'Banned', value: timeAgoShort(account.bannedAt) } : null,
          ]}
        />
      </AccountNoticeShell>

      {appealToken && overview ? (
        <div className="mx-auto w-full max-w-xl px-5">
          <AppealSection
            credential={appealToken}
            latestAppeal={overview.appeal}
            sectionLabel="Banned account appeal"
            onSubmitted={onSubmitted}
          />
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-xl px-5">
        <AbuseNote />
      </div>
    </>
  );
}

export default function BannedAccountPage() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center"><Loader2 className="animate-spin text-white/40" aria-label="Loading" /></main>}>
      <BannedContent />
    </Suspense>
  );
}
