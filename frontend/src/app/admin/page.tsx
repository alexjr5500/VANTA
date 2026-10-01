'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { getDashboardStats } from '@/lib/adminApi';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  Users, UserPlus, Activity, ShieldCheck, UserX, Ban,
  Flag, FileText, DollarSign, RefreshCw, ArrowUpRight,
  ArrowDownRight, Clock, AlertTriangle, ChevronRight,
  BarChart3, Radio,
} from 'lucide-react';

// ============================================================================
// Helpers
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
// KPI Card
// ============================================================================

interface Kpi {
  label: string;
  value: string;
  delta?: { text: string; positive: boolean };
  icon: any;
  color: string;
  hint?: string;
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  return (
    <div className="glass rounded-2xl border border-white/[0.06] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', kpi.color)}>
          <Icon size={16} className="text-white" />
        </div>
        {kpi.delta && (
          <span className={cn('flex items-center gap-0.5 text-[10px] font-medium', kpi.delta.positive ? 'text-emerald-400' : 'text-red-400')}>
            {kpi.delta.positive ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {kpi.delta.text}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white tabular-nums">{kpi.value}</p>
      <p className="text-[11px] text-white/40 mt-1">{kpi.label}</p>
      {kpi.hint && <p className="text-[10px] text-white/25 mt-0.5">{kpi.hint}</p>}
    </div>
  );
}

// ============================================================================
// Simple SVG bar chart driven by real data
// ============================================================================

function GrowthChart({ data }: { data: { label: string; count: number }[] }) {
  const W = 720;
  const H = 220;
  const pad = 28;
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = Math.max(2, (W - pad * 2) / Math.max(1, data.length) - 3);
  const showEvery = Math.max(1, Math.ceil(data.length / 14));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-52" role="img" aria-label="User growth chart">
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={pad} x2={W - pad} y1={H - pad - (H - pad * 2) * t} y2={H - pad - (H - pad * 2) * t} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}
        {data.map((d, i) => {
          const h = Math.max(2, ((H - pad * 2) * d.count) / max);
          const x = pad + i * ((W - pad * 2) / data.length) + 1.5;
          const y = H - pad - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={h} rx={2} fill={d.count > 0 ? '#d9a83f' : 'rgba(255,255,255,0.12)'}>
                <title>{`${d.label}: ${d.count.toLocaleString()}`}</title>
              </rect>
              {i % showEvery === 0 && (
                <text x={x} y={H - pad + 14} fontSize={9} fill="#777" textAnchor="middle">
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
// Loading skeleton
// ============================================================================

function Skeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="glass rounded-2xl p-4 border border-white/[0.06]">
          <div className="h-3 w-24 rounded bg-white/10 animate-pulse mb-3" />
          <div className="h-8 w-14 rounded bg-white/10 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
export default function AdminPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<any>(null);
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
      const data = await getDashboardStats(token);
      setStats(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load dashboard. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const growth = stats?.userGrowth?.[growthKey] ?? [];

  if (loading && !stats) {
    return (
      <div className="space-y-5">
        <div className="glass rounded-2xl p-5 border border-white/[0.06]">
          <div className="h-4 w-40 rounded bg-white/10 animate-pulse" />
          <div className="h-3 w-64 rounded bg-white/10 animate-pulse mt-3" />
        </div>
        <Skeleton />
        <div className="glass rounded-2xl h-56 border border-white/[0.06] animate-pulse" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="space-y-5">
        <div className="glass rounded-2xl p-10 text-center border border-red-500/20 bg-red-500/5">
          <AlertTriangle size={40} className="mx-auto mb-3 text-red-400" />
          <h3 className="text-base font-bold text-white">Dashboard failed to load</h3>
          <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">{error}</p>
          <Button variant="primary" size="sm" className="mt-5" icon={<RefreshCw size={14} />} onClick={() => void fetchData()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const s = stats || {};
  const growthLabel = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '12m': 'Last 12 months' };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 size={14} className="text-[#d9a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Admin</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">Live platform overview — all figures come from real data.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500 bg-white/5 px-3 py-1.5 rounded-full">
            <Clock size={12} /> {new Date().toLocaleString()}
          </span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} loading={refreshing} onClick={() => void fetchData()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Row 1 — Platform overview */}
      <div>
        <h3 className="text-sm font-bold text-white mb-3">Platform Overview</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard kpi={{ label: 'Total Users', value: fmt(s.totalUsers || 0), icon: Users, color: 'bg-[#d9a83f]/15 text-[#d9a83f]' }} />
          <KpiCard kpi={{ label: 'Active Users (today)', value: fmt(s.activeUsersToday || 0), icon: Activity, color: 'bg-emerald-500/15 text-emerald-400', hint: `${fmt(s.activeUsersThisWeek || 0)} this week · ${fmt(s.activeUsersThisMonth || 0)} this month` }} />
          <KpiCard kpi={{ label: 'New Users Today', value: fmt(s.newUsersToday || 0), icon: UserPlus, color: 'bg-sky-500/15 text-sky-400' }} />
          <KpiCard kpi={{ label: 'New Users This Month', value: fmt(s.newUsersThisMonth || 0), icon: ArrowUpRight, color: 'bg-violet-500/15 text-violet-400' }} />
        </div>
      </div>

      {/* Row 2 — Platform health */}
      <div>
        <h3 className="text-sm font-bold text-white mb-3">Platform Health</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard kpi={{ label: 'Verified Users', value: fmt(s.verifiedUsers || 0), icon: ShieldCheck, color: 'bg-sky-500/15 text-sky-400' }} />
          <KpiCard kpi={{ label: 'Suspended Users', value: fmt(s.suspendedUsers || 0), icon: UserX, color: 'bg-yellow-500/15 text-yellow-400' }} />
          <KpiCard kpi={{ label: 'Banned Users', value: fmt(s.bannedUsers || 0), icon: Ban, color: 'bg-red-500/15 text-red-400' }} />
          <KpiCard kpi={{ label: 'Pending Reports', value: fmt(s.pendingReports || 0), icon: Flag, color: 'bg-red-500/15 text-red-400' }} />
          <KpiCard kpi={{ label: 'Total Content', value: fmt(s.totalContent || 0), icon: FileText, color: 'bg-[#c8c8cc]/15 text-[#c8c8cc]' }} />
          <KpiCard kpi={{ label: 'Active Streams', value: fmt(s.activeStreams || 0), icon: Radio, color: 'bg-red-500/15 text-red-300' }} />
          <KpiCard kpi={{ label: 'Transactions', value: fmt(s.totalTransactions || 0), icon: ArrowUpRight, color: 'bg-[#c8c8cc]/15 text-[#c8c8cc]' }} />
          <KpiCard kpi={{ label: 'Revenue (completed)', value: fmtCurrency(s.revenue || 0), icon: DollarSign, color: 'bg-emerald-500/15 text-emerald-400' }} />
        </div>
      </div>
{/* User growth */}
      <div className="glass rounded-2xl border border-white/[0.06] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-bold text-white">User Growth</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">New users joined · {growthLabel[growthKey]} · {fmt(s.newUsersThisMonth || 0)} joined this month</p>
          </div>
          <div className="flex items-center gap-1.5 bg-white/5 rounded-full p-1">
            {(['7d', '30d', '90d', '12m'] as const).map((k) => (
              <button key={k} onClick={() => setGrowthKey(k)} className={cn('px-3 py-1.5 text-[11px] font-medium rounded-full transition-colors', growthKey === k ? 'bg-[#d9a83f]/20 text-[#d9a83f]' : 'text-gray-400 hover:text-white')}>
                {k === '12m' ? '12 mo' : k}
              </button>
            ))}
          </div>
        </div>
        {growth.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 size={36} className="text-white/10 mb-3" />
            <p className="text-sm text-white/50">No new-user data available for this period.</p>
          </div>
        ) : (
          <GrowthChart data={growth.map((g: any) => ({ label: g.date || g.month, count: g.count }))} />
        )}
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {s.recentUsers?.length ? (
          <div className="glass rounded-2xl border border-white/[0.06] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">Recent Signups</h3>
              <Link href="/admin/users" className="flex items-center gap-1 text-[11px] text-[#d9a83f]">View all<ChevronRight size={12} /></Link>
            </div>
            <ul className="space-y-2">
              {s.recentUsers.slice(0, 6).map((u: any) => (
                <li key={u.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-white shrink-0">
                    {(u.username || '?')[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white truncate">@{u.username}{u.fullName ? ` · ${u.fullName}` : ''}</p>
                    <p className="text-[10px] text-gray-500">{timeAgo(u.createdAt)}</p>
                  </div>
                  <span className={cn('text-[9px] px-2 py-0.5 rounded-full', statusBadge(u.status || 'ACTIVE'))}>{u.status || 'ACTIVE'}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {s.recentReports?.length ? (
          <div className="glass rounded-2xl border border-white/[0.06] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">Recent Reports</h3>
              <Link href="/admin/content" className="flex items-center gap-1 text-[11px] text-[#d9a83f]">Review<ChevronRight size={12} /></Link>
            </div>
            <ul className="space-y-2">
              {s.recentReports.slice(0, 6).map((r: any) => (
                <li key={r.id} className="flex items-start gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-red-500/10 text-red-400"><Flag size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white truncate">{r.reason || 'Report'}</p>
                    <p className="text-[10px] text-gray-500 truncate">@{r.reporter?.username || 'unknown'} → @{r.target?.username || 'unknown'} · {timeAgo(r.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}