'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { getSubscriptionPlans, getVerificationStatus, subscribeToPlan, type SubscriptionPlan, type VerificationStatus } from '@/lib/verificationApi';
import { Crown, ShieldCheck, Sparkles, BarChart3, DollarSign, HeadphonesIcon, Zap, Star, Check, ChevronRight, Loader2, Clock, Users, Radio, TrendingUp, Gift, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const benefits = [
  { icon: Crown, label: 'Gold Creator Badge', desc: 'Stand out with the official Gold badge' },
  { icon: Sparkles, label: 'Creator Studio Access', desc: 'Full access to all creator tools' },
  { icon: BarChart3, label: 'Advanced Analytics', desc: 'Track your growth with detailed insights' },
  { icon: DollarSign, label: 'Monetization Tools', desc: 'Earn from your content' },
  { icon: HeadphonesIcon, label: 'Priority Support', desc: 'Get help when you need it' },
  { icon: Zap, label: 'Early Access', desc: 'Be first to try new features' },
];

const featureComparison = [
  { feature: 'Gold Creator Badge', free: false, premium: true },
  { feature: 'Creator Studio', free: false, premium: true },
  { feature: 'Advanced Analytics', free: false, premium: true },
  { feature: 'Monetization Tools', free: false, premium: true },
  { feature: 'Priority Support', free: false, premium: true },
  { feature: 'Early Access', free: false, premium: true },
  { feature: 'Live Streaming', free: true, premium: true },
  { feature: 'Basic Profile', free: true, premium: true },
  { feature: 'Messaging', free: true, premium: true },
];

export default function CreatorUpgradePage() {
  const { user, token, isLoading } = useAuth();
  const router = useRouter();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual');

  useEffect(() => {
    if (!token) {
      setPlans([]);
      setVerificationStatus(null);
      setLoading(false);
      setStatusLoading(false);
      return;
    }

    loadData();
  }, [token]);

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    setStatusLoading(true);
    try {
      const [plansData, statusData] = await Promise.all([
        getSubscriptionPlans(token),
        getVerificationStatus(token),
      ]);
      setPlans(plansData);
      setVerificationStatus(statusData);
    } catch (err: any) {
      setError(err.message || 'Failed to load creator plans');
    } finally {
      setLoading(false);
      setStatusLoading(false);
    }
  };

  const handleSubscribe = async (planId: string) => {
    if (!token) return;
    setSubscribing(planId);
    setError(null);
    try {
      await subscribeToPlan(token, { planId });
      await loadData();
      setSuccess(true);
      setTimeout(() => {
        router.push('/creator');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Subscription failed');
    } finally {
      setSubscribing(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-amber-500/60" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="glass rounded-[28px] p-12 text-center max-w-md mx-4">
          <Crown size={48} className="text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white">Creator Membership</h2>
          <p className="text-sm text-gray-400 mt-2">Sign in to unlock premium creator tools.</p>
          <button onClick={() => router.push('/login')} className="mt-6 px-6 py-2.5 rounded-full bg-gradient-to-r from-amber-500 to-yellow-600 text-white text-sm font-semibold hover:brightness-110 transition-all">
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass rounded-[28px] p-12 text-center max-w-md mx-4"
        >
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-amber-500/30">
            <Crown size={40} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Welcome to Creator Membership!</h2>
          <p className="text-gray-400 mb-2">Your Gold badge is now active.</p>
          <p className="text-sm text-gray-500">Redirecting to Creator Studio...</p>
          <div className="mt-6 flex justify-center">
            <Loader2 size={24} className="text-amber-400 animate-spin" />
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-20 pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 via-transparent to-transparent" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[120px]" />

        <div className="relative max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-6"
          >
            <Sparkles size={12} />
            Premium Creator Membership
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl  font-bold text-white mb-4 tracking-tight"
          >
            Become a{' '}
            <span className="bg-gradient-to-r from-amber-400 to-yellow-500 bg-clip-text text-transparent">
              Verified Creator
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-lg text-gray-400 max-w-2xl mx-auto mb-8"
          >
            Unlock Creator Studio and premium creator tools with VANTA Creator.
          </motion.p>

          {!statusLoading && verificationStatus && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mx-auto mb-10 flex max-w-xl items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left"
            >
              <div className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full',
                verificationStatus.hasGoldBadge
                  ? 'bg-gradient-to-br from-amber-400 to-yellow-600'
                  : 'bg-gradient-to-br from-[#151517]0 to-[#151517]0'
              )}>
                {verificationStatus.hasGoldBadge ? <Crown size={18} className="text-white" /> : <Sparkles size={18} className="text-white" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  {verificationStatus.hasGoldBadge ? 'You already have Creator access' : 'You are one step away from Creator access'}
                </p>
                <p className="text-xs text-gray-400">
                  {verificationStatus.hasGoldBadge
                    ? 'Your Gold badge and Creator Studio tools are active.'
                    : 'Choose a plan below to unlock Creator Studio, premium analytics, and monetization features.'}
                </p>
              </div>
            </motion.div>
          )}

          {/* Badge Preview */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex items-center justify-center gap-6 mb-12"
          >
            <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#151517]0 to-[#68686c] flex items-center justify-center shadow-lg shadow-[#151517]0/30">
                <ShieldCheck size={24} className="text-white" />
              </div>
              <span className="text-xs text-gray-400">Blue Badge</span>
              <span className="text-[10px] text-gray-500">Identity Verified</span>
            </div>
            <div className="text-gray-600 text-2xl">+</div>
            <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 to-yellow-500/10 border border-amber-500/20">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                <Crown size={24} className="text-white" />
              </div>
              <span className="text-xs text-amber-400 font-medium">Gold Badge</span>
              <span className="text-[10px] text-gray-500">Creator Membership</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section id="pricing" className="px-4 pb-16">
        <div className="max-w-5xl mx-auto">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center"
            >
              {error}
            </motion.div>
          )}

          {loading ? (
            <div className="grid grid-cols-1  gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton h-[400px] rounded-3xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1  gap-6">
              {plans.length === 0 ? (
                <div className=" rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-gray-400">
                  Creator plans are not available right now. Please try again shortly.
                </div>
              ) : plans.map((plan, index) => {
                const isPopular = plan.savings === '25%';
                const isBestValue = plan.savings === '10%';
                return (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + index * 0.1 }}
                    className={cn(
                      'relative rounded-3xl border overflow-hidden transition-all duration-300',
                      isPopular
                        ? 'bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/30 shadow-xl shadow-amber-500/10 scale-105'
                        : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.15]'
                    )}
                  >
                    {isPopular && (
                      <div className="absolute top-0 left-0 right-0">
                        <div className="bg-gradient-to-r from-amber-500 to-yellow-500 text-white text-[10px] font-bold text-center py-1.5 uppercase tracking-wider">
                          Best Value
                        </div>
                      </div>
                    )}

                    <div className={cn('p-6', isPopular && 'pt-10')}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                        {plan.savings && (
                          <span className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-bold',
                            isPopular ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
                          )}>
                            Save {plan.savings}
                          </span>
                        )}
                      </div>

                      <div className="mb-6">
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-white">${plan.price.toFixed(2)}</span>
                          <span className="text-sm text-gray-400">/ {plan.durationMonths}mo</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          ${(plan.price / plan.durationMonths).toFixed(2)}/month
                        </p>
                      </div>

                      <ul className="space-y-3 mb-8">
                        {plan.benefits.map((benefit: string, i: number) => (
                          <li key={i} className="flex items-start gap-3">
                            <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                              <Check size={10} className="text-amber-400" />
                            </div>
                            <span className="text-sm text-gray-300">{benefit}</span>
                          </li>
                        ))}
                      </ul>

                      <button
                        onClick={() => {
                          if (verificationStatus?.hasGoldBadge) {
                            router.push('/creator');
                            return;
                          }
                          handleSubscribe(plan.id);
                        }}
                        disabled={subscribing === plan.id || (verificationStatus?.hasGoldBadge && !subscribing)}
                        className={cn(
                          'w-full py-3 rounded-2xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2',
                          isPopular
                            ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30'
                            : 'bg-white/5 text-white border border-white/10 hover:bg-white/10'
                        )}
                      >
                        {subscribing === plan.id ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            Processing...
                          </>
                        ) : verificationStatus?.hasGoldBadge ? (
                          <>
                            Open Creator Studio
                            <ChevronRight size={14} />
                          </>
                        ) : (
                          <>
                            Upgrade Now
                            <ChevronRight size={14} />
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Feature Comparison */}
      <section className="px-4 pb-20">
        <div className="max-w-3xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-2xl font-bold text-white text-center mb-8"
          >
            Everything you get with Creator Membership
          </motion.h2>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass rounded-3xl border border-white/[0.06] overflow-hidden"
          >
            <div className="grid grid-cols-3 gap-4 p-4 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="text-sm font-medium text-gray-400">Feature</div>
              <div className="text-sm font-medium text-gray-400 text-center">Free</div>
              <div className="text-sm font-medium text-amber-400 text-center">Creator</div>
            </div>
            {featureComparison.map((item, i) => (
              <div
                key={item.feature}
                className={cn(
                  'grid grid-cols-3 gap-4 p-4',
                  i < featureComparison.length - 1 && 'border-b border-white/[0.04]'
                )}
              >
                <div className="text-sm text-white">{item.feature}</div>
                <div className="flex justify-center">
                  {item.free ? (
                    <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <Check size={10} className="text-emerald-400" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center">
                      <span className="text-gray-600 text-xs">—</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-center">
                  <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <Check size={10} className="text-amber-400" />
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Creator Studio Preview */}
      <section className="px-4 pb-20">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-8"
          >
            <h2 className="text-2xl font-bold text-white mb-2">Creator Studio Preview</h2>
            <p className="text-sm text-gray-400">See what you&apos;re unlocking</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative rounded-3xl overflow-hidden border border-white/[0.06]"
          >
            {/* Blurred preview */}
            <div className="relative">
              <div className="grid grid-cols-2  gap-4 p-6 bg-white/[0.02]">
                {[
                  { icon: BarChart3, label: 'Analytics', color: 'from-[#151517]0 to-[#68686c]' },
                  { icon: DollarSign, label: 'Earnings', color: 'from-emerald-500 to-teal-600' },
                  { icon: Users, label: 'Community', color: 'from-[#151517]0 to-[#68686c]' },
                  { icon: Radio, label: 'Live Studio', color: 'from-[#d6a83f] to-[#b78929]' },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] blur-sm">
                    <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center', item.color)}>
                      <item.icon size={16} className="text-white" />
                    </div>
                    <span className="text-xs text-white/50">{item.label}</span>
                  </div>
                ))}
              </div>

              {/* Blur overlay */}
              <div className="absolute inset-0 backdrop-blur-md bg-black/40 flex items-center justify-center">
                <div className="text-center p-8">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-amber-500/30">
                    <Crown size={28} className="text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Unlock Creator Studio</h3>
                  <p className="text-sm text-gray-300 mb-6 max-w-md">
                    Join VANTA Creator to access your full studio dashboard with analytics, earnings, live tools, and more.
                  </p>
                  <button
                    onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
                    className="px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-500 text-white text-sm font-bold shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 transition-all"
                  >
                    Upgrade Now
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto text-center glass rounded-3xl border border-amber-500/10 p-10"
        >
          <Crown size={40} className="text-amber-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Ready to become a Creator?</h2>
          <p className="text-gray-400 mb-6">
            Join VANTA Creator and unlock the full potential of your content.
          </p>
          <button
            onClick={() => {
              if (verificationStatus?.hasGoldBadge) {
                router.push('/creator');
                return;
              }
              if (plans.length > 0) {
                handleSubscribe(plans[0].id);
              }
            }}
            disabled={subscribing !== null || (!verificationStatus?.hasGoldBadge && plans.length === 0)}
            className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-500 text-white font-bold shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 transition-all"
          >
            {subscribing ? 'Processing...' : verificationStatus?.hasGoldBadge ? 'Open Creator Studio' : 'Get Started'}
          </button>
        </motion.div>
      </section>
    </div>
  );
}