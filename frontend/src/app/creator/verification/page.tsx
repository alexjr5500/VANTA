'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  BadgeCheck, Crown, ShieldCheck, Check, X, Clock, Loader2,
  AlertCircle, History, Sparkles, ChevronRight, RefreshCw, CalendarDays,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getVerificationStatus,
  getBadgePurchasePlans,
  getVerificationPurchases,
  getVerificationHistory,
  type BadgePurchasePlan,
  type VerificationStatus,
  type VerificationPurchaseRecord,
  type VerificationHistory,
} from '@/lib/verificationApi';
import VerificationBadge from '@/components/ui/VerificationBadge';
import VerificationPurchaseModal from '@/components/verification/VerificationPurchaseModal';
import { cn } from '@/lib/utils';

// ============================================================================
// CREATOR STUDIO — VERIFICATION
// ============================================================================
// Single source of truth for the creator's verification state. Every value is
// server-authoritative (verification + purchase endpoints); the purchase flow
// reuses the exact same server-verified Verified Badge payment system used
// across the platform — no client-side entitlements are ever granted.
// ============================================================================

const formatDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const BENEFITS = [
  { icon: BadgeCheck, label: 'Official verified badge', desc: 'A trust mark on your profile, posts and live streams' },
  { icon: ShieldCheck, label: 'Authenticated identity', desc: 'Confirms you are the real account behind your content' },
  { icon: Sparkles, label: 'Creator Studio access', desc: 'Gold verification unlocks the full VANTA Creator Studio' },
];

function BenefitsRow({ blue }: { blue?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      {BENEFITS.map((b) => {
        const Icon = b.icon;
        return (
          <div key={b.label} className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', blue ? 'bg-sky-500/15 text-sky-300' : 'bg-[var(--active-soft)] text-[var(--active)]')}>
              <Icon size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white/90">{b.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">{b.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
function PurchaseHistoryRow({ p }: { p: VerificationPurchaseRecord }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.04] bg-white/[0.02] px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm text-white/80">{p.plan?.name || 'Verified Badge'}</p>
        <p className="text-[11px] text-white/40">{formatDate(p.createdAt)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-white">${(p.amount || 0).toFixed(2)}</p>
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-wide',
            p.status === 'COMPLETED' ? 'text-emerald-400'
              : p.status === 'PENDING' || p.status === 'PROCESSING' ? 'text-amber-300'
              : p.status === 'FAILED' || p.status === 'EXPIRED' || p.status === 'CANCELLED' || p.status === 'REFUNDED' ? 'text-red-300'
              : 'text-white/40',
          )}
        >
          {p.status}
        </span>
      </div>
    </div>
  );
}

function HistoryRow({ item }: { item: VerificationHistory }) {
  const approved = item.action.includes('GRANTED') || item.action.includes('APPROVED');
  const rejected = item.action.includes('REVOKED') || item.action.includes('REJECTED') || item.action.includes('EXPIRED');
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2.5">
      <span className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
        approved ? 'bg-emerald-500/10 text-emerald-400'
          : rejected ? 'bg-red-500/10 text-red-400'
          : 'bg-white/[0.06] text-white/60',
      )}>
        {approved ? <Check size={14} /> : rejected ? <X size={14} /> : <Clock size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white/70">{item.action.replace(/_/g, ' ')}</p>
        <p className="text-[10px] text-white/35">{formatDate(item.createdAt)}</p>
      </div>
    </div>
  );
}
export default function CreatorVerificationPage() {
  const { token, isLoading } = useAuth();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [plans, setPlans] = useState<BadgePurchasePlan[]>([]);
  const [purchases, setPurchases] = useState<VerificationPurchaseRecord[]>([]);
  const [history, setHistory] = useState<VerificationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<BadgePurchasePlan | null>(null);

  const loadData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [statusData, plansData, purchasesData, historyData] = await Promise.all([
        getVerificationStatus(token),
        getBadgePurchasePlans(token),
        getVerificationPurchases(token),
        getVerificationHistory(token),
      ]);
      setStatus(statusData);
      setPlans(Array.isArray(plansData) ? plansData : []);
      setPurchases(Array.isArray(purchasesData?.purchases) ? purchasesData.purchases : []);
      setHistory(Array.isArray(historyData) ? historyData : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load verification data.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isLoading) return;
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isLoading]);

  const bluePlans = plans.filter((p) => p.badgeType === 'BLUE').sort((a, b) => a.sortOrder - b.sortOrder);
  const goldPlans = plans.filter((p) => p.badgeType === 'GOLD').sort((a, b) => a.sortOrder - b.sortOrder);
  const activeType = status?.badgeType === 'BLUE' || status?.badgeType === 'GOLD' ? status.badgeType : null;

  if (isLoading || loading) {
    return (
      <div className="w-full space-y-4">
        <div className="skeleton h-16 w-56 rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
        </div>
        <div className="skeleton h-72 rounded-2xl" />
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-16 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load verification</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void loadData()} className="btn-primary text-sm">
          <RefreshCw size={14} className="mr-1.5 inline" /> Try again
        </button>
      </div>
    );
  }
