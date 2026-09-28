'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Copy, Check, ExternalLink, Loader2, Clock, Shield, AlertCircle, Wallet, Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import UsdtIcon from '@/components/ui/UsdtIcon';
import UsdcIcon from '@/components/ui/UsdcIcon';
import {
  initializeVerificationPurchase,
  verifyVerificationPurchase,
  getVerificationPurchases,
  type BadgePurchasePlan,
  type VerificationPurchaseInit,
} from '@/lib/verificationApi';

interface NetworkOption {
  id: string;
  name: string;
  token: string;
  network: string;
  iconComponent: React.ReactNode;
  estimatedTime: string;
}

const PAYMENT_NETWORKS: NetworkOption[] = [
  {
    id: 'usdt-bep20',
    name: 'USDT',
    token: 'USDT',
    network: 'BNB Smart Chain (BEP-20)',
    iconComponent: <UsdtIcon size={20} />,
    estimatedTime: '1-3 minutes',
  },
  {
    id: 'usdc-base',
    name: 'USDC',
    token: 'USDC',
    network: 'Base Network',
    iconComponent: <UsdcIcon size={20} />,
    estimatedTime: '1-3 minutes',
  },
];

interface Props {
  open: boolean;
  plan: BadgePurchasePlan | null;
  onClose: () => void;
  onSuccess?: () => void;
}

type Step = 'network' | 'payment' | 'confirming' | 'success' | 'error';

