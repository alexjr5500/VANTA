'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import {
  getBadgePurchasePlans,
  getVerificationStatus,
  getVerificationPurchases,
  type BadgePurchasePlan,
  type VerificationStatus,
  type VerificationPurchaseRecord,
} from '@/lib/verificationApi';
import PageHeader from '@/components/ui/PageHeader';
import VerificationBadge from '@/components/ui/VerificationBadge';
import VerificationPurchaseModal from '@/components/verification/VerificationPurchaseModal';
import { ShieldCheck, Check, Clock, Loader2, AlertCircle, History, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

const formatDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function VerifiedBadgePage() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [plans, setPlans] = useState<BadgePurchasePlan[]>([]);
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [purchases, setPurchases] = useState<VerificationPurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<BadgePurchasePlan | null>(null);

  const bluePlans = plans.filter((p) => p.badgeType === 'BLUE').sort((a, b) => a.sortOrder - b.sortOrder);
  const goldPlans = plans.filter((p) => p.badgeType === 'GOLD').sort((a, b) => a.sortOrder - b.sortOrder);

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [plansData, statusData, purchasesData] = await Promise.all([
        getBadgePurchasePlans(token),
        getVerificationStatus(token),
        getVerificationPurchases(token),
      ]);
      setPlans(plansData);
      setStatus(statusData);
      setPurchases(purchasesData.purchases || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load verification plans');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      setPlans([]);
      setStatus(null);
      setLoading(false);
      return;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <Loader2 size={28} className="animate-spin text-[#c8c8cc]" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="glass rounded-[28px] p-12 text-center max-w-md mx-4">
          <ShieldCheck size={48} className="text-[#c8c8cc] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white">Verified Badge</h2>
          <p className="text-sm text-gray-400 mt-2">Sign in to purchase and manage your Verified Badge.</p>
          <button onClick={() => router.push('/login')} className="mt-6 px-6 py-2.5 rounded-full bg-gradient-to-r from-[#151517]0 to-[#68686c] text-white text-sm font-semibold hover:brightness-110 transition-all">
            Sign In
          </button>
        </div>
      </div>
    );
  }

  const activeType = status?.badgeType === 'BLUE' || status?.badgeType === 'GOLD' ? status.badgeType : null;
  const activeUntil = status?.verificationExpiryDate || status?.expiryDate;
