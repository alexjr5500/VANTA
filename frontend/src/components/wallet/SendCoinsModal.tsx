'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Loader2, Check, AlertCircle, User, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/apiClient';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import VerificationBadge from '@/components/ui/VerificationBadge';
import type { VerificationType } from '@/types/verification';

interface UserResult {
  id: string;
  username: string;
  fullName?: string;
  avatar?: string;
  verified?: boolean;
  verificationType?: VerificationType | null;
}

interface SendCoinsModalProps {
  open: boolean;
  balance: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SendCoinsModal({ open, balance, onClose, onSuccess }: SendCoinsModalProps) {
  const { token, user } = useAuth();
  const [step, setStep] = useState<'recipient' | 'amount' | 'review' | 'otp' | 'processing' | 'success'>('recipient');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [requestId, setRequestId] = useState('');
  const [resending, setResending] = useState(false);
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  const fee = amount > 0 ? Math.ceil(amount * 0.05) : 0;
  const totalDeduction = amount + fee;

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setStep('recipient');
      setSearchQuery('');
      setSearchResults([]);
      setSelectedUser(null);
      setAmount(0);
      setNote('');
      setError('');
      setChallengeId('');
      setOtpCode('');
      setPinCode('');
      setRequiresTwoFactor(false);
      setTwoFactorCode('');
      setRequestId('');
      setSending(false);
      setResending(false);
    }
  }, [open]);

  // Normalize @username searches and ignore stale responses from earlier queries.
  const recipientQuery = searchQuery.trim().replace(/^@+/, '');
  useEffect(() => {
    let current = true;
    setSearchResults([]);
    if (!open || step !== 'recipient' || recipientQuery.length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await apiGet<any>(`/api/wallets/users/search?q=${encodeURIComponent(recipientQuery)}`, token || undefined);
        if (current) setSearchResults(Array.isArray(data) ? data : data?.users ?? []);
      } catch {
        if (current) setSearchResults([]);
      } finally {
        if (current) setSearching(false);
      }
    }, 300);
    return () => { current = false; if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [recipientQuery, step, open, token]);

  const handleSelectUser = (u: UserResult) => {
    setSelectedUser(u);
    setStep('amount');
  };

  const handleAmountNext = () => {
    if (amount <= 0) { setError('Enter an amount'); return; }
    if (totalDeduction > balance) { setError(`Insufficient balance. You need ${totalDeduction.toLocaleString()} VANTA including the fee.`); return; }
    setError('');
    setStep('review');
  };

  const handleSend = async () => {
    if (!token || !selectedUser || sending) return;
    if (!/^\d{4,6}$/.test(pinCode)) { setError('Enter your 4-6 digit wallet PIN.'); return; }
    setSending(true);
    setError('');
    setStep('processing');
    const intentRequestId = requestId || (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (!requestId) setRequestId(intentRequestId);

    try {
      const result = await apiPost<any>('/api/wallets/transfer', {
        receiverId: selectedUser.id,
        amount,
        note: note || undefined,
        pinCode,
        requestId: intentRequestId,
      }, token);
      if (result?.requiresOTP) {
        setChallengeId(String(result.challengeId || ''));
        setRequiresTwoFactor(result.requiresTwoFactor === true);
        setTwoFactorCode('');
        setOtpCode('');
        setStep('otp');
        setSending(false);
        return;
      }
      setStep('success');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to send VANTA');
      setStep('review');
      setSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!token || !selectedUser || !challengeId || !/^\d{6}$/.test(otpCode) || sending) return;
    setSending(true);
    setError('');
    setStep('processing');
    try {
      const result = await apiPost<any>('/api/wallets/transfer', {
        receiverId: selectedUser.id,
        amount,
        note: note || undefined,
        otpCode,
        pinCode,
        twoFactorCode: requiresTwoFactor ? twoFactorCode : undefined,
        challengeId,
        requestId,
      }, token);
      if (result?.requiresOTP || !result?.transfer) {
        throw new Error('The transfer was not confirmed by the server. Please try again.');
      }
      setStep('success');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'The code is invalid or expired. Check it and try again.');
      setStep('otp');
      setSending(false);
    }
  };

  const handleResendOtp = async () => {
    if (!token || !selectedUser || resending || sending) return;
    setResending(true);
    setError('');
    try {
      const result = await apiPost<any>('/api/wallets/transfer', {
        receiverId: selectedUser.id,
        amount,
        note: note || undefined,
        pinCode,
        requestId,
      }, token);
      if (!result?.requiresOTP || !result?.challengeId) {
        throw new Error('A new verification code could not be requested. Please try again shortly.');
      }
      setChallengeId(String(result.challengeId));
      setOtpCode('');
      setError('A new verification code has been sent to your verified email address.');
    } catch (err: any) {
      setError(err.message || 'Unable to resend the code. Please wait and try again.');
    } finally {
      setResending(false);
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
            aria-label="Send VANTA"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center">
                  <VantaCoinIcon size={18} className="text-[var(--vanta-gold-bright)]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Send VANTA</h2>
                  <p className="text-[10px] text-[var(--text-secondary)]">
                    {step === 'recipient' && 'Who would you like to send to?'}
                    {step === 'amount' && 'How much VANTA?'}
                    {step === 'review' && 'Review and confirm your transfer'}
                    {step === 'otp' && 'Verify this transfer'}
                    {step === 'processing' && 'Processing transfer'}
                    {step === 'success' && 'Transfer complete'}
                  </p>
                </div>
              </div>
              <button onClick={() => step !== 'processing' && onClose()} className="rounded-xl p-2 text-gray-400 hover:text-white hover:bg-white/[0.05] transition" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto scrollbar-hide p-6">
              {/* Balance */}
              <div className="mb-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Your balance</span>
                <span className="text-sm font-bold text-white">{balance.toLocaleString()} <VantaCoinIcon size={14} className="inline-block text-[var(--vanta-gold-bright)]" /></span>
              </div>

              {error && (
                <div className="mb-4 flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <AlertCircle size={14} className="shrink-0" />
                  {error}
                </div>
              )}

              {/* Step 1: Select Recipient */}
              {step === 'recipient' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">Search users</label>
                    <div className="relative">
                      <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search by username or display name..."
                        autoFocus
                        className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-10 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all"
                      />
                    </div>
                  </div>

                  {searching && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={20} className="animate-spin text-[var(--text-secondary)]" />
                    </div>
                  )}

                  {!searching && recipientQuery.length >= 2 && searchResults.length > 0 && (
                    <div className="space-y-2">
                      {searchResults.map((u, i) => (
                        <motion.button
                          key={u.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                          onClick={() => handleSelectUser(u)}
                          disabled={u.id === user?.id}
                          className={cn(
                            'w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all text-left',
                            u.id === user?.id
                              ? 'border-white/[0.04] opacity-40 cursor-not-allowed'
                              : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12]'
                          )}
                        >
                          <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center overflow-hidden shrink-0">
                            {u.avatar ? (
                              <img src={resolveMediaUrl(u.avatar)} alt={u.username} className="w-full h-full object-cover" />
                            ) : (
                              <User size={16} className="text-white/60" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {u.fullName || u.username}
                              {u.verified && u.verificationType && <VerificationBadge verified type={u.verificationType} size="xs" className="ml-1" />}
                            </p>
                            <p className="text-[10px] text-[var(--text-secondary)]">@{u.username}</p>
                          </div>
                          <ArrowRight size={14} className="text-white/20" />
                        </motion.button>
                      ))}
                    </div>
                  )}

                  {!searching && recipientQuery.length >= 2 && searchResults.length === 0 && (
                    <div className="text-center py-8 text-sm text-white/30">No users found</div>
                  )}
                </div>
              )}

              {/* Step 2: Amount */}
              {step === 'amount' && selectedUser && (
                <div className="space-y-4">
                  {/* Selected recipient */}
                  <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center overflow-hidden shrink-0">
                      {selectedUser.avatar ? (
                        <img src={resolveMediaUrl(selectedUser.avatar)} alt={selectedUser.username} className="w-full h-full object-cover" />
                      ) : (
                        <User size={16} className="text-white/60" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{selectedUser.fullName || selectedUser.username}</p>
                      <p className="text-[10px] text-[var(--text-secondary)]">@{selectedUser.username}</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">Amount</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={amount || ''}
                        onChange={e => setAmount(Math.min(Math.max(0, parseInt(e.target.value) || 0), balance))}
                        placeholder="0"
                        autoFocus
                        className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3.5 text-xl font-bold text-white placeholder-gray-600 outline-none focus:border-[var(--vanta-gold)] transition-all"
                      />
                      <VantaCoinIcon size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--vanta-gold-bright)]" />
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      {[10, 50, 100, 500, 1000, 5000, 10000].map(p => (
                        <button
                          key={p}
                          onClick={() => setAmount(Math.min(p, balance))}
                          disabled={p > balance}
                          className={cn(
                            'min-h-9 rounded-lg text-xs font-medium transition-all border disabled:opacity-30 disabled:cursor-not-allowed',
                            amount === p ? 'border-white/30 bg-white/10 text-white' : 'border-white/[0.06] text-[var(--text-secondary)] hover:text-white'
                          )}
                        >
                          {p >= 1000 ? `${p / 1000}K` : p}
                        </button>
                      ))}
                      <button
                        onClick={() => setAmount(balance)}
                        className="min-h-9 rounded-lg border border-white/[0.06] text-xs font-medium text-[var(--text-secondary)] transition-all hover:text-white"
                      >
                        Max
                      </button>
                    </div>

                  </div>

                  <div>
                    <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">Note (optional)</label>
                    <input
                      type="text"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="e.g. Thanks for the content!"
                      className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-[var(--vanta-gold)] transition-all"
                    />
                  </div>

                  {/* Fee breakdown */}
                  {amount > 0 && (
                    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">Amount</span>
                        <span className="text-white font-medium">{amount.toLocaleString()} VANTA</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-secondary)]">Network fee (5%)</span>
                        <span className="text-white/60">{fee.toLocaleString()} VANTA</span>
                      </div>
                      <div className="flex items-center justify-between text-xs border-t border-white/[0.06] pt-2">
                        <span className="text-[var(--text-secondary)] font-semibold">Total deduction</span>
                        <span className="text-white font-bold">{totalDeduction.toLocaleString()} VANTA</span>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleAmountNext}
                    disabled={amount <= 0}
                    className="w-full py-3 rounded-2xl bg-[var(--vanta-gold)] text-black text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    Continue
                  </button>
                </div>
              )}

              {/* Step 3: Review */}
              {step === 'review' && selectedUser && (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                      <Check size={22} className="text-emerald-400" />
                    </div>
                    <h3 className="text-base font-bold text-white mb-1">Confirm transfer</h3>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Sending {amount.toLocaleString()} <VantaCoinIcon size={12} className="inline-block text-[var(--vanta-gold-bright)]" /> to @{selectedUser.username}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Recipient</span>
                      <span className="font-medium text-white">@{selectedUser.username}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Recipient receives</span>
                      <span className="font-medium text-white">{amount.toLocaleString()} VANTA</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Transfer fee</span>
                      <span className="text-white/60">{fee.toLocaleString()} VANTA</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-xs">
                      <span className="font-semibold text-white/60">Total deduction</span>
                      <span className="font-bold text-white">{totalDeduction.toLocaleString()} VANTA</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="wallet-transfer-pin" className="block text-xs font-medium text-white/60">Wallet PIN</label>
                    <input id="wallet-transfer-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                      value={pinCode} onChange={e => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Enter your 4-6 digit PIN" aria-label="Wallet PIN"
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-[var(--text-secondary)] outline-none focus:border-[var(--vanta-gold)]" />
                  </div>

                  <button
                    onClick={handleSend}
                    disabled={sending}
                    className="w-full py-3 rounded-2xl bg-[var(--vanta-gold)] text-black text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Confirm & Send'}
                  </button>
                </div>
              )}

              {/* Step 4: Email OTP verification */}
              {step === 'otp' && selectedUser && (
                <div className="space-y-5">
                  <div className="text-center">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a45c]/25 bg-[var(--vanta-gold)]/10">
                      <AlertCircle size={23} className="text-[#c9a45c]" />
                    </div>
                    <h3 className="text-base font-bold text-white">Verify your transfer</h3>
                    <p className="mt-2 text-sm leading-6 text-white/55">We sent a six-digit verification code to your verified email address. Enter it to send {amount.toLocaleString()} VANTA Coins to @{selectedUser.username}.</p>
                  </div>
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs"><span className="text-white/45">Recipient</span><span className="font-medium text-white">@{selectedUser.username}</span></div>
                    <div className="flex items-center justify-between text-xs"><span className="text-white/45">Transfer amount</span><span className="font-semibold text-white">{amount.toLocaleString()} VANTA</span></div>
                    <div className="flex items-center justify-between text-xs"><span className="text-white/45">Transfer fee</span><span className="text-white/70">{fee.toLocaleString()} VANTA</span></div>
                    <div className="flex items-center justify-between border-t border-white/[0.07] pt-2 text-xs"><span className="text-white/45">Total deduction</span><span className="font-semibold text-white">{totalDeduction.toLocaleString()} VANTA</span></div>
                  </div>
                  <div>
                    <label htmlFor="vanta-transfer-otp" className="mb-2 block text-xs font-medium text-white/60">6-digit email code</label>
                    <input id="vanta-transfer-otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={e => { if (e.key === 'Enter' && otpCode.length === 6) void handleVerifyOtp(); }} placeholder="000000" aria-describedby="vanta-transfer-otp-help" className="w-full rounded-2xl border border-[#c9a45c]/30 bg-white/[0.04] px-4 py-4 text-center text-2xl font-semibold tracking-[0.5em] text-white placeholder:text-white/20 outline-none focus:border-[#c9a45c]" />
                    <p id="vanta-transfer-otp-help" className="mt-2 text-[11px] text-white/35">The code expires after 10 minutes and can only be used once.</p>
                  </div>
                  {requiresTwoFactor && (
                    <div>
                      <label htmlFor="vanta-transfer-2fa" className="mb-2 block text-xs font-medium text-white/60">Authenticator app code</label>
                      <input id="vanta-transfer-2fa" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
                        value={twoFactorCode} onChange={e => setTwoFactorCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8))}
                        placeholder="6-digit app code or backup code"
                        className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-center text-sm tracking-widest text-white placeholder:tracking-normal placeholder:text-white/30 outline-none focus:border-[var(--vanta-gold)]" />
                    </div>
                  )}
                  <button onClick={handleVerifyOtp} disabled={sending || otpCode.length !== 6 || !challengeId || (requiresTwoFactor && !twoFactorCode)} className="w-full rounded-2xl bg-[var(--vanta-gold)] py-3.5 text-sm font-bold text-black transition disabled:cursor-not-allowed disabled:opacity-45">{sending ? <Loader2 size={15} className="mx-auto animate-spin" /> : 'Verify and Continue'}</button>
                  <button type="button" onClick={handleResendOtp} disabled={resending || sending} className="w-full py-2 text-xs font-semibold text-white/60 transition hover:text-white disabled:opacity-40">{resending ? 'Sending new code…' : 'Resend verification code'}</button>
                </div>
              )}

              {/* Step 5: Processing */}
              {step === 'processing' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    className="w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center mb-4"
                  >
                    <Loader2 size={28} className="text-white/70" />
                  </motion.div>
                  <h3 className="text-lg font-bold text-white mb-2">Sending VANTA</h3>
                  <p className="text-sm text-[var(--text-secondary)] max-w-xs">
                    Your transaction is being processed securely...
                  </p>
                  <div className="mt-6 flex items-center gap-2 text-xs text-white/30">
                    <Sparkles size={12} />
                    Atomic & secure transfer
                  </div>
                </div>
              )}

              {/* Step 5: Success */}
              {step === 'success' && selectedUser && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                    className="w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-4"
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
                    className="text-xl font-bold text-white mb-2"
                  >
                    Transfer Complete!
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="text-sm text-[var(--text-secondary)] max-w-xs"
                  >
                    {amount.toLocaleString()} VANTA sent to @{selectedUser.username}
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