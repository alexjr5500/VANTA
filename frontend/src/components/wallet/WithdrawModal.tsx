'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Check, AlertCircle, ArrowUpFromLine, Shield, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/apiClient';
import { useWalletDialog } from './useWalletDialog';
import { readWalletReceipt, downloadWalletReceipt, type WalletReceipt } from '@/lib/walletReceipt';

interface WithdrawModalProps {
  open: boolean;
  balance: number;
  hideBalance?: boolean;
  walletAddress?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function WithdrawModal({ open, balance, hideBalance = false, walletAddress, onClose, onSuccess }: WithdrawModalProps) {
  const { token } = useAuth();
  const [step, setStep] = useState<'form' | 'review' | 'processing' | 'success'>('form');
  const [amount, setAmount] = useState<number>(0);
  const [address, setAddress] = useState(walletAddress || '');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<WalletReceipt | null>(null);
  const [pinCode, setPinCode] = useState('');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const submitLock = useRef(false);
  const dialogRef = useWalletDialog<HTMLDivElement>(open, onClose, sending || step === 'processing' || step === 'success', step);
  const fee = amount > 0 ? Math.round(amount * 0.10 * 100) / 100 : 0;
  const netAmount = amount > 0 ? Math.round((amount - fee) * 100) / 100 : 0;

  useEffect(() => {
    if (!open || !token) return;
    let current = true;
    setTwoFactorEnabled(null);
    apiGet<{ enabled: boolean }>('/api/auth/2fa/status', token, { skipCache: true })
      .then(status => { if (current) setTwoFactorEnabled(typeof status?.enabled === 'boolean' ? status.enabled : true); })
      .catch(() => { if (current) setTwoFactorEnabled(true); });
    return () => { current = false; };
  }, [open, token]);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setStep('form');
      setSending(false);
      setReceipt(null);
      submitLock.current = false;
      setAmount(0);
      setAddress(walletAddress || '');
      setError('');
      setPinCode('');
      setTwoFactorCode('');
    }
  }, [open, walletAddress]);

  const handleNext = () => {
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter a valid amount'); return; }
    if (!Number.isSafeInteger(Math.round(amount * 100)) || Number(amount.toFixed(2)) !== amount) { setError('Enter an amount with at most two decimal places.'); return; }
    if (amount < 10) { setError('Minimum withdrawal amount is $10.00'); return; }
    if (amount > balance) { setError(`Insufficient balance. You have $${balance.toFixed(2)} available.`); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(address.trim()) || /^0x0{40}$/.test(address.trim())) { setError('Enter a valid USDT (BEP-20) wallet address'); return; }
    setError('');
    setStep('review');
  };

  const handleWithdraw = async () => {
    if (!token || sending || submitLock.current || twoFactorEnabled === null) return;
    if (!/^\d{4,6}$/.test(pinCode)) { setError('Enter your 4-6 digit wallet PIN.'); return; }
    if (twoFactorEnabled && !twoFactorCode.trim()) { setError('Enter your authenticator or backup code.'); return; }
    submitLock.current = true;
    setSending(true);
    setError('');
    setStep('processing');

    try {
      const result = await apiPost<{withdrawal?:unknown}>('/api/wallets/withdraw', {
        amount,
        walletAddress: address.trim(),
        pinCode,
        twoFactorCode: twoFactorEnabled ? twoFactorCode : undefined,
      }, token);
      const confirmed = readWalletReceipt(result?.withdrawal);
      if (!confirmed) { setError('The request outcome could not be confirmed. Close and check withdrawal history before retrying.'); setStep('review'); setSending(false); return; }
      setReceipt(confirmed);
      setPinCode('');
      setTwoFactorCode('');
      setStep('success');
    } catch (err: any) {
      setError(err.message || 'Withdrawal failed. Please try again.');
      setStep('review');
      setSending(false);
    } finally { submitLock.current = false; }
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
            onClick={() => !sending && step !== 'processing' && step !== 'success' && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 30 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="vanta-wallet-ui fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] bottom-[max(12px,env(safe-area-inset-bottom))] z-[101] mx-auto flex min-h-0 w-[calc(100%-1.5rem)] max-w-[456px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[var(--background-secondary)] shadow-2xl backdrop-blur-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Withdraw earnings"
            ref={dialogRef}
            tabIndex={-1}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 sm:px-6 border-b border-white/[0.06] shrink-0">
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
              <button onClick={() => !sending && step !== 'processing' && step !== 'success' && onClose()} className="rounded-xl p-2 text-[var(--text-secondary)] hover:text-white hover:bg-white/[0.05] transition" aria-label="Close" disabled={sending || step === 'processing' || step === 'success'}>
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto scrollbar-hide p-4 sm:p-6">
              {/* Balance */}
              <div className="mb-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Available balance</span>
                <span className="text-sm font-bold text-[var(--text-primary)]">{hideBalance ? '••••••' : '$' + balance.toFixed(2)}</span>
              </div>

              {error && (
                <div role="alert" className="mb-4 flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <AlertCircle size={14} className="shrink-0" />
                  {error}
                </div>
              )}

              {/* Step 1: Form */}
              {step === 'form' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="wallet-withdraw-amount" className="text-sm font-medium text-[var(--text-secondary)] mb-1.5 block">Withdrawal Amount (USD)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-[var(--text-secondary)]">$</span>
                      <input
                        id="wallet-withdraw-amount"
                        type="number" inputMode="decimal" min={10} step="0.01"
                        value={amount || ''}
                        onChange={e => setAmount(Math.min(Math.max(0, parseFloat(e.target.value) || 0), balance))}
                        placeholder="0.00"
                                                className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] pl-9 pr-4 py-3.5 text-xl font-bold text-[var(--text-primary)] placeholder-[#8A8A8A] outline-none focus:border-[var(--vanta-gold)] transition-all"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {[25, 50, 100, 250, 500].filter(v => v <= balance).map(p => (
                        <button
                          key={p}
                          onClick={() => setAmount(p)}
                          className={cn(
                            'min-h-11 px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                            amount === p ? 'border-[var(--active-border)] bg-[var(--active-soft)] text-[var(--vanta-gold-bright)]' : 'border-white/[0.06] text-[var(--text-secondary)] hover:text-white'
                          )}
                        >
                          ${p}
                        </button>
                      ))}
                      {balance > 500 && (
                        <button
                          onClick={() => setAmount(balance)}
                          className="min-h-11 px-3 py-2 rounded-lg text-xs font-medium transition-all border border-white/[0.06] text-[var(--text-secondary)] hover:text-white"
                        >
                          Max
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="wallet-withdraw-address" className="text-sm font-medium text-[var(--text-secondary)] mb-1.5 block">USDT (BEP-20) Wallet Address</label>
                    <input
                      id="wallet-withdraw-address"
                      type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      placeholder="0x..."
                      className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[#8A8A8A] font-mono outline-none focus:border-[var(--vanta-gold)] transition-all"
                    />
                  </div>

                  <p className="text-xs leading-5 text-[var(--text-secondary)]">Minimum withdrawal: $10. Only use a USDT address on BNB Smart Chain (BEP-20). Verify the full destination address before confirming.</p>
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
                  <button type="button" onClick={() => { setStep('form'); setError(''); setPinCode(''); setTwoFactorCode(''); }} className="min-h-11 text-sm font-semibold text-[var(--vanta-gold-bright)]">Edit withdrawal</button>
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
                      <span className="font-medium text-[var(--text-primary)] font-mono text-xs break-all max-w-[65%] text-right">{address}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="withdraw-wallet-pin" className="block text-xs font-medium text-[var(--text-secondary)]">Wallet PIN</label>
                    <input id="withdraw-wallet-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                      value={pinCode} onChange={e => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Enter your 4-6 digit PIN" aria-label="Wallet PIN"
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm tracking-[0.3em] text-[var(--text-primary)] placeholder:tracking-normal placeholder:text-[var(--text-secondary)] outline-none focus:border-[var(--vanta-gold)]" />
                  </div>

                  {twoFactorEnabled === null && <p role="status" className="text-sm text-[var(--text-secondary)]">Checking account security…</p>}
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
                    disabled={sending || twoFactorEnabled === null || (twoFactorEnabled && !twoFactorCode.trim())}
                    className="w-full py-3 rounded-2xl bg-[var(--vanta-gold)] text-black text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Confirm withdrawal request'}
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
                    Your request for USDT {(receipt?.netAmount ?? netAmount).toFixed(2)} was recorded. Settlement is subject to review and verification.
                  </motion.p>
                {receipt && <div className="mt-4 w-full space-y-2 rounded-xl bg-[var(--surface)] p-3 text-sm"><p>Reference: <span className="break-all font-mono text-xs">{receipt.id}</span></p><p>Status: {receipt.status}</p><button type="button" onClick={()=>downloadWalletReceipt('withdrawal',receipt)} className="min-h-11 w-full rounded-lg border border-[var(--border)] text-[var(--vanta-gold-bright)]">Download withdrawal record</button></div>}
                <button type="button" onClick={() => { onClose(); onSuccess(); }} className="mt-5 min-h-11 w-full rounded-xl bg-[var(--vanta-gold)] px-4 font-semibold text-black">Done</button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}