"use client";

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { DollarSign, Gift, Coins, Wallet, ArrowUpRight, ArrowDownRight, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { getTransactionHistory, getGiftHistory } from '@/lib/walletApi';

// ============================================================================
// CREATOR EARNINGS — real creator wallet + aggregated stats. No client-side
// financial math: earnings/balances come from the backend wallet/creator APIs.
// ============================================================================

interface CreatorStats {
  username: string;
  fullName: string | null;
  avatar: string | null;
  verified: boolean;
  totalFollowers: number;
  following: number;
  totalPosts: number;
  totalReels: number;
  totalLiveSessions: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  giftsReceived: number;
  coins: number;
  earnings: number;
  earningsBalance: number;
}

const fmtCurrency = (n: number) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const statusColors: Record<string, string> = {
  COMPLETED: 'bg-emerald-500/15 text-emerald-400',
  PENDING: 'bg-amber-500/15 text-amber-300',
  FAILED: 'bg-red-500/15 text-red-400',
  REVERSED: 'bg-orange-500/15 text-orange-300',
};

export default function EarningsPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [giftHistory, setGiftHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [statsRes, txRes, giftRes] = await Promise.all([
        apiGet<{ stats: CreatorStats }>('/api/creator/stats', token).catch(() => ({ stats: null })),
        getTransactionHistory({ limit: 25 }).catch(() => ({})),
        getGiftHistory(15).catch(() => ({})),
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
      <div className="w-full space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </div>
        <div className="skeleton h-72 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load earnings</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }

  const hasActivity = (transactions?.length ?? 0) > 0 || (giftHistory?.length ?? 0) > 0;
return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-5 pb-8">
      {/* Earnings summary */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#c9a227]/40 to-transparent" aria-hidden />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">Creator earnings</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-white">${Number(stats?.earnings || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="mt-1 text-xs text-white/40">Available earnings balance: {fmtCurrency(stats?.earningsBalance ?? 0)}</p>
          </div>
          <Link href="/balance" className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3.5 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.04] hover:text-white">
            <Wallet size={14} /> Balance &amp; withdrawals
          </Link>
        </div>
      </section>

      {/* Wallet metrics */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <div className="card-premium min-w-0 p-4">
          <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-[#c9a227]/15 text-[#d9a83f]"><Coins size={16} /></div>
          <p className="truncate text-xl font-bold text-white">{Number(stats?.coins || 0).toLocaleString()}</p>
          <p className="mt-1 truncate text-[11px] text-white/40">VANTA coins</p>
        </div>
        <div className="card-premium min-w-0 p-4">
          <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-[#c9a227]/15 text-[#d9a83f]"><Gift size={16} /></div>
          <p className="truncate text-xl font-bold text-white">{Number(stats?.giftsReceived || 0).toLocaleString()}</p>
          <p className="mt-1 truncate text-[11px] text-white/40">Gifts received</p>
        </div>
        <div className="card-premium min-w-0 p-4 col-span-2 sm:col-span-1">
          <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400"><DollarSign size={16} /></div>
          <p className="truncate text-xl font-bold text-white">{fmtCurrency(stats?.earningsBalance ?? 0)}</p>
          <p className="mt-1 truncate text-[11px] text-white/40">Withdrawable</p>
        </div>
      </section>
{/* Recent transactions */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-3 flex items-center gap-2">
          <ArrowUpRight size={15} className="text-[var(--active)]" />
          <h3 className="text-sm font-bold text-white">Recent wallet transactions</h3>
        </div>
        {transactions.length > 0 ? (
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="min-w-[560px] space-y-1.5">
              {transactions.slice(0, 12).map((tx: any) => (
                <div key={tx.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.02] px-3.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {tx.amount > 0 ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/80">{tx.description || tx.type || 'Transaction'}</p>
                      <p className="text-[10px] text-white/35">{new Date(tx.createdAt || tx.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className={tx.amount > 0 ? 'text-emerald-400' : 'text-white'}>
                      {tx.amount > 0 ? '+' : ''}{fmtCurrency(tx.amount || 0)}
                    </span>
                    {tx.status && <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${statusColors[tx.status] || 'bg-white/[0.06] text-white/40'}`}>{tx.status}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-white/40">No wallet transactions yet.</p>
        )}
      </section>

      {giftHistory.length > 0 && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="mb-3 flex items-center gap-2">
            <Gift size={15} className="text-[var(--active)]" />
            <h3 className="text-sm font-bold text-white">Recent gifts</h3>
          </div>
          <div className="space-y-1.5">
            {giftHistory.slice(0, 8).map((g: any, i: number) => (
              <div key={g.id || i} className="flex items-center justify-between rounded-xl bg-white/[0.02] px-3.5 py-2.5 text-sm">
                <span className="truncate text-white/75">{g.gift?.name || g.giftName || 'Gift'}{g.from?.username ? ` · from @${g.from.username}` : ''}</span>
                <span className="shrink-0 font-semibold text-[#d9a83f]">{Number(g.amount || g.coins || 0).toLocaleString()} coins</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!hasActivity && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <Loader2 size={26} className="mx-auto mb-3 text-white/15" />
          <p className="text-sm text-white/50">No earnings activity yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-white/30">Receive gifts and coins from your followers to see your earnings here.</p>
        </section>
      )}
    </motion.div>
  );
}