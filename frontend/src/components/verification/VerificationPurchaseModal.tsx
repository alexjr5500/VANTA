'use client';
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { BadgePurchasePlan } from '@/lib/verificationApi';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useWalletDialog } from '@/components/wallet/useWalletDialog';

interface Props {
  open: boolean;
  plan: BadgePurchasePlan | null;
  onClose: () => void;
  onSuccess?: () => void;
}
export default function VerificationPurchaseModal({ open, plan, onClose }: Props) {
  const dialogRef = useWalletDialog<HTMLElement>(open, onClose);
  const [gift, setGift] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [renew, setRenew] = useState(false);
  useEffect(() => { if (open) { setGift(false); setRecipient(''); setRenew(false); } }, [open, plan?.id]);
  if (!open || !plan) return null;
  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md" role="presentation" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="badge-shop-title" tabIndex={-1} ref={dialogRef} className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-white/10 bg-[#101820] p-5 text-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 id="badge-shop-title" className="text-lg font-bold">VANTA Verification</h2><button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center"><X size={18}/></button></div>
        <div className="rounded-xl border border-white/10 p-4"><div className="flex items-center gap-2"><VerificationBadge type={plan.badgeType} size="md"/><h3 className="font-semibold">{plan.name}</h3></div><p className="mt-2 text-2xl font-bold">USD {plan.priceUSD.toFixed(2)}</p><p className="text-sm text-white/60">{plan.durationLabel} · USD {(plan.priceUSD / plan.durationMonths).toFixed(2)} / month</p><ul className="mt-3 space-y-1 text-sm text-white/80">{plan.benefits.map(b => <li key={b}>✓ {b}</li>)}</ul></div>
        <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" aria-pressed={!gift} onClick={() => setGift(false)} className={'rounded-lg border p-3 ' + (!gift ? 'border-blue-400' : 'border-white/10')}>For myself</button><button type="button" aria-pressed={gift} onClick={() => { setGift(true); setRenew(false); }} className={'rounded-lg border p-3 ' + (gift ? 'border-blue-400' : 'border-white/10')}>Gift</button></div>
        {gift && <label className="mt-3 block text-sm">Recipient username (preview only)<input value={recipient} onChange={e => setRecipient(e.target.value)} maxLength={30} placeholder="@username" className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 p-3"/></label>}
        <label className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-white/10 p-3 text-sm"><span>Auto-renew (preview)</span><input type="checkbox" checked={renew} disabled={gift} onChange={e => setRenew(e.target.checked)}/></label>
        <div className="mt-4 rounded-lg border border-white/10 p-3 text-sm"><p>Recipient: {gift ? recipient || 'Not selected' : 'My account'}</p><p>Total: USD {plan.priceUSD.toFixed(2)}</p><p>{renew ? 'Renew every ' + plan.durationLabel : 'One-time purchase'}</p><button type="button" onClick={onClose} className="mt-2 text-blue-300">Change plan</button></div>
        <p role="status" className="mt-4 text-xs text-white/60">Shop preview · no payment, subscription or badge activation is processed here.</p>
        <button type="button" disabled className="mt-3 w-full rounded-xl bg-blue-500 p-3 font-semibold opacity-50">Pay USD {plan.priceUSD.toFixed(2)}</button>
      </section>
    </div>
  );
}