return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-5 pb-8">
      {/* ── Status summary ─────────────────────────────────────────────── */}
      <div className={cn(
        'relative overflow-hidden rounded-3xl border p-5 sm:p-6',
        activeType === 'GOLD'
          ? 'border-[var(--active-border)] bg-gradient-to-br from-[var(--active-soft)] to-transparent'
          : activeType === 'BLUE'
          ? 'border-sky-400/30 bg-gradient-to-br from-sky-500/[0.08] to-transparent'
          : 'border-white/[0.08] bg-white/[0.02]',
      )}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
            <VerificationBadge type={activeType === 'BLUE' ? 'BLUE' : activeType === 'GOLD' ? 'GOLD' : 'NONE'} size="lg" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-white">Verification</h2>
              {activeType ? (
                <span className={cn(
                  'rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  activeType === 'GOLD' ? 'bg-[var(--active-soft)] text-[var(--active-bright)]' : 'bg-sky-500/15 text-sky-300',
                )}>
                  {activeType} verified
                </span>
              ) : (
                <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                  Not verified
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-white/50">
              {activeType
                ? `Your ${activeType} badge is active across VANTA. Manage your plan or extend it below.`
                : 'Verify your account to earn a trust badge and unlock creator tools.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/45">
              <span className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1">
                <CalendarDays size={12} className="text-white/35" />
                {activeType ? `Active until ${formatDate(status?.verificationExpiryDate || status?.expiryDate || status?.subscriptionEndDate)}` : 'No active badge period'}
              </span>
              {status?.membershipStatus === 'ACTIVE' && (
                <span className="flex items-center gap-1.5 rounded-lg bg-[var(--active-soft)] px-2.5 py-1 text-[var(--active-bright)]">
                  <Crown size={12} /> {status.membershipPlan || 'Creator membership'} active
                </span>
              )}
              {status?.plan && (
                <span className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1">
                  <BadgeCheck size={12} className="text-white/35" /> {status.plan.name}
                </span>
              )}
            </div>
          </div>
          <Link
            href="/creator/upgrade"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--active-border)] bg-[var(--active-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--active-bright)] transition-colors hover:bg-[var(--active-soft)]/60"
          >
            {activeType === 'GOLD' ? 'Manage plan' : activeType === 'BLUE' ? 'Upgrade to Gold' : 'Get verified'} <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      {/* ── Benefits + subscription ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h3 className="mb-3 text-sm font-bold text-white">Why get verified on VANTA</h3>
          <BenefitsRow blue={activeType === 'BLUE'} />
        </section>

        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h3 className="mb-3 text-sm font-bold text-white">Subscription</h3>
          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-white/45">Status</dt>
              <dd className={cn('font-semibold', status?.membershipStatus === 'ACTIVE' ? 'text-emerald-400' : 'text-white/40')}>
                {status?.membershipStatus || 'NONE'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-white/45">Plan</dt>
              <dd className="truncate font-medium text-white/80">{status?.membershipPlan || '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-white/45">Renewal</dt>
              <dd className="font-medium text-white/80">{formatDate(status?.renewalDate || status?.subscriptionEndDate)}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-white/45">Badge expiry</dt>
              <dd className="font-medium text-white/80">{formatDate(status?.verificationExpiryDate)}</dd>
            </div>
          </dl>
          {status?.membershipPlan && status?.membershipStatus === 'ACTIVE' && (
            <p className="mt-3 rounded-xl bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-white/40">
              Your membership renews through the platform&apos;s existing subscription flow. Your badge stays active while the membership is active.
            </p>
          )}
        </section>
      </div>
{/* ── Purchase plans ─────────────────────────────────────────────── */}
      {plans.length > 0 && (
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white">Available plans</h3>
            <p className="mt-0.5 text-[11px] text-white/40">Select a plan to purchase or extend your Verified Badge.</p>
          </div>

          {(bluePlans.length > 0 || goldPlans.length > 0) && (
            <div className="space-y-5">
              {bluePlans.length > 0 && (
                <div className="space-y-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-sky-300"><BadgeCheck size={13} /> Blue Verified</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {bluePlans.map((plan) => (
                      <button
                        key={plan.id}
                        onClick={() => setSelectedPlan(plan)}
                        disabled={activeType === 'BLUE'}
                        className={cn(
                          'group flex flex-col justify-between rounded-2xl border bg-white/[0.02] p-4 text-left transition-all',
                          activeType === 'BLUE'
                            ? 'cursor-default border-sky-400/20 opacity-80'
                            : 'border-white/[0.06] hover:border-sky-400/40 hover:bg-sky-500/[0.04]',
                        )}
                      >
                        <div>
                          <p className="text-sm font-bold text-white">{plan.durationLabel}</p>
                          <p className="mt-0.5 text-[11px] text-white/40">{plan.description}</p>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <p className="text-lg font-extrabold text-white">${(plan.priceUSD || 0).toFixed(2)}</p>
                          <span
                            className={cn(
                              'rounded-lg px-2.5 py-1 text-[10px] font-bold',
                              activeType === 'BLUE' ? 'bg-white/[0.05] text-white/40' : 'bg-sky-500 text-white',
                            )}
                          >
                            {activeType === 'BLUE' ? 'Active' : 'Buy now'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {goldPlans.length > 0 && (
                <div className="space-y-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--active-bright)]"><Crown size={13} /> Gold Verified</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {goldPlans.map((plan) => (
                      <button
                        key={plan.id}
                        onClick={() => setSelectedPlan(plan)}
                        disabled={activeType === 'GOLD'}
                        className={cn(
                          'group flex flex-col justify-between rounded-2xl border bg-white/[0.02] p-4 text-left transition-all',
                          activeType === 'GOLD'
                            ? 'cursor-default border-[var(--active-border)]/30 opacity-80'
                            : 'border-[var(--active-border)]/40 hover:border-[var(--active-border)] hover:bg-[var(--active-soft)]/40',
                        )}
                      >
                        <div>
                          <p className="flex items-center gap-1.5 text-sm font-bold text-white"><Crown size={14} className="text-[var(--active)]" /> {plan.durationLabel}</p>
                          <p className="mt-0.5 text-[11px] text-white/40">Gold Verified badge + Creator Studio access</p>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <p className="text-lg font-extrabold text-white">${(plan.priceUSD || 0).toFixed(2)}</p>
                          <span
                            className={cn(
                              'rounded-lg px-2.5 py-1 text-[10px] font-bold',
                              activeType === 'GOLD' ? 'bg-white/[0.05] text-white/40' : 'bg-[var(--vanta-gold)] text-black',
                            )}
                          >
                            {activeType === 'GOLD' ? 'Active' : 'Buy now'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeType && (
            <p className="flex items-center gap-1.5 text-xs text-white/40">
              <Check size={13} className="text-emerald-400" />
              You already have an active {activeType} badge. Purchasing again extends your period when it expires.
            </p>
          )}
        </section>
      )}
{/* ── History ────────────────────────────────────────────────────── */}
      {purchases.length > 0 && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="mb-3 flex items-center gap-2">
            <History size={15} className="text-white/40" />
            <h3 className="text-sm font-bold text-white">Purchase history</h3>
          </div>
          <div className="space-y-2">
            {purchases.slice(0, 5).map((p) => <PurchaseHistoryRow key={p.id} p={p} />)}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="mb-3 flex items-center gap-2">
            <Clock size={15} className="text-white/40" />
            <h3 className="text-sm font-bold text-white">Verification history</h3>
          </div>
          <div className="space-y-2">
            {history.slice(0, 6).map((item) => <HistoryRow key={item.id} item={item} />)}
          </div>
        </section>
      )}

      {purchases.length === 0 && history.length === 0 && !activeType && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.04]">
            <ShieldCheck size={20} className="text-white/30" />
          </div>
          <p className="text-sm text-white/50">No verification activity yet.</p>
          <p className="mt-1 text-xs text-white/30">When you verify your account, status and purchase history will appear here.</p>
        </section>
      )}

      <VerificationPurchaseModal
        open={Boolean(selectedPlan)}
        plan={selectedPlan}
        onClose={() => setSelectedPlan(null)}
        onSuccess={() => {
          setSelectedPlan(null);
          void loadData();
        }}
      />
    </motion.div>
  );
}