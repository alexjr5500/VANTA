'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { getDashboardStats, getInfrastructure } from '@/lib/adminApi';
import { cn } from '@/lib/utils';
import {
  Users, UserPlus, ShieldCheck, Radio, Flag,
  FileText, DollarSign, RefreshCw, ChevronRight,
  Wallet, Gift, Server, BadgeCheck, Crown, Activity,
  AlertTriangle,
} from 'lucide-react';
import MetricTile from '@/components/console/MetricTile';
import ConsolePanel from '@/components/console/Panel';
import StatusBadge, { statusToneFor } from '@/components/console/StatusBadge';
import TrendChart from '@/components/console/TrendChart';
import {
  ConsoleErrorState, ConsoleEmptyState, SkeletonRows,
} from '@/components/console/States';
import {
  fmtNumber, fmtCompact, fmtCompactCurrency, timeAgo,
} from '@/components/console/format';

// ============================================================================
// ADMIN COMMAND CENTER - OVERVIEW
// ----------------------------------------------------------------------------
// Every figure below is read live from GET /api/admin/stats plus the real
// GET /api/admin/infrastructure service-health snapshot. Nothing is invented:
// a metric with no backend source is not rendered, and each period is labelled
// explicitly so cumulative totals are never mistaken for activity counts.
// ============================================================================

type GrowthKey = '7d' | '30d' | '90d' | '12m';

const GROWTH_LABEL: Record<GrowthKey, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '12m': 'last 12 months',
};

const QUICK_ACTIONS = [
  { href: '/admin/users', label: 'User management', desc: 'Roles, status, verification', icon: Users },
  { href: '/admin/compliance', label: 'Moderation queue', desc: 'Reports awaiting review', icon: Flag },
  { href: '/admin/finance', label: 'Finance ledger', desc: 'Transactions and payouts', icon: Wallet },
  { href: '/admin/verification', label: 'Verification', desc: 'Badge requests and approvals', icon: BadgeCheck },
  { href: '/admin/gifts', label: 'Gift catalog', desc: 'Pricing and availability', icon: Gift },
  { href: '/admin/infrastructure', label: 'System health', desc: 'Service diagnostics', icon: Server },
];

const roleTone = (role: string | undefined) => {
  const r = String(role || '').toUpperCase();
  if (['SUPER_ADMIN', 'CEO', 'FINANCE_MANAGER'].includes(r)) return 'gold' as const;
  if (['MODERATOR', 'SUPPORT_AGENT', 'CONTENT_REVIEWER'].includes(r)) return 'info' as const;
  return 'neutral' as const;
};

