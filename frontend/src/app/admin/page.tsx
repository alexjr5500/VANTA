'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { getDashboardStats, getInfrastructure } from '@/lib/adminApi';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  Users, UserPlus, ShieldCheck, Radio, Flag,
  FileText, DollarSign, RefreshCw, ArrowUpRight,
  Clock, AlertTriangle, ChevronRight, BarChart3, Wallet,
  Gift, Server, BadgeCheck, Crown, Activity,
} from 'lucide-react';

// ============================================================================
// Helpers — presentation only, every number comes from the real admin API.
// ============================================================================

const fmt = (n: number): string => {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString('en-US');
};

const fmtCurrency = (n: number): string => {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(2) + 'K';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-500/15 text-emerald-400',
    SUSPENDED: 'bg-yellow-500/15 text-yellow-400',
    BANNED: 'bg-red-500/15 text-red-400',
    DEACTIVATED: 'bg-gray-500/15 text-gray-400',
  };
  return map[status] || 'bg-gray-500/15 text-gray-400';
};

// ============================================================================
// KPI Card — premium glass card with an icon tile + contextual hint
// ============================================================================

interface Kpi {
  label: string;
  value: string;
  icon: any;
  tile: string;
  hint?: string;
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.03]">
      <div className="mb-3">
        <div className={cn('grid h-10 w-10 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105', kpi.tile)}>
          <Icon size={17} className="text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight text-white tabular-nums">{kpi.value}</p>
      <p className="mt-1 text-[11px] text-white/40">{kpi.label}</p>
      {kpi.hint && <p className="mt-0.5 text-[10px] text-white/25">{kpi.hint}</p>}
    </div>
  );
}
// ============================================================================
// Growth chart (real users-per-bucket)
// ============================================================================

