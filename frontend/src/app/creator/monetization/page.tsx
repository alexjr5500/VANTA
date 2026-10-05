"use client";

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { DollarSign, Gift, Coins, Wallet, Crown, BadgeCheck, AlertCircle, RefreshCw, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { getVerificationStatus, type VerificationStatus } from '@/lib/verificationApi';
import { getBalance } from '@/lib/walletApi';

// ============================================================================
// CREATOR MONETIZATION — real VANTA economy surface. All values come from the
// existing wallet, verification and gift systems; nothing is fabricated.
// ============================================================================

interface CreatorStats {
  totalFollowers: number;
  giftsReceived: number;
  coins: number;
  earnings: number;
  earningsBalance: number;
}

const fmtCurrency = (n: number) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MonetizationPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [verification, setVerification] = useState<VerificationStatus | null>(null);
  const [wallet, setWallet] = useState<any>(null);
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
      const [statsRes, verifyRes, walletRes] = await Promise.all([
        apiGet<{ stats: CreatorStats }>('/api/creator/stats', token).catch(() => ({ stats: null })),
        getVerificationStatus(token).catch(() => null),
        getBalance().catch(() => null),
      ]);
      setStats(statsRes?.stats ?? null);
      setVerification(verifyRes);
      setWallet(walletRes);
    } catch (err: any) {
      setError(err?.message || 'Failed to load monetization.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="w-full space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
        </div>
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load monetization</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }

  const channels = [
    {
      icon: Gift,
      label: 'Gifts',
      desc: 'Followers send gifts that appear on your content and live streams.',
      value: `${Number(stats?.giftsReceived || 0).toLocaleString()} received`,
      tile: 'bg-violet-500/15 text-violet-300',
      href: '/gift-store',
      cta: 'Browse gift store',
    },
    {
      icon: Coins,
      label: 'VANTA Coins',
      desc: 'The platform currency behind gifts, rewards and transfers.',
      value: `${Number(stats?.coins || 0).toLocaleString()} coins`,
      tile: 'bg-[#c9a227]/15 text-[#d9a83f]',
      href: '/balance',
      cta: 'View balance',
    },
    {
      icon: DollarSign,
      label: 'Earnings',
      desc: 'Your creator earnings accumulate in your wallet balance.',
      value: fmtCurrency(stats?.earnings ?? 0),
      tile: 'bg-emerald-500/15 text-emerald-400',
      href: '/balance',
      cta: 'Manage earnings',
    },
  ];

  const isGold = Boolean(verification?.hasGoldBadge);
  const isBlue = Boolean(verification?.hasBlueBadge);
return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-5 pb-8">
      {/* Status banner */}
      <section className={`relative overflow-hidden rounded-3xl border p-5 ${isGold ? 'border-[var(--active-border)] bg-gradient-to-br from-[var(--active-soft)] to-transparent' : 'border-white/[0.06] bg-white/[0.02]'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`grid h-11 w-11 place-items-center rounded-2xl ${isGold ? 'bg-[var(--active-soft)] text-[var(--active)]' : 'bg-white/[0.05] text-white/40'}`}>
              <Crown size={20} />
            </span>
            <div>
              <p className="text-sm font-bold text-white">{isGold ? 'Gold creator' : isBlue ? 'Verified creator' : 'Creator'}</p>
              <p className="text-xs text-white/45">{isGold ? 'All monetization tools are available to you.' : 'Upgrade to Gold to unlock the full creator toolkit.'}</p>
            </div>
          </div>
          <Link href="/creator/verification" className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--active-border)] bg-[var(--active-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--active-bright)]">
            <BadgeCheck size={14} /> {isGold ? 'Verification' : 'Upgrade'} <ArrowUpRight size={13} />
          </Link>
        </div>
      </section>

      {/* Wallet balance strip */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-white/40"><Wallet size={12} /> Wallet</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-white">{fmtCurrency(stats?.earningsBalance ?? wallet?.earningsBalance ?? 0)}</p>
            <p className="mt-1 text-xs text-white/40">Available earnings balance</p>
          </div>
          <Link href="/balance" className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--active)] px-4 py-2 text-xs font-semibold text-black hover:opacity-90">
            Open balance <ArrowUpRight size={13} />
          </Link>
        </div>
      </section>

      {/* Channels */}
      <section>
        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">How you earn on VANTA</h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {channels.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.label} className="flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                <span className={`mb-3 grid h-10 w-10 place-items-center rounded-xl ${c.tile}`}><Icon size={17} /></span>
                <p className="text-sm font-bold text-white">{c.label}</p>
                <p className="mt-1 flex-1 text-[11px] leading-relaxed text-white/40">{c.desc}</p>
                <p className="mt-3 text-lg font-semibold text-white">{c.value}</p>
                <Link href={c.href} className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--active-bright)]">
                  {c.cta} <ArrowUpRight size={11} />
                </Link>
              </div>
            );
          })}
        </div>
      </section>
    </motion.div>
  );
}