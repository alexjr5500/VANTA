'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Coins, Gift, Wallet, ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { getTransactionHistory, getGiftHistory } from '@/lib/walletApi';
import type { CreatorStats } from '@/lib/creatorStudio';
import ConsolePanel from '@/components/console/Panel';
import StatusBadge, { statusToneFor } from '@/components/console/StatusBadge';
import { ConsoleErrorState, ConsoleEmptyState, SkeletonRows } from '@/components/console/States';
import { fmtCompact, fmtCurrency, fmtDateTime } from '@/components/console/format';

// ============================================================================
// CREATOR EARNINGS / MONETIZATION — real creator wallet + aggregated stats.
// No client-side financial math: earnings, balances and every transaction come
// from the existing /api/creator/stats and /api/wallets/* services. The four
// figures are kept deliberately distinct (lifetime earnings vs. withdrawable
// balance vs. coin balance vs. gifts received) because they are not
// interchangeable in VANTA's economy. Withdrawals stay on the existing
// /balance flow — the backend payout workflow is not duplicated here.
// ============================================================================

export default function CreatorEarningsPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [giftHistory, setGiftHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [statsRes, txRes, giftRes] = await Promise.all([
        apiGet<{ stats: CreatorStats }>('/api/creator/stats', token).catch(() => ({ stats: null }) as any),
        getTransactionHistory({ limit: 25 }).catch(() => ({}) as any),
        getGiftHistory(15).catch(() => ({}) as any),
      ]);
      const txData: any = txRes ?? {};
      const giftData: any = giftRes ?? {};
      setStats(statsRes?.stats ?? null);
      setTransactions(Array.isArray(txData.transactions) ? txData.transactions : []);
      setGiftHistory(Array.isArray(giftData.transactions) ? giftData.transactions : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load earnings.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="vc-panel h-28 animate-pulse" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded bg-white/[0.04]" />)}
        </div>
        <div className="vc-panel">
          <SkeletonRows rows={5} />
        </div>
      </div>
    );
  }

  if (error) {
    return <ConsoleErrorState title="Couldn't load your earnings" message={error} onRetry={() => void fetchData()} />;
  }

  const hasActivity = transactions.length > 0 || giftHistory.length > 0;

  return (
    <div className="space-y-8 pb-10">
      {/* ── Balance summary: one emphasised figure, clearly labelled ───────── */}
      <section className="vc-panel p-5" aria-label="Earnings summary">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-console-text-3">
              Lifetime creator earnings
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-console-text tabular-nums">
              {fmtCurrency(stats?.earnings ?? 0)}
            </p>
            <p className="mt-1.5 text-xs text-console-text-3">
              Total credited to date. Not the same as your withdrawable balance.
            </p>
          </div>
          <Link
            href="/balance"
            className="vc-focus inline-flex min-h-9 items-center gap-1.5 rounded-[var(--vc-radius)] border border-console-border-strong px-3.5 text-xs font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text"
          >
            <Wallet size={14} aria-hidden /> Balance &amp; withdrawals
          </Link>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 border-t border-console-border pt-5 sm:grid-cols-3">
          <div>
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-console-text-3">
              <Wallet size={12} aria-hidden /> Withdrawable balance
            </dt>
            <dd className="mt-1 text-xl font-semibold text-console-gold tabular-nums">{fmtCurrency(stats?.earningsBalance ?? 0)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-console-text-3">
              <Coins size={12} aria-hidden /> Coin balance
            </dt>
            <dd className="mt-1 text-xl font-semibold text-console-text tabular-nums">{fmtCompact(stats?.coins ?? 0)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-console-text-3">
              <Gift size={12} aria-hidden /> Gifts received
            </dt>
            <dd className="mt-1 text-xl font-semibold text-console-text tabular-nums">{fmtCompact(stats?.giftsReceived ?? 0)}</dd>
          </div>
        </dl>
      </section>

      {/* ── Transaction ledger ─────────────────────────────────────────────── */}
      <ConsolePanel
        title="Wallet transactions"
        description="Real ledger entries from your wallet, newest first"
        actions={
          <Link href="/balance" className="vc-focus inline-flex items-center gap-1 rounded text-xs font-semibold text-console-gold hover:text-console-gold-hover">
            Full history <ArrowUpRight size={13} aria-hidden />
          </Link>
        }
        bodyClassName="p-0"
      >
        {transactions.length === 0 ? (
          <ConsoleEmptyState
            icon={<Wallet size={19} aria-hidden />}
            title="No transactions yet"
            description="Gifts, transfers and purchases you take part in will appear here as real ledger entries."
          />
        ) : (
          <ul className="divide-y divide-console-border">
            {transactions.slice(0, 12).map((tx: any) => {
              const positive = Number(tx.amount || 0) > 0;
              return (
                <li key={tx.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                      positive ? 'bg-console-success-soft text-console-success' : 'bg-console-danger-soft text-console-danger'
                    }`}
                    aria-hidden
                  >
                    {positive ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-console-text">
                      {tx.description || tx.type || 'Transaction'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-console-text-3">{fmtDateTime(tx.createdAt || tx.timestamp)}</p>
                  </div>
                  {tx.status ? (
                    <StatusBadge tone={statusToneFor(tx.status)} label={String(tx.status)} className="hidden sm:inline-flex" />
                  ) : null}
                  <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${positive ? 'text-console-success' : 'text-console-text'}`}>
                    {positive ? '+' : ''}{fmtCurrency(tx.amount || 0)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </ConsolePanel>

      {/* ── Gift activity ──────────────────────────────────────────────────── */}
      {giftHistory.length > 0 && (
        <ConsolePanel title="Recent gifts received" description="Coins credited to you from viewers" bodyClassName="p-0">
          <ul className="divide-y divide-console-border">
            {giftHistory.slice(0, 8).map((g: any, i: number) => (
              <li key={g.id || i} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-console-text">
                    {g.gift?.name || g.giftName || 'Gift'}
                    {g.from?.username ? <span className="text-console-text-3"> from @{g.from.username}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-console-text-3">{fmtDateTime(g.createdAt || g.timestamp)}</p>
                </div>
                <span className="shrink-0 text-[13px] font-semibold text-console-gold tabular-nums">
                  {fmtCompact(g.amount ?? g.coins ?? 0)} coins
                </span>
              </li>
            ))}
          </ul>
        </ConsolePanel>
      )}

      {!hasActivity && (
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-console-text-3">
          <Info size={13} className="mt-px shrink-0" aria-hidden />
          Earnings update as gifts and payments settle. Withdrawals, payout requests and your wallet address are managed on the
          existing Balance page.
        </p>
      )}
    </div>
  );
}
