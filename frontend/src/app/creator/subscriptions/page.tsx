"use client";

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Crown, BadgeCheck, CalendarDays, AlertCircle, RefreshCw, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getVerificationStatus, getSubscriptionPlans, type VerificationStatus, type SubscriptionPlan } from '@/lib/verificationApi';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { cn } from '@/lib/utils';

// ============================================================================
// CREATOR SUBSCRIPTIONS — the creator's real membership/plan status sourced
// from the existing verification subscription backend.
// ============================================================================

const formatDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function SubscriptionsPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
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
      const [statusData, plansData] = await Promise.all([
        getVerificationStatus(token),
        getSubscriptionPlans(token).catch(() => []),
      ]);
      setStatus(statusData);
      setPlans(Array.isArray(plansData) ? plansData : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load subscription status.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="w-full space-y-3">
        <div className="skeleton h-40 rounded-3xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[1, 2].map((i) => <div key={i} className="skeleton h-36 rounded-2xl" />)}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load subscriptions</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }

  const active = status?.membershipStatus === 'ACTIVE';
return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-5 pb-8">
      {/* Current membership */}
      <section className={cn(
        'relative overflow-hidden rounded-3xl border p-6',
        active ? 'border-[var(--active-border)] bg-gradient-to-br from-[var(--active-soft)] to-transparent' : 'border-white/[0.06] bg-white/[0.02]',
      )}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
            {status?.hasGoldBadge ? <VerificationBadge type="GOLD" size="lg" /> : status?.hasBlueBadge ? <VerificationBadge type="BLUE" size="lg" /> : <Crown size={22} className="text-white/30" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-white">{status?.membershipPlan || 'No active plan'}</h2>
              {active && <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Active</span>}
            </div>
            <p className="mt-1 text-sm text-white/45">
              {active
                ? 'Your creator subscription is active.'
                : status?.membershipPlan
                ? 'This subscription is not currently active.'
                : 'You don&apos;t have an active creator subscription yet.'}
            </p>
          </div>
          <Link href="/creator/upgrade" className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--active-border)] bg-[var(--active-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--active-bright)]">
            {active ? 'Manage plan' : 'View plans'} <ChevronRight size={14} />
          </Link>
        </div>

        {active && (
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-white/[0.06] pt-5 sm:grid-cols-4">
            <div>
              <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/35"><CalendarDays size={11} /> Started</dt>
              <dd className="mt-1 text-sm font-medium text-white">{formatDate(status?.expiryDate)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/35"><CalendarDays size={11} /> Renewal</dt>
              <dd className="mt-1 text-sm font-medium text-white">{formatDate(status?.renewalDate || status?.subscriptionEndDate)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/35"><BadgeCheck size={11} /> Badge</dt>
              <dd className="mt-1 text-sm font-medium text-white">{status?.badgeType || 'NONE'}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/35"><BadgeCheck size={11} /> Badge status</dt>
              <dd className="mt-1 text-sm font-medium text-white">{status?.badgeStatus || '—'}</dd>
            </div>
          </dl>
        )}
      </section>

      {/* Available subscription plans */}
      {plans.length > 0 && (
        <section>
          <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">Available subscription plans</h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {plans.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{plan.name}</p>
                  <p className="mt-0.5 text-[11px] text-white/40">{plan.durationMonths} month{plan.durationMonths === 1 ? '' : 's'} · {plan.badgeType} badge</p>
                </div>
                <Link href="/creator/upgrade" className="shrink-0 rounded-xl bg-[var(--active)] px-3.5 py-2 text-xs font-semibold text-black hover:opacity-90">
                  View
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {!active && plans.length === 0 && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <Crown size={26} className="mx-auto mb-3 text-white/15" />
          <p className="text-sm text-white/50">No subscriptions yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-white/30">Subscriptions, memberships and badge plans you join will be listed here.</p>
          <Link href="/creator/upgrade" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--active)] px-4 py-2 text-xs font-semibold text-black hover:opacity-90">
            Explore plans <ChevronRight size={13} />
          </Link>
        </section>
      )}
    </motion.div>
  );
}