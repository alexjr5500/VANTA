'use client';

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  DollarSign, Wallet, Search, ChevronLeft, ChevronRight,
  RefreshCw, Clock, AlertTriangle, ArrowDownRight, ArrowUpRight, RotateCcw,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getTransactions } from '@/lib/adminApi';

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const typeConfig: Record<string, { label: string; color: string }> = {
  DEPOSIT: { label: 'Deposit', color: 'bg-emerald-500/15 text-emerald-300' },
  TRANSFER_SENT: { label: 'Transfer Sent', color: 'bg-yellow-500/15 text-yellow-300' },
  TRANSFER_RECEIVED: { label: 'Transfer Received', color: 'bg-sky-500/15 text-sky-300' },
  GIFT_SENT: { label: 'Gift Sent', color: 'bg-[#d9a83f]/15 text-[#d9a83f]' },
  GIFT_RECEIVED: { label: 'Gift Received', color: 'bg-[#d9a83f]/15 text-[#d9a83f]' },
  WITHDRAWAL: { label: 'Withdrawal', color: 'bg-red-500/15 text-red-300' },
  REFUND: { label: 'Refund', color: 'bg-orange-500/15 text-orange-300' },
  FEE: { label: 'Fee', color: 'bg-gray-500/15 text-gray-300' },
  ADMIN_CREDIT: { label: 'Admin Credit', color: 'bg-emerald-500/15 text-emerald-300' },
  ADMIN_DEBIT: { label: 'Admin Debit', color: 'bg-red-500/15 text-red-300' },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: 'bg-yellow-500/15 text-yellow-400' },
  COMPLETED: { label: 'Completed', color: 'bg-green-500/15 text-green-400' },
  FAILED: { label: 'Failed', color: 'bg-red-500/15 text-red-400' },
  REVERSED: { label: 'Reversed', color: 'bg-orange-500/15 text-orange-400' },
};

export default function FinancePage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('vanta_token') || localStorage.getItem('token');
      if (!token) return;
      const result = await getTransactions(token, {
        page,
        limit: 50,
        status: statusFilter === 'all' ? undefined : statusFilter,
        type: typeFilter === 'all' ? undefined : typeFilter,
        search: search || undefined,
      });
      setTransactions(result.transactions || []);
      setSummary(result.summary || null);
      setTotal(result.total || 0);
      setPages(Math.max(1, Math.ceil((result.total || 0) / 50)));
    } catch (err: any) {
      setError(err?.message || 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter, search]);

  useEffect(() => { void fetchData(); }, [fetchData]);
const moneyIcon = (type: string) => {
  if (type === 'WITHDRAWAL' || type === 'ADMIN_DEBIT') return <ArrowUpRight size={12} className="text-red-400" />;
  if (type === 'REFUND') return <RotateCcw size={12} className="text-orange-400" />;
  return <ArrowDownRight size={12} className="text-emerald-400" />;
};