function GrowthChart({ data }: { data: { label: string; count: number }[] }) {
  const W = 760;
  const H = 220;
  const pad = 28;
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = Math.max(2, (W - pad * 2) / Math.max(1, data.length) - 3);
  const showEvery = Math.max(1, Math.ceil(data.length / 14));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" role="img" aria-label="User growth chart">
        <defs>
          <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c9a227" />
            <stop offset="100%" stopColor="#7a5c12" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={pad} x2={W - pad} y1={H - pad - (H - pad * 2) * t} y2={H - pad - (H - pad * 2) * t} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}
        {data.map((d, i) => {
          const h = Math.max(2, ((H - pad * 2) * d.count) / max);
          const x = pad + i * ((W - pad * 2) / data.length) + 1.5;
          const y = H - pad - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={h} rx={2} fill={d.count > 0 ? 'url(#growthGrad)' : 'rgba(255,255,255,0.1)'}>
                <title>{`${d.label}: ${d.count.toLocaleString()}`}</title>
              </rect>
              {i % showEvery === 0 && (
                <text x={x} y={H - pad + 14} fontSize={9} fill="#666" textAnchor="middle">
                  {d.label.length > 7 ? d.label.slice(5) : d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================================
// Meter row — scales a real metric against its group maximum
// ============================================================================

function MeterRow({ label, value, max, color, format }: { label: string; value: number; max: number; color: string; format: (n: number) => string }) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/50">{label}</span>
        <span className="text-xs font-semibold text-white tabular-nums">{format(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ============================================================================
// Loading skeleton
// ============================================================================

function Skeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="h-10 w-10 rounded-xl bg-white/[0.06] animate-pulse mb-3" />
          <div className="h-7 w-16 rounded bg-white/[0.06] animate-pulse mb-2" />
          <div className="h-3 w-24 rounded bg-white/[0.05] animate-pulse" />
        </div>
      ))}
    </div>
  );
}
export default function AdminPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [infra, setInfra] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [growthKey, setGrowthKey] = useState<'7d' | '30d' | '90d' | '12m'>('30d');

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
      setError(err?.message || 'Failed to load dashboard. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const growth = stats?.userGrowth?.[growthKey] ?? [];
  const s = stats || {};

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <div className="h-7 w-44 rounded-lg bg-white/[0.06] animate-pulse" />
          <div className="h-4 w-72 rounded bg-white/[0.05] animate-pulse" />
        </div>
        <Skeleton />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-64 rounded-2xl border border-white/[0.06] bg-white/[0.02] animate-pulse" />
          <div className="h-64 rounded-2xl border border-white/[0.06] bg-white/[0.02] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-10 text-center">
          <AlertTriangle size={40} className="mx-auto mb-3 text-red-400" />
          <h3 className="text-base font-bold text-white">Dashboard failed to load</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-white/40">{error}</p>
          <Button variant="primary" size="sm" className="mt-5" icon={<RefreshCw size={14} />} onClick={() => void fetchData()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
const growthLabel = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '12m': 'Last 12 months' };

  const monetizationMax = Math.max(1, s.revenue || 0, s.totalGiftVolume || 0, s.badgePurchases || 0, s.coinPurchases || 0);

  const quickActions = [
    { href: '/admin/users', label: 'Manage Users', desc: 'Roles, bans & verification', icon: Users, tile: 'bg-sky-500/15 text-sky-300' },
    { href: '/admin/compliance', label: 'Review Reports', desc: 'Moderation queue', icon: Flag, tile: 'bg-red-500/15 text-red-300' },
    { href: '/admin/finance', label: 'View Transactions', desc: 'Wallet ledger', icon: Wallet, tile: 'bg-emerald-500/15 text-emerald-300' },
    { href: '/admin/verification', label: 'Manage Verification', desc: 'Badges & purchases', icon: BadgeCheck, tile: 'bg-[#c9a227]/15 text-[#d9a83f]' },
    { href: '/admin/gifts', label: 'Manage Gifts', desc: 'Catalog & pricing', icon: Gift, tile: 'bg-violet-500/15 text-violet-300' },
    { href: '/admin/infrastructure', label: 'System Health', desc: 'Services & diagnostics', icon: Server, tile: 'bg-cyan-500/15 text-cyan-300' },
  ];

  const services = infra?.services ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <BarChart3 size={14} className="text-[#c9a227]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-semibold">VANTA Platform</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-white/40">Live platform overview — all figures are computed from the production database.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/40">
            <Clock size={12} /> {new Date().toLocaleString()}
          </span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} loading={refreshing} onClick={() => void fetchData()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard kpi={{ label: 'Total Users', value: fmt(s.totalUsers || 0), icon: Users, tile: 'bg-[#c9a227]/15 text-[#d9a83f]', hint: `${fmt(s.newUsersThisMonth || 0)} joined this month` }} />
        <KpiCard kpi={{ label: 'Active Today', value: fmt(s.activeUsersToday || 0), icon: Activity, tile: 'bg-emerald-500/15 text-emerald-400', hint: `${fmt(s.activeUsersThisWeek || 0)} this week · ${fmt(s.onlineUsers || 0)} online now` }} />
        <KpiCard kpi={{ label: 'Revenue', value: fmtCurrency(s.revenue || 0), icon: DollarSign, tile: 'bg-emerald-500/15 text-emerald-400', hint: 'Completed purchase orders' }} />
        <KpiCard kpi={{ label: 'Active Streams', value: fmt(s.activeStreams || 0), icon: Radio, tile: 'bg-red-500/15 text-red-300', hint: `${fmt(s.totalStreams || 0)} all-time streams` }} />
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard kpi={{ label: 'New Users Today', value: fmt(s.newUsersToday || 0), icon: UserPlus, tile: 'bg-sky-500/15 text-sky-400', hint: `${fmt(s.newUsersThisYear || 0)} this year` }} />
        <KpiCard kpi={{ label: 'Verified Users', value: fmt(s.verifiedUsers || 0), icon: ShieldCheck, tile: 'bg-sky-500/15 text-sky-400', hint: 'Legacy flag + active badges' }} />
        <KpiCard kpi={{ label: 'Transactions', value: fmt(s.totalTransactions || 0), icon: ArrowUpRight, tile: 'bg-white/[0.06] text-white/70', hint: `Coins bought: ${fmt(s.coinPurchases || 0)}` }} />
        <KpiCard kpi={{ label: 'Badge Purchases', value: fmt(s.badgePurchases || 0), icon: Crown, tile: 'bg-amber-500/15 text-amber-300', hint: `${fmt(s.pendingWithdrawals || 0)} pending withdrawals` }} />
      </div>
{/* Growth + Monetization */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* User growth */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">User Growth</h3>
              <p className="mt-0.5 text-[11px] text-white/40">New users joined · {growthLabel[growthKey]} · {fmt(s.newUsersThisMonth || 0)} this month</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] p-1">
              {(['7d', '30d', '90d', '12m'] as const).map((k) => (
                <button key={k} onClick={() => setGrowthKey(k)} className={cn('px-3 py-1.5 text-[11px] font-medium rounded-full transition-colors', growthKey === k ? 'bg-[#c9a227] text-black' : 'text-white/40 hover:text-white')}>
                  {k === '12m' ? '12 mo' : k}
                </button>
              ))}
            </div>
          </div>
          {growth.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <BarChart3 size={36} className="mb-3 text-white/10" />
              <p className="text-sm text-white/40">No new-user data available for this period.</p>
            </div>
          ) : (
            <GrowthChart data={growth.map((g: any) => ({ label: g.date || g.month, count: g.count }))} />
          )}
        </div>

        {/* Revenue & economy */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-1 text-sm font-bold text-white">Economy</h3>
          <p className="mb-4 text-[11px] text-white/40">Real monetization activity across the platform</p>
          <div className="space-y-4">
            <MeterRow label="Purchase revenue" value={s.revenue || 0} max={monetizationMax} color="bg-emerald-400" format={fmtCurrency} />
            <MeterRow label="Gift volume (coins)" value={s.totalGiftVolume || 0} max={monetizationMax} color="bg-[#c9a227]" format={fmt} />
            <MeterRow label="Coin purchases" value={s.coinPurchases || 0} max={monetizationMax} color="bg-sky-400" format={fmt} />
            <MeterRow label="Badge purchases" value={s.badgePurchases || 0} max={monetizationMax} color="bg-violet-400" format={fmt} />
            <MeterRow label="Coins in circulation" value={s.totalCoinsInCirculation || 0} max={Math.max(1, s.totalCoinsInCirculation || 0)} color="bg-amber-400" format={fmt} />
          </div>
          <Link href="/admin/finance" className="mt-5 inline-flex items-center gap-1 text-[11px] font-medium text-[#c9a227]">
            Open payments ledger <ChevronRight size={12} />
          </Link>
        </div>
      </div>

      {/* Content + engagement */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2 text-white/40"><FileText size={14} /></div>
          <p className="text-xl font-bold text-white tabular-nums">{fmt(s.totalContent || 0)}</p>
          <p className="mt-0.5 text-[11px] text-white/40">Total content items</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2 text-white/40"><Users size={14} /></div>
          <p className="text-xl font-bold text-white tabular-nums">{fmt(s.totalComments || 0)}</p>
          <p className="mt-0.5 text-[11px] text-white/40">Comments</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2 text-white/40"><Gift size={14} /></div>
          <p className="text-xl font-bold text-white tabular-nums">{fmt(s.totalStreams || 0)}</p>
          <p className="mt-0.5 text-[11px] text-white/40">All-time streams</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2 text-white/40"><Crown size={14} /></div>
          <p className="text-xl font-bold text-white tabular-nums">{fmt(s.pendingReports || 0)}</p>
          <p className="mt-0.5 text-[11px] text-white/40">Pending reports</p>
        </div>
      </div>
{/* Quick actions */}
      <section>
        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/30">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
          {quickActions.map((qa) => {
            const Icon = qa.icon;
            return (
              <Link
                key={qa.href}
                href={qa.href}
                className="group flex flex-col gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 transition-all hover:border-white/[0.14] hover:bg-white/[0.04]"
              >
                <span className={cn('grid h-9 w-9 place-items-center rounded-xl transition-transform group-hover:scale-105', qa.tile)}>
                  <Icon size={16} />
                </span>
                <span>
                  <span className="block truncate text-xs font-semibold text-white">{qa.label}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-white/35">{qa.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* System status (real infrastructure data — never fabricated) */}
      {services && Array.isArray(services) && services.length > 0 && (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white"><Server size={15} className="text-white/40" /> System Status</h3>
            <Link href="/admin/infrastructure" className="flex items-center gap-1 text-[11px] text-[#c9a227]">Details <ChevronRight size={12} /></Link>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {services.slice(0, 10).map((svc: any) => (
              <div key={svc.name} className="flex items-center gap-2.5 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                <span className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  svc.status === 'healthy' ? 'bg-emerald-400' : svc.status === 'degraded' ? 'bg-amber-400' : 'bg-red-400',
                )} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-white/80">{svc.name}</span>
                  <span className="block text-[10px] text-white/35 capitalize">{svc.status || 'unknown'}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {s.recentUsers?.length ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Recent Signups</h3>
              <Link href="/admin/users" className="flex items-center gap-1 text-[11px] text-[#c9a227]">View all<ChevronRight size={12} /></Link>
            </div>
            <ul className="space-y-2">
              {s.recentUsers.slice(0, 6).map((u: any) => (
                <li key={u.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                  <div className="grid h-8 w-8 place-items-center shrink-0 rounded-full bg-white/10 text-[11px] font-bold text-white">
                    {(u.username || '?')[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-white">@{u.username}{u.fullName ? ` · ${u.fullName}` : ''}</p>
                    <p className="text-[10px] text-white/35">{timeAgo(u.createdAt)}</p>
                  </div>
                  <span className={cn('text-[9px] px-2 py-0.5 rounded-full', statusBadge(u.status || 'ACTIVE'))}>{u.status || 'ACTIVE'}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {s.recentReports?.length ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Recent Reports</h3>
              <Link href="/admin/compliance" className="flex items-center gap-1 text-[11px] text-[#c9a227]">Review<ChevronRight size={12} /></Link>
            </div>
            <ul className="space-y-2">
              {s.recentReports.slice(0, 6).map((r: any) => (
                <li key={r.id} className="flex items-start gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-400"><Flag size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-white">{r.reason || 'Report'}</p>
                    <p className="truncate text-[10px] text-white/35">@{r.reporter?.username || 'unknown'} → @{r.target?.username || 'unknown'} · {timeAgo(r.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!s.recentUsers?.length && !s.recentReports?.length && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-center lg:col-span-2">
            <p className="text-sm text-white/40">No recent activity yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}