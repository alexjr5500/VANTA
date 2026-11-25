'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Check, AlertCircle, ArrowUpFromLine, Shield, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/apiClient';

interface WithdrawModalProps {
  open: boolean;
  balance: number;
  walletAddress?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function WithdrawModal({ open, balance, walletAddress, onClose, onSuccess }: WithdrawModalProps) {
  const { token } = useAuth();
  const [step, setStep] = useState<'form' | 'review' | 'processing' | 'success'>('form');
  const [amount, setAmount] = useState<number>(0);
  const [address, setAddress] = useState(walletAddress || '');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const fee = amount > 0 ? Math.round(amount * 0.10 * 100) / 100 : 0;
  const netAmount = amount > 0 ? Math.round((amount - fee) * 100) / 100 : 0;

  useEffect(() => {
    if (!open || !token) return;
    apiGet<{ enabled: boolean }>('/api/auth/2fa/status', token)
      .then(status => setTwoFactorEnabled(status?.enabled === true))
      .catch(() => setTwoFactorEnabled(true));
  }, [open, token]);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setStep('form');
      setAmount(0);
      setAddress(walletAddress || '');
      setError('');
      setPinCode('');
      setTwoFactorCode('');
    }
  }, [open, walletAddress]);

  const handleNext = () => {
    if (amount <= 0) { setError('Enter an amount'); return; }
    if (amount < 10) { setError('Minimum withdrawal amount is $10.00'); return; }
    if (amount > balance) { setError(`Insufficient balance. You have $${balance.toFixed(2)} available.`); return; }
    if (!address || address.trim().length < 20) { setError('Enter a valid USDT (BEP-20) wallet address'); return; }
    setError('');
    setStep('review');
  };

  const handleWithdraw = async () => {
    if (!token) return;
    if (!/^\d{4,6}$/.test(pinCode)) { setError('Enter your 4-6 digit wallet PIN.'); return; }
    setSending(true);
    setError('');
    setStep('processing');

    try {
      await apiPost('/api/wallets/withdraw', {
        amount,
        walletAddress: address.trim(),
        pinCode,
        twoFactorCode: twoFactorEnabled ? twoFactorCode : undefined,
      }, token);
      setStep('success');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Withdrawal failed. Please try again.');
      setStep('review');
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md"
            onClick={() => step !== 'processing' && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 30 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] bottom-[max(12px,env(safe-area-inset-bottom))] z-[101] mx-auto flex min-h-0 w-[calc(100%-1.5rem)] max-w-[456px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[var(--background-secondary)] shadow-2xl backdrop-blur-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Withdraw earnings"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                  <ArrowUpFromLine size={16} className="text-[var(--text-primary)]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-primary)]">Withdraw Earnings</h2>
                  <p className="text-[10px] text-[var(--text-secondary)]">
                    {step === 'form' && 'Enter withdrawal details'}
                    {step === 'review' && 'Review and confirm'}
                    {step === 'processing' && 'Processing withdrawal'}
                    {step === 'success' && 'Withdrawal requested'}
                  </p>
                </div>
              </div>
              <button onClick={() => step !== 'processing' && onClose()} className="rounded-xl p-2 text-[var(--text-secondary)] hover:text-white hover:bg-white/[0.05] transition" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto scrollbar-hide p-6">
              {/* Balance */}
              <div className="mb-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Available balance</span>
                <span className="text-sm font-bold text-[var(--text-primary)]">${balance.toFixed(2)}</span>
              </div>

              {error && (
                <div className="mb-4 flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <AlertCircle size={14} className="shrink-0" />
                  {error}
                </div>
              )}

              {/* Step 1: Form */}
              {step === 'form' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">Withdrawal Amount (USD)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-[var(--text-secondary)]">$</span>
                      <input
                        type="number"
                        value={amount || ''}
                        onChange={e => setAmount(Math.min(Math.max(0, parseFloat(e.target.value) || 0), balance))}
                        placeholder="0.00"
                        autoFocus
                        className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] pl-9 pr-4 py-3.5 text-xl font-bold text-[var(--text-primary)] placeholder-[#8A8A8A] outline-none focus:border-[var(--vanta-gold)] transition-all"
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {[25, 50, 100, 250, 500].filter(v => v <= balance).map(p => (
                        <button
                          key={p}
                          onClick={() => setAmount(p)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                            amount === p ? 'border-white/[0.15] bg-white/[0.08] text-white' : 'border-white/[0.06] text-[var(--text-secondary)] hover:text-white'
                          )}
                        >
                          ${p}
                        </button>
                      ))}
                      {balance > 500 && (
                        <button
                          onClick={() => setAmount(balance)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border border-white/[0.06] text-[var(--text-secondary)] hover:text-white"
                        >
                          Max
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">USDT (BEP-20) Wallet Address</label>
                    <input
                      type="text"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      placeholder="0x..."
                      className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[#8A8A8A] font-mono outline-none focus:border-[var(--vanta-gold)] transition-all"
                    />
                  </div>

                  {/* Fee breakdown */}
                  {amount > 0 && (
                    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">Withdrawal amount</span>
                        <span className="text-[var(--text-primary)] font-medium">${amount.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">Platform fee (10%)</span>
                        <span className="text-[var(--text-secondary)]">${fee.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs border-t border-white/[0.06] pt-2">
                        <span className="text-[var(--text-secondary)] font-semibold">Net payout</span>
                        <span className="text-[var(--text-primary)] font-bold">${netAmount.toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleNext}
                    disabled={amount <= 0}
                    className="w-full py-3 rounded-2xl bg-[var(--vanta-gold)] text-black text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    Continue
                  </button>
                </div>
              )}

              {/* Step 2: Review */}
              {step === 'review' && (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mx-auto mb-3">
                      <Check size={22} className="text-[var(--text-primary)]" />
                    </div>
                    <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">Confirm withdrawal</h3>
                    <p className="text-xs text-[var(--text-secondary)]">
                      You will receive ${netAmount.toFixed(2)} USDT
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Amount</span>
                      <span className="font-medium text-[var(--text-primary)]">${amount.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Platform fee (10%)</span>
                      <span className="text-[var(--text-secondary)]">${fee.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-xs">
                      <span className="font-semibold text-[var(--text-secondary)]">Net payout</span>
                      <span className="font-bold text-[var(--text-primary)]">${netAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Method</span>
                      <span className="font-medium text-[var(--text-primary)]">USDT (BEP-20)</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Wallet</span>
                      <span className="font-medium text-[var(--text-primary)] font-mono text-[10px] truncate max-w-[180px]">{address}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="withdraw-wallet-pin" className="block text-xs font-medium text-[var(--text-secondary)]">Wallet PIN</label>
                    <input id="withdraw-wallet-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                      value={pinCode} onChange={e => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Enter your 4-6 digit PIN" aria-label="Wallet PIN"
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm tracking-[0.3em] text-[var(--text-primary)] placeholder:tracking-normal placeholder:text-[var(--text-secondary)] outline-none focus:border-[var(--vanta-gold)]" />
                  </div>

                  {twoFactorEnabled && (
                    <div className="space-y-1.5">
                      <label htmlFor="withdraw-authenticator-code" className="block text-xs font-medium text-[var(--text-secondary)]">Authenticator 2FA code</label>
                      <input id="withdraw-authenticator-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
                        value={twoFactorCode} onChange={e => setTwoFactorCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8))}
                        placeholder="6-digit app code or backup code"
                        className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm tracking-widest text-[var(--text-primary)] placeholder:tracking-normal placeholder:text-[var(--text-secondary)] outline-none focus:border-[var(--vanta-gold)]" />
                    </div>
                  )}

                  <button
                    onClick={handleWithdraw}
                    disabled={sending}
                    className="w-full py-3 rounded-2xl bg-[var(--vanta-gold)] text-black text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Confirm & Withdraw'}
                  </button>
                </div>
              )}

              {/* Step 3: Processing */}
              {step === 'processing' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    className="w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4"
                  >
                    <Loader2 size={28} className="text-[var(--text-primary)]" />
                  </motion.div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">Processing Withdrawal</h3>
                  <p className="text-sm text-[var(--text-secondary)] max-w-xs">
                    Your withdrawal request is being processed securely...
                  </p>
                  <div className="mt-6 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <Shield size={12} />
                    Atomic & secure transaction
                  </div>
                </div>
              )}

              {/* Step 4: Success */}
              {step === 'success' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                    className="w-20 h-20 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4"
                  >
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      <Check size={36} className="text-emerald-400" />
                    </motion.span>
                  </motion.div>
                  <motion.h3
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-xl font-bold text-[var(--text-primary)] mb-2"
                  >
                    Withdrawal Requested!
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="text-sm text-[var(--text-secondary)] max-w-xs"
                  >
                    ${netAmount.toFixed(2)} USDT will be sent to your wallet after review.
                  </motion.p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}