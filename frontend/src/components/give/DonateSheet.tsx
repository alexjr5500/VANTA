'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, ChevronLeft, Heart, Loader2, Lock, ShieldCheck, Wallet } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { donateToFundraiser } from '@/lib/fundraiserApi';
import { getBalance } from '@/lib/walletApi';
import type { Fundraiser, FundraiserDonationResult } from '@/types/fundraiser';
import { useFundraiserStats, formatCurrencyValue } from './useFundraiserStats';
import VantaVerifiedBadge from './VantaVerifiedBadge';

const PRESETS = [10, 25, 50, 100, 250];
const MIN_COINS = 100; // 1 currency unit minimum
const coinsPerUnit = 100; // matches backend FUNDRAISER_COINS_PER_UNIT

type Step = 'amount' | 'review' | 'processing' | 'success';

interface DonateSheetProps {
  fundraiser: Fundraiser;
  open: boolean;
  onClose: () => void;
  onDonated?: (_result: FundraiserDonationResult) => void;
}

export default function DonateSheet({ fundraiser, open, onClose, onDonated }: DonateSheetProps) {
  const router = useRouter();
  const { token, user } = useAuth();
  const { targetLabel } = useFundraiserStats(fundraiser);

  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState('');
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<FundraiserDonationResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('amount');
    setAmount(0);
    setCustomAmount('');
    setMessage('');
    setAnonymous(false);
    setError('');
    setResult(null);
    if (token) {
      getBalance()
        .then((data: any) => setBalance(Number(data?.coinBalance) || 0))
        .catch(() => setBalance(null));
    }
  }, [open, token]);

  const effectiveAmount = useMemo(() => {
    if (customAmount && Number(customAmount) > 0) return Number(customAmount);
    return amount;
  }, [amount, customAmount]);

  const coinValue = useMemo(() => Math.max(0, Math.floor(effectiveAmount * coinsPerUnit)), [effectiveAmount]);
  const feeCoins = useMemo(() => Math.ceil(Math.max(0, coinValue) * 0.05), [coinValue]);
  // The donor is debited the gross donation value in coins only. The VANTA Give
  // platform fee (5%) is withheld from the organizer's proceeds (see backend
  // wallet.config FUNDRAISER_PLATFORM_FEE_RATE + fundraiser.service donate()).
  const totalCoins = coinValue;
  const isPreset = (value: number) => !customAmount && effectiveAmount === value;

  const minimumLabel = formatCurrencyValue(1, fundraiser.currency);

  const handlePreset = (value: number) => {
    setCustomAmount('');
    setAmount(value);
    setError('');
  };

  const handleCustomChange = (value: string) => {
    setCustomAmount(value.replace(/[^0-9.]/g, ''));
    setAmount(0);
    setError('');
  };

  const validate = (): string => {
    if (!effectiveAmount || effectiveAmount <= 0) return 'Please choose a donation amount.';
    if (coinValue < MIN_COINS) return `The minimum donation is ${minimumLabel}.`;
    if (balance !== null && totalCoins > balance) {
      return `Insufficient VANTA Coins. You need ${totalCoins.toLocaleString()} coins but have ${balance.toLocaleString()}.`;
    }
    return '';
  };

  const handleContinue = () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    setStep('review');
  };

  const handleConfirm = useCallback(async () => {
    if (!token || !effectiveAmount) {
      router.push(`/login?next=${encodeURIComponent(`/give/${fundraiser.slug}`)}`);
      return;
    }
    setStep('processing');
    setError('');
    try {
      const res = await donateToFundraiser(
        fundraiser.id,
        { amount: effectiveAmount, message: message || undefined, anonymous },
        token
      );
      setResult(res);
      setStep('success');
      onDonated?.(res);
    } catch (err: any) {
      setError(err?.message || 'Your donation could not be completed. Please try again.');
      setStep('review');
    }
  }, [token, effectiveAmount, message, anonymous, fundraiser, router, onDonated]);

  const addCoins = () => {
    onClose();
    router.push('/balance');
  };

  const insufficient = balance !== null && totalCoins > balance;

  return (
    <Modal open={open} onClose={onClose} size="md" title="Donate" description={step === 'success' ? undefined : fundraiser.title}>
{/* Step: Success */}
      {step === 'success' && result && (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-[var(--gold-border)] bg-[var(--gold-bg)]">
            <Check size={28} className="text-[var(--vanta-gold-bright)]" strokeWidth={3} />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-white">Donation confirmed</h3>
          <p className="mt-1 text-sm text-white/50">
            You donated <span className="font-semibold text-white">{formatCurrencyValue(result.donation.amount, fundraiser.currency)}</span>{' '}
            to <span className="font-semibold text-white">{fundraiser.title}</span>.
          </p>
          <div className="mt-4 w-full rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-left text-sm">
            <Row label="Donation" value={`${result.coins.toLocaleString()} VANTA Coins`} icon={<VantaCoinIcon size={13} />} />
            <Row label="Platform fee" value={`−${result.feeCoins.toLocaleString()} VANTA Coins`} icon={<VantaCoinIcon size={13} />} muted />
            <Row label="Organizer receives" value={`${result.netCoins.toLocaleString()} VANTA Coins`} icon={<VantaCoinIcon size={13} />} />
          </div>
          <Button variant="gold" className="mt-6 w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      )}

      {/* Step: Amount */}
      {step === 'amount' && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-semibold text-white">{fundraiser.title}</p>
              <p className="mt-0.5 text-xs text-white/40">
                {formatCurrencyValue(fundraiser.raisedAmount, fundraiser.currency)} raised of {targetLabel}
              </p>
            </div>
            {fundraiser.verified && <VantaVerifiedBadge size="sm" />}
          </div>

          <div>
            <p className="form-label">Amount ({fundraiser.currency})</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {PRESETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handlePreset(value)}
                  className={cn(
                    'flex h-11 items-center justify-center rounded-xl border text-sm font-semibold tabular-nums transition',
                    isPreset(value)
                      ? 'border-[var(--gold-border-strong)] bg-[var(--gold-bg)] text-[var(--vanta-gold-bright)]'
                      : 'border-white/[0.08] bg-white/[0.02] text-white/70 hover:bg-white/[0.05] hover:text-white'
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="relative mt-2">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-white/30">{fundraiser.currency} </span>
              <input
                type="text"
                inputMode="decimal"
                value={customAmount}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder={`Custom amount (min ${minimumLabel})`}
                className="form-input pl-[4.5rem]"
              />
            </div>
          </div>
<div>
            <p className="form-label">Message (optional)</p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 280))}
              rows={2}
              placeholder="Leave an encouraging message for the organizer…"
              className="form-textarea"
            />
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <div>
              <p className="text-sm font-medium text-white">Donate anonymously</p>
              <p className="text-xs text-white/40">Your name won&apos;t appear in the supporters list.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={anonymous}
              onClick={() => setAnonymous((v) => !v)}
              className={cn('relative h-6 w-11 shrink-0 rounded-full transition', anonymous ? 'bg-[var(--vanta-gold)]' : 'bg-white/[0.1]')}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                  anonymous ? 'left-[22px]' : 'left-0.5'
                )}
              />
            </button>
          </label>

          {balance !== null && (
            <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
              <span className="flex items-center gap-2 text-xs text-white/50">
                <Wallet size={14} />
                Available balance
              </span>
              <span className="flex items-center gap-1 text-sm font-semibold text-white">
                <VantaCoinIcon size={14} />
                {balance.toLocaleString()} VANTA
              </span>
            </div>
          )}

          {error && (
            <p className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300" role="alert">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </p>
          )}

          {insufficient && !error && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--gold-border)] bg-[var(--gold-bg)] px-3.5 py-3">
              <p className="text-xs text-[var(--vanta-gold-bright)]">
                You need {totalCoins.toLocaleString()} coins. Add coins to your Balance to continue.
              </p>
              <button onClick={addCoins} className="shrink-0 rounded-lg bg-[var(--vanta-gold)] px-3 py-1.5 text-xs font-semibold text-black">
                Add coins
              </button>
            </div>
          )}

          {!user?.username && (
            <p className="flex items-center gap-2 text-xs text-white/40">
              <Lock size={13} />
              You&apos;ll be asked to sign in before confirming.
            </p>
          )}

          <Button variant="gold" fullWidth onClick={handleContinue}>
            Continue
          </Button>
        </div>
      )}
{/* Step: Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <button
            className="flex items-center gap-1 text-xs text-white/45 transition hover:text-white"
            onClick={() => {
              setError('');
              setStep('amount');
            }}
          >
            <ChevronLeft size={14} />
            Edit amount
          </button>

          <div className="space-y-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <Row
              label="Campaign"
              value={
                <span className="line-clamp-1 font-medium text-white">
                  {fundraiser.category?.emoji} {fundraiser.title}
                </span>
              }
            />
            <Row label="Amount" value={formatCurrencyValue(effectiveAmount, fundraiser.currency)} />
            <Row
              label="Covered by"
              value={
                <span className="flex items-center gap-1">
                  <VantaCoinIcon size={13} />
                  {coinValue.toLocaleString()} VANTA Coins
                </span>
              }
            />
            <Row label="VANTA Give fee (5%)" value={`${feeCoins.toLocaleString()} VANTA Coins (from proceeds)`} muted />
            <Row
              label="Total deduction"
              value={<span className="font-semibold text-white">{totalCoins.toLocaleString()} VANTA Coins</span>}
            />
            <div className="divider" />
            <Row
              label="Payment method"
              value={
                <span className="flex items-center gap-1.5 text-white/80">
                  <Wallet size={13} />
                  VANTA Coins
                  <span className="text-white/35">({formatCurrencyValue(totalCoins / coinsPerUnit, fundraiser.currency)})</span>
                </span>
              }
            />
          </div>

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-white/40">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-400/70" />
            Donations are settled in VANTA Coins from your Balance and credited to the organizer&apos;s VANTA Wallet, subject to the
            platform fee and VANTA Give policies.
          </p>

          {error && (
            <p className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300" role="alert">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setStep('amount')}>
              Back
            </Button>
            <Button variant="gold" fullWidth onClick={handleConfirm}>
              <Heart size={15} fill="currentColor" />
              Confirm Donation
            </Button>
          </div>
        </div>
      )}

      {/* Step: Processing */}
      {step === 'processing' && (
        <div className="flex flex-col items-center py-10 text-center">
          <Loader2 size={28} className="animate-spin text-[var(--vanta-gold-bright)]" />
          <p className="mt-4 text-sm text-white/55">Processing your donation…</p>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value, icon, muted }: { label: string; value: React.ReactNode; icon?: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={cn('flex items-center gap-2', muted ? 'text-white/35' : 'text-white/50')}>
        {icon}
        {label}
      </span>
      <span className="min-w-0 text-right">{value}</span>
    </div>
  );
}