return (
    <div className="min-h-screen bg-[var(--background)] pb-24">
      <div className="mx-auto w-full max-w-2xl px-4">
        <PageHeader title="Verified Badge" back="/verification" />

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {loading && plans.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center text-gray-500">
            <Loader2 size={20} className="mr-2 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Current verification status */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass mb-5 rounded-3xl border border-white/[0.06] p-5"
            >
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-gray-400">My verification</h2>
              {activeType ? (
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', activeType === 'BLUE' ? 'bg-sky-500/15' : 'bg-amber-500/15')}>
                    <VerificationBadge type={activeType} size="md" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-base font-bold text-white">
                      <span className={activeType === 'BLUE' ? 'text-sky-400' : 'text-amber-400'}>{activeType} Verified</span>
                    </p>
                    <p className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock size={12} /> Active until {formatDate(activeUntil)}
                    </p>
                    {status?.plan && (
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {status.plan.name} · ${status.plan.price.toFixed(2)}
                      </p>
                    )}
                  </div>
                  {status?.purchaseReference && (
                    <span className="truncate rounded-lg bg-white/[0.04] px-2 py-1 text-[10px] text-gray-500">Ref: {status.purchaseReference}</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-gray-500">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">No active Verified Badge</p>
                    <p className="text-xs text-gray-400">Choose a plan below to get verified.</p>
                  </div>
                </div>
              )}
            </motion.section>
{/* Blue Verified plans */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/15">
                  <VerificationBadge type="BLUE" size="xs" />
                </span>
                <h2 className="text-lg font-bold text-white">Blue Verified</h2>
                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">Verified</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {bluePlans.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan)}
                    disabled={Boolean(activeType)}
                    className={cn(
                      'rounded-2xl border p-4 text-left transition-all',
                      activeType
                        ? 'cursor-not-allowed border-white/[0.04] bg-white/[0.02] opacity-60'
                        : 'border-sky-500/25 bg-gradient-to-b from-sky-500/[0.08] to-transparent hover:border-sky-400/50 hover:from-sky-500/[0.14]',
                    )}
                  >
                    <p className="text-sm font-bold text-white">{plan.durationLabel}</p>
                    <p className="mt-1 text-2xl font-extrabold text-white">${plan.priceUSD.toFixed(2)}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">${(plan.priceUSD / plan.durationMonths).toFixed(2)}/mo</p>
                    <span className={cn('mt-3 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold', activeType ? 'bg-white/[0.05] text-gray-400' : 'bg-sky-500 text-white')}>
                      {activeType ? 'Already verified' : 'Buy now'}
                    </span>
                  </button>
                ))}
              </div>
            </motion.section>
{/* Gold Verified plan */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15">
                  <VerificationBadge type="GOLD" size="xs" />
                </span>
                <h2 className="text-lg font-bold text-white">Gold Verified</h2>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Top tier</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-1">
                {goldPlans.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan)}
                    disabled={Boolean(activeType)}
                    className={cn(
                      'flex items-center justify-between rounded-2xl border p-5 text-left transition-all',
                      activeType
                        ? 'cursor-not-allowed border-white/[0.04] bg-white/[0.02] opacity-60'
                        : 'border-amber-500/30 bg-gradient-to-b from-amber-500/[0.1] to-transparent hover:border-amber-400/60 hover:from-amber-500/[0.16]',
                    )}
                  >
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-bold text-white"><Crown size={14} className="text-amber-400" /> {plan.durationLabel}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">Gold Verified badge + Creator Studio access</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-extrabold text-white">${plan.priceUSD.toFixed(2)}</p>
                      <span className={cn('mt-1 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold', activeType ? 'bg-white/[0.05] text-gray-400' : 'bg-[var(--vanta-gold)] text-black')}>
                        {activeType ? 'Already verified' : 'Buy now'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </motion.section>

            {activeType && (
              <p className="mt-4 flex items-center gap-1.5 text-xs text-gray-400">
                <Check size={13} className="text-emerald-400" />
                You already have an active {activeType} badge. Purchasing again here will extend your period when it expires — or wait for it to expire to switch tiers.
              </p>
            )}
{/* Purchase history */}
            {purchases.length > 0 && (
              <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mt-6">
                <div className="mb-2 flex items-center gap-2">
                  <History size={15} className="text-gray-400" />
                  <h3 className="text-sm font-bold text-white">Purchase history</h3>
                </div>
                <div className="space-y-2">
                  {purchases.slice(0, 5).map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-2xl border border-white/[0.04] bg-white/[0.02] px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/80">{p.plan?.name || 'Verified Badge'}</p>
                        <p className="text-[11px] text-gray-500">{new Date(p.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-white">${p.amount.toFixed(2)}</p>
                        <span
                          className={cn(
                            'text-[10px] font-semibold uppercase tracking-wide',
                            p.status === 'COMPLETED' ? 'text-emerald-400' : p.status === 'PENDING' || p.status === 'PROCESSING' ? 'text-amber-300' : p.status === 'FAILED' || p.status === 'EXPIRED' || p.status === 'CANCELLED' || p.status === 'REFUNDED' ? 'text-red-300' : 'text-gray-400',
                          )}
                        >
                          {p.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.section>
            )}
          </>
        )}
      </div>

      <VerificationPurchaseModal
        open={Boolean(selectedPlan)}
        plan={selectedPlan}
        onClose={() => setSelectedPlan(null)}
        onSuccess={() => {
          setSelectedPlan(null);
          loadData();
        }}
      />
    </div>
  );
}