export default function AdminPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [infra, setInfra] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [growthKey, setGrowthKey] = useState<GrowthKey>('30d');

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const [data, infraData] = await Promise.all([
        getDashboardStats(token),
        getInfrastructure(token).catch(() => null),
      ]);
      setStats(data);
      setInfra(infraData);
    } catch (err: any) {
      setError(err?.message || 'Failed to load the platform overview.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const growth = useMemo(() => {
    const raw = stats?.userGrowth?.[growthKey];
    return Array.isArray(raw)
      ? raw.map((g: any) => ({ label: String(g.date || g.month || ''), value: Number(g.count) || 0 }))
      : [];
  }, [stats, growthKey]);

  const services = Array.isArray(infra?.services) ? infra.services : [];
  const s: any = stats || {};

  if (loading && !stats) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="space-y-2">
          <div className="h-6 w-52 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3.5 w-80 animate-pulse rounded bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded bg-white/[0.04]" />)}
        </div>
        <div className="vc-panel"><SkeletonRows rows={6} /></div>
      </div>
    );
  }

  if (error && !stats) {
    return <ConsoleErrorState title="Platform overview unavailable" message={error} onRetry={() => void fetchData()} />;
  }

  const pendingReports = Number(s.pendingReports || 0);
  const rawVerificationCount = s.pendingVerificationRequests ?? s.pendingVerifications;
  const pendingVerifications = Number(rawVerificationCount ?? NaN);
  const pendingWithdrawals = Number(s.pendingWithdrawals || 0);
  const economyMax = Math.max(1, s.revenue || 0, s.totalGiftVolume || 0, s.coinPurchases || 0, s.badgePurchases || 0);

  return (
    <div className="space-y-8 pb-10">
      {/* ---- Operational indicators: one open metric band, not card grids ---- */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-console-text-3">Operational indicators</h2>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={refreshing}
          aria-busy={refreshing || undefined}
          className="vc-focus inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-[var(--vc-radius)] border border-console-border px-2.5 text-[11px] font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text disabled:opacity-60"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} aria-hidden />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <section aria-label="Operational indicators">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
          <MetricTile
            label="Registered users"
            value={fmtCompact(s.totalUsers)}
            icon={<Users size={13} />}
            accent
            hint={`${fmtCompact(s.newUsersThisMonth)} joined in the last 30 days`}
          />
          <MetricTile
            label="Active today"
            value={fmtCompact(s.activeUsersToday)}
            icon={<Activity size={13} />}
            hint={`${fmtCompact(s.activeUsersThisWeek)} this week, ${fmtCompact(s.onlineUsers)} online now`}
          />
          <MetricTile
            label="Purchase revenue"
            value={fmtCompactCurrency(s.revenue)}
            icon={<DollarSign size={13} />}
            hint="Completed purchase orders"
          />
          <MetricTile
            label="Active streams"
            value={fmtCompact(s.activeStreams)}
            icon={<Radio size={13} />}
            hint={`${fmtCompact(s.totalStreams)} streams all-time`}
          />
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-console-text-3">
          Cumulative and period figures are computed directly from the production database by the
          admin stats service. Registered users is a lifetime count, not an activity count.
        </p>
      </section>

      {/* ------------------------ Growth trend + economy ---------------------- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ConsolePanel
          className="lg:col-span-2"
          title="User growth"
          description={`New accounts per period, ${GROWTH_LABEL[growthKey]}`}
          actions={
            <div className="flex items-center gap-0.5 rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 p-0.5" role="group" aria-label="Growth period">
              {(['7d', '30d', '90d', '12m'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setGrowthKey(k)}
                  aria-pressed={growthKey === k}
                  className={cn(
                    'vc-focus rounded-[calc(var(--vc-radius)-2px)] px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    growthKey === k ? 'bg-console-gold text-console-gold-fg' : 'text-console-text-3 hover:text-console-text-2',
                  )}
                >
                  {k === '12m' ? '12 mo' : k}
                </button>
              ))}
            </div>
          }
          bodyClassName="px-4 pb-5 pt-4 sm:px-5"
        >
          {growth.length === 0 ? (
            <ConsoleEmptyState
              icon={<Users size={19} />}
              title="No signups in this period"
              description="The reporting backend returned no new-account buckets for the selected range."
            />
          ) : (
            <TrendChart
              data={growth}
              variant="bar"
              height={200}
              formatValue={fmtCompact}
              ariaLabel={`New user accounts per period over the ${GROWTH_LABEL[growthKey]}`}
            />
          )}
        </ConsolePanel>

        <ConsolePanel title="Economy" description="Real monetization activity" bodyClassName="px-4 py-4 sm:px-5">
          <dl className="space-y-4">
            {[
              { label: 'Purchase revenue', value: s.revenue, tone: 'bg-console-success' },
              { label: 'Gift volume (coins)', value: s.totalGiftVolume, tone: 'bg-console-gold' },
              { label: 'Coin purchases', value: s.coinPurchases, tone: 'bg-console-info' },
              { label: 'Badge purchases', value: s.badgePurchases, tone: 'bg-console-warning' },
            ].map((row) => (
              <div key={row.label}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-console-text-3">{row.label}</dt>
                  <dd className="text-xs font-semibold tabular-nums text-console-text">{fmtNumber(row.value)}</dd>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={cn('h-full rounded-full', row.tone)}
                    style={{ width: `${Math.max(2, Math.min(100, (Number(row.value || 0) / economyMax) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </dl>
          <Link href="/admin/finance" className="vc-focus mt-5 inline-flex items-center gap-1 rounded text-xs font-semibold text-console-gold hover:text-console-gold-hover">
            Open finance ledger <ChevronRight size={13} aria-hidden />
          </Link>
        </ConsolePanel>
      </div>

      {/* ------------------ Queues requiring attention ----------------------- */}
      <section aria-label="Queues requiring attention">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-console-text-3">Requires attention</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: 'Pending reports', value: pendingReports, known: true, href: '/admin/compliance', icon: Flag, desc: 'Open moderation reports' },
            { label: 'Verification requests', value: pendingVerifications, known: Number.isFinite(pendingVerifications), href: '/admin/verification', icon: BadgeCheck, desc: 'Awaiting badge review' },
            { label: 'Pending withdrawals', value: pendingWithdrawals, known: true, href: '/admin/finance', icon: Wallet, desc: 'Payouts awaiting review' },
          ].map((q) => {
            const Icon = q.icon;
            const hasWork = q.known && q.value > 0;
            return (
              <Link
                key={q.label}
                href={q.href}
                className="vc-focus vc-panel group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:border-console-border-strong hover:bg-white/[0.02]"
              >
                <span className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-[var(--vc-radius)]',
                  hasWork ? 'bg-console-warning-soft text-console-warning' : 'bg-white/[0.04] text-console-text-3',
                )}>
                  <Icon size={16} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-2xl font-semibold leading-none tabular-nums text-console-text">
                    {q.known ? fmtNumber(q.value) : 'Unavailable'}
                  </span>
                  <span className="mt-1.5 block truncate text-xs font-medium text-console-text-2">{q.label}</span>
                  <span className="block truncate text-[11px] text-console-text-3">
                    {q.known ? q.desc : 'Not reported by the stats endpoint'}
                  </span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-console-text-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            );
          })}
        </div>
        {!Number.isFinite(pendingVerifications) ? (
          <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-console-text-3">
            The stats endpoint does not report an open verification-request count, so it is shown as
            unavailable rather than as zero. Open the Verification workspace for the live queue.
          </p>
        ) : null}
      </section>

      {/* ------------------------ Platform totals ---------------------------- */}
      <section aria-label="Platform totals">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-console-text-3">Platform totals</h2>
        <div className="vc-panel grid grid-cols-2 divide-x divide-y divide-console-border sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
          {[
            { label: 'Content items', value: s.totalContent, icon: FileText },
            { label: 'Comments', value: s.totalComments, icon: Users },
            { label: 'Verified users', value: s.verifiedUsers, icon: ShieldCheck },
            { label: 'New today', value: s.newUsersToday, icon: UserPlus },
            { label: 'Gifts sent', value: s.totalGiftsSent, icon: Gift },
            { label: 'Suspended', value: s.suspendedUsers, icon: Crown },
          ].map((m) => {
            const Icon = m.icon;
            const known = m.value !== undefined && m.value !== null && Number.isFinite(Number(m.value));
            return (
              <div key={m.label} className="min-w-0 px-4 py-3.5">
                <div className="flex items-center gap-1.5 text-console-text-3">
                  <Icon size={12} className="shrink-0" aria-hidden />
                  <p className="truncate text-[11px] font-medium uppercase tracking-wider">{m.label}</p>
                </div>
                <p className="mt-1 truncate text-lg font-semibold tabular-nums text-console-text">
                  {known ? fmtCompact(m.value) : 'Unavailable'}
                </p>
                {known ? null : <p className="text-[10px] text-console-text-3">not reported</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------ Admin workspaces --------------------------- */}
      <section aria-label="Admin workspaces">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-console-text-3">Workspaces</h2>
        <nav className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_ACTIONS.map((qa) => {
            const Icon = qa.icon;
            return (
              <Link
                key={qa.href}
                href={qa.href}
                className="vc-focus vc-panel group flex flex-col gap-2.5 p-3.5 transition-colors hover:border-console-border-strong hover:bg-white/[0.02]"
              >
                <span className="grid h-9 w-9 place-items-center rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 text-console-text-3 transition-colors group-hover:text-console-gold">
                  <Icon size={16} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-console-text">{qa.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-console-text-3">{qa.desc}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </section>

      {/* ------------------------ Service health ----------------------------- */}
      {services.length > 0 ? (
        <section aria-label="Service health">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-console-text-3">Service health</h2>
            <Link href="/admin/infrastructure" className="vc-focus inline-flex items-center gap-1 rounded text-[11px] font-semibold text-console-gold hover:text-console-gold-hover">
              Diagnostics <ChevronRight size={12} aria-hidden />
            </Link>
          </div>
          <div className="vc-panel grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
            {services.slice(0, 10).map((svc: any) => (
              <div key={svc.name} className="flex min-w-0 items-center gap-2.5 py-1.5">
                <StatusBadge tone={statusToneFor(svc.status)} label={String(svc.status || 'unknown')} pulse={svc.status === 'degraded'} />
                <span className="min-w-0 truncate text-xs text-console-text-2" title={svc.name}>{svc.name}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <ConsoleEmptyState
          icon={<Server size={19} />}
          title="Service health unavailable"
          description="The infrastructure diagnostics endpoint did not return service data for this session, so live-stream and payment health cannot be confirmed from this page."
          action={
            <Link href="/admin/infrastructure" className="vc-focus inline-flex min-h-9 items-center rounded-[var(--vc-radius)] border border-console-border-strong px-4 text-xs font-semibold text-console-text-2 hover:bg-white/[0.04]">
              Open diagnostics
            </Link>
          }
        />
      )}

      {/* ------------------------- Recent signups ---------------------------- */}
      <ConsolePanel
        title="Recent signups"
        description="Newest accounts on the platform"
        bodyClassName="p-0"
        actions={
          <Link href="/admin/users" className="vc-focus inline-flex items-center gap-1 rounded text-xs font-semibold text-console-gold hover:text-console-gold-hover">
            View all <ChevronRight size={13} aria-hidden />
          </Link>
        }
      >
        {!Array.isArray(s.recentUsers) || s.recentUsers.length === 0 ? (
          <ConsoleEmptyState icon={<Users size={19} />} title="No recent signups" description="The stats payload did not include any recent accounts." />
        ) : (
          <ul className="divide-y divide-console-border">
            {s.recentUsers.slice(0, 6).map((u: any) => (
              <li key={u.id}>
                <Link href={`/admin/users?search=${encodeURIComponent(u.username || '')}`} className="vc-focus flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] sm:px-5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-console-border bg-console-bg2 text-[11px] font-semibold text-console-text-2">
                    {(u.username || '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-console-text">@{u.username}</span>
                    <span className="block truncate text-[11px] text-console-text-3">
                      {u.fullName ? `${u.fullName}, ` : ''}{timeAgo(u.createdAt)}
                    </span>
                  </span>
                  <StatusBadge tone={roleTone(u.role)} label={String(u.role || 'USER')} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>

      {/* ------------------------- Recent reports ---------------------------- */}
      <ConsolePanel
        title="Recent reports"
        description="Latest submitted moderation reports"
        bodyClassName="p-0"
        actions={
          <Link href="/admin/compliance" className="vc-focus inline-flex items-center gap-1 rounded text-xs font-semibold text-console-gold hover:text-console-gold-hover">
            Open queue <ChevronRight size={13} aria-hidden />
          </Link>
        }
      >
        {!Array.isArray(s.recentReports) || s.recentReports.length === 0 ? (
          <ConsoleEmptyState
            icon={<Flag size={19} />}
            title="No recent reports"
            description={pendingReports > 0 ? `${fmtNumber(pendingReports)} reports are pending. Open the moderation queue to review them.` : 'Nothing has been reported recently.'}
            action={pendingReports > 0 ? (
              <Link href="/admin/compliance" className="vc-focus inline-flex min-h-9 items-center rounded-[var(--vc-radius)] bg-console-gold px-4 text-xs font-semibold text-console-gold-fg hover:bg-console-gold-hover">
                Review reports
              </Link>
            ) : undefined}
          />
        ) : (
          <ul className="divide-y divide-console-border">
            {s.recentReports.slice(0, 6).map((r: any) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 text-console-warning">
                  <AlertTriangle size={14} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-console-text">{r.reason || r.category || 'Report'}</span>
                  <span className="block truncate text-[11px] text-console-text-3">{timeAgo(r.createdAt)}</span>
                </span>
                <StatusBadge tone={statusToneFor(r.status)} label={String(r.status || 'PENDING')} />
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>
    </div>
  );
}