export default function VerificationPurchaseModal({ open, plan, onClose, onSuccess }: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<Step>('network');
  const [network, setNetwork] = useState<NetworkOption | null>(null);
  const [session, setSession] = useState<VerificationPurchaseInit | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('network');
    setNetwork(null);
    setSession(null);
    setError(null);
    setConfirming(false);
    setCopied(false);
  }, [open, plan?.id]);

  const startPurchase = async () => {
    if (!token || !plan || !network) return;
    setError(null);
    setConfirming(true);
    try {
      const sessionData = await initializeVerificationPurchase(token, {
        planId: plan.id,
        network: network.id,
      });
      setSession(sessionData);
      setStep('payment');
    } catch (err: any) {
      setError(err.message || 'Failed to start purchase');
      setStep('error');
    } finally {
      setConfirming(false);
    }
  };

  const copyAddress = () => {
    if (!session) return;
    navigator.clipboard.writeText(session.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
const pollForCompletion = useCallback(async (orderId: string, attempts = 0) => {
    if (!token || attempts > 100) {
      setError('Payment is still being verified. Please check your purchase history shortly.');
      setStep('error');
      return;
    }
    try {
      const data = await getVerificationPurchases(token);
      const updated = data.purchases?.find((p) => p.id === orderId);
      if (updated?.status === 'COMPLETED') {
        setStep('success');
        onSuccess?.();
        return;
      }
      if (updated?.status === 'EXPIRED' || updated?.status === 'FAILED' || updated?.status === 'CANCELLED' || updated?.status === 'REFUNDED') {
        setError(`Purchase ${updated.status.toLowerCase()}. Please start a new purchase if you still want to upgrade.`);
        setStep('error');
        return;
      }
      setTimeout(() => pollForCompletion(orderId, attempts + 1), 3000);
    } catch {
      setTimeout(() => pollForCompletion(orderId, attempts + 1), 3000);
    }
  }, [token, onSuccess]);

  const handleConfirm = async () => {
    if (!token || !session) return;
    setConfirming(true);
    setError(null);
    try {
      if (session.mode === 'test') {
        const result = await verifyVerificationPurchase(token, {
          orderId: session.orderId,
          testConfirmation: true,
          simulateToken: session.simulateToken,
        });
        if (result?.success) {
          setStep('success');
          onSuccess?.();
        } else {
          setError('Simulated payment could not be verified. Please try again.');
          setStep('error');
        }
      } else {
        // Live mode: the entitlement only activates after the provider webhook
        // verifies the payment server-side. We poll the order status.
        await verifyVerificationPurchase(token, { orderId: session.orderId });
        setStep('confirming');
        pollForCompletion(session.orderId);
      }
    } catch (err: any) {
      setError(err.message || 'Payment could not be verified');
      setStep('error');
    } finally {
      setConfirming(false);
    }
  };

  if (!open || !plan) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.22 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/[0.08] bg-[#101012] shadow-2xl"
        >
          <div className={cn('h-1.5 w-full', plan.badgeType === 'BLUE' ? 'bg-gradient-to-r from-sky-500 to-blue-600' : 'bg-gradient-to-r from-amber-400 to-yellow-600')} />

          <div className="flex items-start justify-between px-6 pt-5">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-xl',
                  plan.badgeType === 'BLUE' ? 'bg-sky-500/15 text-sky-400' : 'bg-amber-500/15 text-amber-400',
                )}
              >
                <Crown size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-white">{plan.name}</p>
                <p className="text-xs text-gray-400">
                  ${plan.priceUSD.toFixed(2)} · {plan.durationLabel}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-white/10 hover:text-white transition-colors" aria-label="Close">
              <X size={18} />
            </button>
          </div>
<div className="px-6 py-5">
            {step === 'network' && (
              <>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Choose payment network</p>
                <div className="space-y-2">
                  {PAYMENT_NETWORKS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setNetwork(opt)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all',
                        network?.id === opt.id
                          ? 'border-white/30 bg-white/[0.07]'
                          : 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06]',
                      )}
                    >
                      {opt.iconComponent}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-white">{opt.name}</span>
                        <span className="block truncate text-xs text-gray-400">{opt.network}</span>
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-gray-400">
                        <Clock size={11} /> {opt.estimatedTime}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <button onClick={onClose} className="rounded-xl bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-white/[0.1]">Cancel</button>
                  <button
                    onClick={startPurchase}
                    disabled={!network || confirming}
                    className={cn(
                      'rounded-xl px-4 py-2.5 text-sm font-bold transition-all',
                      network
                        ? plan.badgeType === 'BLUE'
                          ? 'bg-sky-500 text-white hover:bg-sky-400'
                          : 'bg-[var(--vanta-gold)] text-black hover:brightness-110'
                        : 'bg-white/[0.05] text-gray-500',
                    )}
                  >
                    {confirming ? <Loader2 size={15} className="inline animate-spin" /> : 'Continue'}
                  </button>
                </div>
              </>
            )}
{step === 'payment' && session && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Amount due</span>
                    <span className="text-sm font-bold text-white">
                      {session.amount.toFixed(2)} <span className="text-amber-300">{network?.token || 'USDT'}</span>
                    </span>
                  </div>
                </div>

                {session.mode === 'test' ? (
                  <div className="flex items-start gap-2 rounded-2xl border border-sky-400/20 bg-sky-500/10 p-3 text-xs text-sky-200">
                    <Shield size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Sandbox payment (no real funds). Completing this simulated payment verifies the full purchase flow
                      and activates your Verified Badge.
                    </span>
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="mb-1.5 text-xs text-gray-400">Send exactly: {session.amount.toFixed(2)} {network?.token} to</p>
                      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/40 p-3">
                        <Wallet size={16} className="shrink-0 text-gray-500" />
                        <code className="min-w-0 flex-1 truncate text-[11px] text-white/90">{session.address}</code>
                        <button onClick={copyAddress} className="shrink-0 rounded-lg bg-white/[0.06] p-1.5 text-gray-300 hover:text-white" aria-label="Copy address">
                          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
                        <AlertCircle size={12} /> After sending, the badge activates automatically once the provider confirms the payment server-side.
                      </p>
                    </div>
                    <a
                      href={`https://${network?.id === 'usdc-base' ? 'basescan.org' : 'bscscan.com'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-[#c8c8cc] hover:text-white transition-colors"
                    >
                      <ExternalLink size={12} /> Open block explorer
                    </a>
                  </>
                )}

                {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => setStep('network')}
                    disabled={confirming}
                    className="flex-1 rounded-2xl border border-white/[0.06] bg-white/[0.04] py-2.5 text-sm font-medium text-gray-300 hover:bg-white/[0.08]"
                  >
                    Back
                  </button>
                  <motion.button
                    onClick={handleConfirm}
                    disabled={confirming}
                    whileTap={{ scale: 0.97 }}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-bold transition-all',
                      session.mode === 'test'
                        ? plan.badgeType === 'BLUE'
                          ? 'bg-sky-500 text-white hover:bg-sky-400'
                          : 'bg-[var(--vanta-gold)] text-black'
                        : 'bg-white/[0.05] text-gray-500',
                    )}
                  >
                    {confirming ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {session.mode === 'test' ? 'Simulate Successful Payment' : 'I Have Sent the Payment'}
                  </motion.button>
                </div>
              </div>
            )}
{step === 'confirming' && (
              <div className="py-8 text-center">
                <Loader2 size={32} className="mx-auto mb-3 animate-spin text-[var(--vanta-gold)]" />
                <p className="text-sm font-semibold text-white">Verifying your payment…</p>
                <p className="mt-1 text-xs text-gray-400">
                  Activating your {plan.badgeType} Verified badge. This usually takes a minute.
                </p>
              </div>
            )}

            {step === 'success' && (
              <div className="py-8 text-center">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                  className={cn(
                    'mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full',
                    plan.badgeType === 'BLUE' ? 'bg-sky-500/20' : 'bg-amber-500/20',
                  )}
                >
                  <Check size={30} className={plan.badgeType === 'BLUE' ? 'text-sky-400' : 'text-amber-400'} />
                </motion.div>
                <p className="text-lg font-bold text-white">You&apos;re Verified!</p>
                <p className="mt-1 text-sm text-gray-400">
                  Your {plan.badgeType} Verified badge is now active across VANTA.
                </p>
                <button
                  onClick={onClose}
                  className="mt-6 w-full rounded-2xl bg-white/[0.06] py-2.5 text-sm font-bold text-white hover:bg-white/[0.1]"
                >
                  Done
                </button>
              </div>
            )}

            {step === 'error' && (
              <div className="py-8 text-center">
                <AlertCircle size={30} className="mx-auto mb-3 text-red-400" />
                <p className="text-sm font-semibold text-white">Payment could not be completed</p>
                <p className="mt-1 text-xs text-gray-400">{error}</p>
                <button
                  onClick={onClose}
                  className="mt-6 w-full rounded-2xl bg-white/[0.06] py-2.5 text-sm font-bold text-white hover:bg-white/[0.1]"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}