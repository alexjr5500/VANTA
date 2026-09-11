"use client";

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Coins, Shield, Filter, RefreshCcw, AlertCircle, RotateCcw, MoreHorizontal
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getCoinPaymentsDashboard, listCoinPurchases, refundCoinPurchase } from '@/lib/adminApi';
import type { CoinPaymentsDashboard, CoinPurchaseRecord } from '@/types/admin';

const fmt = (n: number) => {
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const statusConfig: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: 'bg-yellow-500/15 text-yellow-400' },
  PROCESSING: { label: 'Processing', color: 'bg-blue-500/15 text-blue-400' },
  PAID: { label: 'Paid', color: 'bg-sky-500/15 text-sky-400' },
  COMPLETED: { label: 'Completed', color: 'bg-green-500/15 text-green-400' },
  FAILED: { label: 'Failed', color: 'bg-red-500/15 text-red-400' },
  EXPIRED: { label: 'Expired', color: 'bg-orange-500/15 text-orange-400' },
  CANCELLED: { label: 'Cancelled', color: 'bg-gray-500/15 text-gray-400' },
  REFUNDED: { label: 'Refunded', color: 'bg-[#c8c8cc]/15 text-[#f2c75c]' },
};

export default function CoinPaymentsPage() {
  const [dashboard, setDashboard] = useState<CoinPaymentsDashboard | null>(null);
  const [purchases, setPurchases] = useState<CoinPurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<CoinPurchaseRecord | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundReason, setRefundReason] = useState('');

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const data = await getCoinPaymentsDashboard(token);
      setDashboard(data);
      const list = await listCoinPurchases(token, { limit: 100 });
      setPurchases(list.purchases);
    } catch (err: any) {
      setError(err?.message || 'Failed to load coin payments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return purchases;
    return purchases.filter(p => p.status === statusFilter);
  }, [statusFilter, purchases]);

  const stats = dashboard?.stats;

  const handleRefund = async (order: CoinPurchaseRecord) => {
    if (!window.confirm(`Refund purchase ${order.id.slice(-8)}? This returns ${order.coins.toLocaleString()} coins to the user's balance.`)) return;
    const reason = window.prompt('Refund reason (required for the audit record):');
    if (reason === null) return;
    if (!reason.trim()) { setError('A refund reason is required for the audit record.'); return; }
    setRefunding(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      await refundCoinPurchase(token, order.id, reason.trim());
      setRefundReason('');
      await fetchData();
      setSelected(null);
    } catch (err: any) {
      setError(err?.message || 'Refund failed.');
    } finally {
      setRefunding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Coins size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Finance</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Coin Payments</h1>
          <p className="text-sm text-gray-400 mt-1">VANTA Coin purchases, payment mode, and auditable refunds.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<RefreshCcw size={14} />} onClick={() => { setLoading(true); fetchData(); }}>Refresh</Button>
        </div>
      </div>

      {/* Payment mode banner */}
      {dashboard?.mode && (
        <div className={`flex items-start gap-3 rounded-2xl p-4 border ${dashboard.mode.isTestMode ? 'border-amber-500/30 bg-amber-500/10' : 'border-green-500/30 bg-green-500/10'}`}>
          <Shield size={16} className={dashboard.mode.isTestMode ? 'text-amber-400' : 'text-green-400'} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">
              Payment mode: {dashboard.mode.isTestMode ? 'TEST / SANDBOX' : 'LIVE'}
              {dashboard.mode.isTestMode ? ' â€” simulated purchases only, no real funds' : ' â€” real crypto payments'}
            </p>
            <p className="text-xs text-white/60 mt-1">
              Live deposit address configured: {dashboard.mode.liveAddressConfigured ? 'yes' : 'no'} Â· Live purchases available: {dashboard.mode.livePurchasesAvailable ? 'yes' : 'no'}
            </p>
            {dashboard.mode.errors.length > 0 && (
              <p className="text-xs text-red-400 mt-1">Configuration errors (server logs contain details): {dashboard.mode.errors.join(' ')}</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCcw size={24} className="animate-spin text-[#d6a83f]" />
        </div>
      )}

      {!loading && stats && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total Purchases', value: String(stats.totalPurchases), color: 'from-[#151517]0 to-[#68686c]' },
              { label: 'Successful', value: String(stats.successful), color: 'from-green-500 to-emerald-600' },
              { label: 'Pending', value: String(stats.pending), color: 'from-yellow-500 to-amber-600' },
              { label: 'Failed', value: String(stats.failed), color: 'from-red-500 to-rose-600' },
              { label: 'VANTA Coins Sold', value: stats.totalCoinsSold.toLocaleString(), color: 'from-[#151517]0 to-[#b78929]' },
              { label: 'Revenue (USD)', value: fmt(stats.totalRevenueUSD), color: 'from-emerald-500 to-green-600' },
            ].map((card, i) => (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass rounded-[20px] p-5 border border-white/[0.06]"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${card.color}`}>
                  <Coins size={18} className="text-white" />
                </div>
                <p className="text-2xl font-bold text-white mt-3">{card.value}</p>
                <p className="text-xs text-gray-400 mt-1">{card.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Filters */}
          <GlassCard>
            <div className="flex flex-wrap items-center gap-3">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="glass rounded-2xl px-3 py-1.5 text-sm text-white border border-white/[0.06] outline-none bg-transparent">
                <option value="all">All Statuses</option>
                {Object.keys(statusConfig).map(s => <option key={s} value={s}>{statusConfig[s].label}</option>)}
              </select>
              <Button variant="ghost" size="sm" icon={<Filter size={14} />}>Filter</Button>
            </div>
          </GlassCard>

          {/* Purchases Table */}
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Purchases ({filtered.length})</h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-white/[0.06]">
                    <th className="text-left py-3 px-2 font-medium">User</th>
                    <th className="text-left py-3 px-2 font-medium">Package</th>
                    <th className="text-right py-3 px-2 font-medium">Coins</th>
                    <th className="text-right py-3 px-2 font-medium">Amount</th>
                    <th className="text-center py-3 px-2 font-medium">Mode</th>
                    <th className="text-center py-3 px-2 font-medium">Status</th>
                    <th className="text-right py-3 px-2 font-medium">Created</th>
                    <th className="text-center py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <motion.tr
                      key={p.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => setSelected(selected?.id === p.id ? null : p)}
                    >
                      <td className="py-3 px-2 text-white font-medium">{p.user?.username || p.userId}</td>
                      <td className="py-3 px-2 text-gray-400 text-xs max-w-[140px] truncate">{p.packageName || p.packageId || 'â€”'}</td>
                      <td className="py-3 px-2 text-right text-white font-bold">{p.coins.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right text-white font-bold">${p.amount.toFixed(2)}</td>
                      <td className="py-3 px-2 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${p.paymentMode === 'test' ? 'bg-amber-500/15 text-amber-400' : 'bg-green-500/15 text-green-400'}`}>
                          {p.paymentMode === 'test' ? 'TEST' : 'LIVE'}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusConfig[p.status]?.color || ''}`}>
                          {statusConfig[p.status]?.label || p.status}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right text-gray-400 text-xs">{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td className="py-3 px-2 text-center">
                        <button className="p-1 rounded-lg hover:bg-white/10 transition-colors">
                          <MoreHorizontal size={14} className="text-gray-500" />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-500 text-sm">No purchases found.</div>
            )}

            {/* Detail + refund */}
            {selected && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-4 p-4 glass rounded-2xl border border-[#151517]0/20"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Order ID</p>
                    <p className="text-sm text-white font-mono mt-1">{selected.id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Provider Reference</p>
                    <p className="text-sm text-white font-mono mt-1 break-all">{selected.providerReference || selected.providerOrderId || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Payment Method</p>
                    <p className="text-sm text-white mt-1 capitalize">{selected.paymentMethod || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Confirmed At</p>
                    <p className="text-sm text-white mt-1">{selected.confirmedAt ? new Date(selected.confirmedAt).toLocaleString() : 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Amount</p>
                    <p className="text-sm text-white mt-1">{fmt(selected.amount)} {selected.currency}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Coins</p>
                    <p className="text-sm text-white mt-1">{selected.coins.toLocaleString()} VANTA Coins</p>
                  </div>
                </div>

                {selected.status === 'COMPLETED' && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06]">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Refund</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Refund reason (required for audit)"
                        value={refundReason}
                        onChange={e => setRefundReason(e.target.value)}
                        className="bg-white/5 border border-white/[0.06] rounded-xl px-3 py-1.5 text-sm text-white placeholder-gray-500 flex-1 min-w-0 outline-none"
                      />
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<RotateCcw size={14} />}
                        disabled={refunding || !refundReason.trim()}
                        onClick={() => handleRefund(selected)}
                      >
                        {refunding ? 'Refundingâ€¦' : 'Refund'}
                      </Button>
                    </div>
                    <p className="text-[10px] text-white/40 mt-1">
                      Refunds are audited: a REFUND ledger entry is created and the original purchase stays immutable. The user's spendable balance must cover the refund amount.
                    </p>
                  </div>
                )}
                {selected.status === 'REFUNDED' && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06]">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Refund Record</p>
                    <p className="text-xs text-white/70">
                      Refunded {selected.refundedAt ? new Date(selected.refundedAt).toLocaleString() : 'N/A'} by {selected.refundedBy || 'unknown'}.
                      {selected.refundReason ? ` Reason: ${selected.refundReason}` : ''}
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