return (
  <div className="space-y-6">
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Wallet size={14} className="text-[#d9a83f]" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Finance</span>
        </div>
        <h1 className="text-2xl font-bold text-white">Finance</h1>
        <p className="text-sm text-gray-400 mt-1">Real wallet ledger — every row is a database transaction.</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500 bg-white/5 px-3 py-1.5 rounded-full">
          <Clock size={12} /> {total.toLocaleString()} records
        </span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => void fetchData()}>Refresh</Button>
      </div>
    </div>

    {/* Summary */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <SummaryCard label="Total Processed" value={fmt(summary?.totalProcessed ?? 0)} icon={<DollarSign size={16} />} cls="bg-emerald-500/15 text-emerald-400" />
      <SummaryCard label="Pending Review" value={fmt(summary?.pendingReview ?? 0)} icon={<Clock size={16} />} cls="bg-yellow-500/15 text-yellow-400" />
      <SummaryCard label="Refunds / Reversals" value={fmt(summary?.refunds ?? 0)} icon={<RotateCcw size={16} />} cls="bg-orange-500/15 text-orange-400" />
      <SummaryCard label="Purchase Revenue" value={fmt(summary?.totalPurchaseRevenue ?? 0)} icon={<ArrowDownRight size={16} />} cls="bg-sky-500/15 text-sky-400" />
    </div>

    {/* Filters */}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/[0.06]">
        <Search size={14} className="text-gray-500 shrink-0" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, description, reference..." className="w-full bg-transparent border-none outline-none text-sm text-white placeholder-gray-500" />
      </div>
      <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="glass rounded-xl px-3 py-2 text-sm text-white border border-white/[0.06] outline-none">
        <option value="all">All statuses</option>
        <option value="PENDING">Pending</option>
        <option value="COMPLETED">Completed</option>
        <option value="FAILED">Failed</option>
        <option value="REVERSED">Reversed</option>
      </select>
      <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="glass rounded-xl px-3 py-2 text-sm text-white border border-white/[0.06] outline-none">
        <option value="all">All types</option>
        {Object.keys(typeConfig).map((t) => <option key={t} value={t}>{typeConfig[t].label}</option>)}
      </select>
    </div>
{/* Table */}
    <GlassCard>
      {loading ? (
        <div className="space-y-2 p-2">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 rounded-xl bg-white/5 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="py-10 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
          <p className="text-sm text-gray-400">{error}</p>
          <Button variant="primary" size="sm" className="mt-3" onClick={() => void fetchData()}>Retry</Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-white/[0.06]">
                <th className="text-left py-3 px-2 font-medium">Date</th>
                <th className="text-left py-3 px-2 font-medium">User</th>
                <th className="text-left py-3 px-2 font-medium">Type</th>
                <th className="text-left py-3 px-2 font-medium">Description</th>
                <th className="text-center py-3 px-2 font-medium">Status</th>
                <th className="text-right py-3 px-2 font-medium">Amount</th>
                <th className="text-right py-3 px-2 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center">
                  <Wallet size={34} className="mx-auto mb-3 text-white/15" />
                  <p className="text-sm text-white/50">No transactions match these filters.</p>
                </td></tr>
              ) : (
                transactions.map((tx: any) => (
                  <tr key={tx.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-2 text-gray-400 text-xs whitespace-nowrap">{new Date(tx.createdAt).toLocaleString()}</td>
                    <td className="py-3 px-2 text-white text-xs">@{tx.userName}</td>
                    <td className="py-3 px-2">
                      <span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full', typeConfig[tx.type]?.color || 'bg-gray-500/15 text-gray-300')}>
                        {moneyIcon(tx.type)}{typeConfig[tx.type]?.label || tx.type}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-gray-400 text-xs max-w-[220px] truncate">{tx.description || '—'}</td>
                    <td className="py-3 px-2 text-center">
                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full', statusConfig[tx.status]?.color || 'bg-gray-500/15 text-gray-300')}>
                        {statusConfig[tx.status]?.label || tx.status}
                      </span>
                    </td>
                    <td className={cn('py-3 px-2 text-right text-xs font-medium tabular-nums', tx.amount < 0 ? 'text-red-400' : 'text-emerald-400')}>
                      {tx.amount < 0 ? '-' : '+'}{fmt(Math.abs(tx.amount))}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-400 text-xs tabular-nums">{fmt(tx.balance ?? 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>

    {/* Pagination */}
    {pages > 1 && !loading && !error && (
      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="sm" disabled={page <= 1} icon={<ChevronLeft size={14} />} onClick={() => setPage(page - 1)}>Prev</Button>
        <span className="text-xs text-gray-400 px-2">{page} / {pages}</span>
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next<ChevronRight size={14} /></Button>
      </div>
    )}
  </div>
);
}

function SummaryCard({ label, value, icon, cls }: { label: string; value: string; icon: any; cls: string }) {
  return (
    <div className="glass rounded-2xl border border-white/[0.06] p-4">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-2', cls)}>{icon}</div>
      <p className="text-xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}