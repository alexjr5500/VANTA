"use client";

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign, TrendingUp, Wallet, ShoppingCart, Search, Filter,
  Download, FileSpreadsheet, FileText, Shield, ChevronDown,
  ArrowUpRight, ArrowDownRight, Clock, CheckCircle, XCircle,
  RotateCcw, Calendar, Eye, MoreHorizontal
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getTransactions } from '@/lib/adminApi';
import type { FinancialTransaction } from '@/types/admin';

const fmt = (n: number) => {
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const typeConfig: Record<string, { label: string; color: string }> = {
  coin_purchase: { label: 'Coin Purchase', color: 'bg-yellow-500/15 text-yellow-300' },
  gift_sent: { label: 'Gift Sent', color: 'bg-[#151517]0/15 text-[#f2c75c]' },
  subscription: { label: 'Subscription', color: 'bg-[#c8c8cc]/15 text-[#c8c8cc]' },
  withdrawal: { label: 'Withdrawal', color: 'bg-red-500/15 text-red-300' },
  refund: { label: 'Refund', color: 'bg-orange-500/15 text-orange-300' },
  creator_earnings: { label: 'Creator Earnings', color: 'bg-green-500/15 text-green-300' },
  ad_revenue: { label: 'Ad Revenue', color: 'bg-[#c8c8cc]/15 text-[#c8c8cc]' },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-500/15 text-yellow-400' },
  completed: { label: 'Completed', color: 'bg-green-500/15 text-green-400' },
  failed: { label: 'Failed', color: 'bg-red-500/15 text-red-400' },
  refunded: { label: 'Refunded', color: 'bg-orange-500/15 text-orange-400' },
};

export default function FinancePage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedTx, setSelectedTx] = useState<FinancialTransaction | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const data = await getTransactions(token);
        setTransactions(data);
      } catch (err) {
        console.error('Failed to fetch transactions:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      if (search && !tx.userName.toLowerCase().includes(search.toLowerCase()) && !tx.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [search, typeFilter, statusFilter, transactions]);

  const summary = useMemo(() => {
    const total = transactions.reduce((s, t) => s + t.amount, 0);
    const completed = transactions.filter(t => t.status === 'completed').reduce((s, t) => s + t.amount, 0);
    const pending = transactions.filter(t => t.status === 'pending').reduce((s, t) => s + t.amount, 0);
    return { total, completed, pending, count: transactions.length };
  }, [transactions]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Finance</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Financial Management</h1>
          <p className="text-sm text-gray-400 mt-1">Track transactions, manage payouts, and generate reports.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<FileSpreadsheet size={14} />}>CSV</Button>
          <Button variant="ghost" size="sm" icon={<FileText size={14} />}>PDF</Button>
          <Button variant="ghost" size="sm" icon={<Download size={14} />}>Export</Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2  gap-3">
        {[
          { label: 'Total Revenue', value: fmt(summary.total), icon: DollarSign, change: '+12.5%', positive: true, color: 'from-green-500 to-emerald-600' },
          { label: 'Completed', value: fmt(summary.completed), icon: CheckCircle, change: '+8.3%', positive: true, color: 'from-[#151517]0 to-[#68686c]' },
          { label: 'Pending', value: fmt(summary.pending), icon: Clock, change: '-3.2%', positive: false, color: 'from-yellow-500 to-amber-600' },
          { label: 'Transactions', value: String(summary.count), icon: TrendingUp, change: '+15.7%', positive: true, color: 'from-[#151517]0 to-[#b78929]' },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass rounded-[20px] p-5 border border-white/[0.06]"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${card.color}`}>
                <card.icon size={18} className="text-white" />
              </div>
              <span className={`flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${card.positive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                {card.positive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                {card.change}
              </span>
            </div>
            <p className="text-2xl font-bold text-white">{card.value}</p>
            <p className="text-xs text-gray-400 mt-1">{card.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <GlassCard>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white/5 rounded-2xl px-3 py-1.5 border border-white/[0.06] flex-1 min-w-[200px]">
            <Search size={14} className="text-gray-500" />
            <input type="text" placeholder="Search transactions..." value={search} onChange={e => setSearch(e.target.value)}
              className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-500 w-full" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="glass rounded-2xl px-3 py-1.5 text-sm text-white border border-white/[0.06] outline-none bg-transparent">
            <option value="all">All Types</option>
            <option value="coin_purchase">Coin Purchase</option>
            <option value="gift_sent">Gift Sent</option>
            <option value="subscription">Subscription</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="refund">Refund</option>
            <option value="creator_earnings">Creator Earnings</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="glass rounded-2xl px-3 py-1.5 text-sm text-white border border-white/[0.06] outline-none bg-transparent">
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
          <Button variant="ghost" size="sm" icon={<Calendar size={14} />}>Date Range</Button>
        </div>
      </GlassCard>

      {/* Transactions Table */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white">Transactions ({filtered.length})</h3>
          <div className="flex gap-1">
            {['all', 'completed', 'pending', 'failed'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 text-[10px] rounded-full transition-colors ${statusFilter === s ? 'bg-[#151517]0/20 text-[#f2c75c]' : 'text-gray-500 hover:text-gray-300'}`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-white/[0.06]">
                <th className="text-left py-3 px-2 font-medium">Type</th>
                <th className="text-left py-3 px-2 font-medium">User</th>
                <th className="text-left py-3 px-2 font-medium">Description</th>
                <th className="text-right py-3 px-2 font-medium">Amount</th>
                <th className="text-center py-3 px-2 font-medium">Status</th>
                <th className="text-right py-3 px-2 font-medium">Date</th>
                <th className="text-center py-3 px-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx, i) => (
                <motion.tr
                  key={tx.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
                  onClick={() => setSelectedTx(selectedTx?.id === tx.id ? null : tx)}
                >
                  <td className="py-3 px-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${typeConfig[tx.type]?.color || ''}`}>
                      {typeConfig[tx.type]?.label || tx.type}
                    </span>
                  </td>
                  <td className="py-3 px-2">
                    <span className="text-white font-medium">{tx.userName}</span>
                  </td>
                  <td className="py-3 px-2 text-gray-400 text-xs max-w-[200px] truncate">{tx.description}</td>
                  <td className="py-3 px-2 text-right">
                    <span className={`font-bold ${tx.type === 'withdrawal' ? 'text-red-400' : 'text-green-400'}`}>
                      {tx.type === 'withdrawal' ? '-' : '+'}${tx.amount.toFixed(2)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusConfig[tx.status]?.color || ''}`}>
                      {statusConfig[tx.status]?.label || tx.status}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right text-gray-400 text-xs">
                    {new Date(tx.createdAt).toLocaleDateString()}
                  </td>
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
          <div className="text-center py-12 text-gray-500 text-sm">No transactions found.</div>
        )}

        {/* Transaction Detail */}
        {selectedTx && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-4 p-4 glass rounded-2xl border border-[#151517]0/20"
          >
            <div className="grid grid-cols-2  gap-4">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Transaction ID</p>
                <p className="text-sm text-white font-mono mt-1">{selectedTx.id}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Payment Method</p>
                <p className="text-sm text-white mt-1 capitalize">{selectedTx.paymentMethod || 'N/A'}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Completed At</p>
                <p className="text-sm text-white mt-1">{selectedTx.completedAt ? new Date(selectedTx.completedAt).toLocaleString() : 'N/A'}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Currency</p>
                <p className="text-sm text-white mt-1">{selectedTx.currency}</p>
              </div>
            </div>
            {selectedTx.metadata && (
              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Metadata</p>
                <pre className="text-xs text-gray-400">{JSON.stringify(selectedTx.metadata, null, 2)}</pre>
              </div>
            )}
          </motion.div>
        )}
      </GlassCard>

      {/* Audit Summary */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-[#d6a83f]" />
          <h3 className="text-sm font-bold text-white">Financial Audit Summary</h3>
        </div>
        <div className="grid grid-cols-2  gap-4 text-center">
          <div className="glass rounded-2xl p-4">
            <p className="text-xs text-gray-400">Total Processed</p>
            <p className="text-lg font-bold text-white mt-1">$12,345.67</p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs text-gray-400">Pending Review</p>
            <p className="text-lg font-bold text-yellow-400 mt-1">$5,678.90</p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs text-gray-400">Refunds</p>
            <p className="text-lg font-bold text-orange-400 mt-1">$19.99</p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs text-gray-400">Disputes</p>
            <p className="text-lg font-bold text-red-400 mt-1">0</p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}