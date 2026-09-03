"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, TrendingUp, Gift, Crown, Wallet, ArrowUpRight, ArrowDownRight, Clock, CheckCircle } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { apiGet } from '@/lib/apiClient';

const fmtCurrency = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 });

export default function EarningsPage() {
  const [period, setPeriod] = useState<'today' | 'weekly' | 'monthly' | 'lifetime'>('monthly');
  const [earnings, setEarnings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await apiGet('/api/creator/earnings');
        setEarnings(data);
      } catch {}
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const defaultEarnings = {
    today: 0, weekly: 0, monthly: 0, lifetime: 0,
    giftBreakdown: [], subscriptionRevenue: 0, adRevenue: 0,
    pendingPayouts: 0, withdrawalBalance: 0, transactions: [],
  };
  const e = earnings || defaultEarnings;

  const periods = [
    { key: 'today' as const, value: e.today, label: 'Today' },
    { key: 'weekly' as const, value: e.weekly, label: 'This Week' },
    { key: 'monthly' as const, value: e.monthly, label: 'This Month' },
    { key: 'lifetime' as const, value: e.lifetime, label: 'Lifetime' },
  ];

  return (
    <div className="w-full space-y-6">
      <div className="grid grid-cols-2  gap-3">
        {periods.map((p, i) => (
          <motion.button key={p.key} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            onClick={() => setPeriod(p.key)}
            className={`glass rounded-[20px] p-5 border transition-all text-left ${period === p.key ? 'border-[#151517]0/40 bg-[#151517]0/5' : 'border-white/[0.06] hover:border-white/[0.12]'}`}>
            <p className="text-xs text-gray-400">{p.label}</p>
            <p className="text-2xl font-bold text-white mt-1">{fmtCurrency(p.value)}</p>
          </motion.button>
        ))}
      </div>

      <div className="grid grid-cols-1  gap-6">
        <GlassCard>
          <div className="flex items-center gap-2 mb-4">
            <Gift size={16} className="text-[#d6a83f]" />
            <h3 className="text-sm font-bold text-white">Gift Breakdown</h3>
          </div>
          <div className="space-y-3">
            {e.giftBreakdown?.length > 0 ? e.giftBreakdown.map((gift: any) => (
              <div key={gift.name} className="flex items-center justify-between">
                <div><p className="text-sm text-white">{gift.name}</p><p className="text-[10px] text-gray-500">{gift.count} sent</p></div>
                <p className="text-sm font-bold text-green-400">{fmtCurrency(gift.revenue)}</p>
              </div>
            )) : <p className="text-sm text-gray-500">No gifts received yet.</p>}
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center gap-2 mb-4">
            <Crown size={16} className="text-yellow-400" />
            <h3 className="text-sm font-bold text-white">Revenue Summary</h3>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Subscription Revenue', value: e.subscriptionRevenue, color: 'text-[#c8c8cc]' },
              { label: 'Ad Revenue', value: e.adRevenue, color: 'text-[#c8c8cc]' },
              { label: 'Pending Payouts', value: e.pendingPayouts, color: 'text-yellow-400' },
              { label: 'Withdrawal Balance', value: e.withdrawalBalance, color: 'text-green-400' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <p className="text-sm text-gray-400">{item.label}</p>
                <p className={`text-sm font-bold ${item.color}`}>{fmtCurrency(item.value)}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <div className="flex items-center gap-2 mb-4">
          <Wallet size={16} className="text-[#d6a83f]" />
          <h3 className="text-sm font-bold text-white">Recent Transactions</h3>
        </div>
        <div className="overflow-x-auto">
          {e.transactions?.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="text-left py-3 px-2 font-medium">Type</th>
                  <th className="text-left py-3 px-2 font-medium">Description</th>
                  <th className="text-right py-3 px-2 font-medium">Amount</th>
                  <th className="text-center py-3 px-2 font-medium">Status</th>
                  <th className="text-right py-3 px-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {e.transactions.map((tx: any, i: number) => (
                  <motion.tr key={tx.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="py-3 px-2"><span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-white/10">{tx.type}</span></td>
                    <td className="py-3 px-2 text-white text-xs">{tx.description}</td>
                    <td className={`py-3 px-2 text-right font-bold ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>{tx.amount > 0 ? '+' : ''}{fmtCurrency(tx.amount)}</td>
                    <td className="py-3 px-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${tx.status === 'completed' ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{tx.status}</span>
                    </td>
                    <td className="py-3 px-2 text-right text-gray-500 text-xs">{new Date(tx.createdAt).toLocaleDateString()}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500 py-4">No transactions yet.</p>}
        </div>
      </GlassCard>
    </div>
  );
}