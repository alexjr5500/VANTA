'use client';

import VantaCoinIcon from '@/components/ui/VantaCoinIcon';

import React from 'react';
import { useWalletDialog } from './useWalletDialog';
import { X, Clock3, ShieldAlert } from 'lucide-react';

interface BuyCoinsModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (coins: number) => void;
}

export default function BuyCoinsModal({ open, onClose }: BuyCoinsModalProps) {
  const dialogRef = useWalletDialog<HTMLElement>(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md" role="presentation" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="coin-maintenance-title"
        ref={dialogRef}
        tabIndex={-1}
        className="vanta-wallet-ui w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-white/10 bg-[var(--surface)] p-6 text-center shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><VantaCoinIcon size={24} decorative />VANTA Coins</span>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-400/10 text-amber-300">
          <ShieldAlert size={27} />
        </div>
        <h2 id="coin-maintenance-title" className="text-lg font-bold text-[var(--text-primary)]">Purchases Under Maintenance</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">
          Buying VANTA Coins is temporarily unavailable while we prepare a safer payment system. Your existing balance and transaction history are not affected.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <Clock3 size={14} /> Purchases temporarily paused
        </div>
        <button type="button" onClick={onClose} className="mt-6 w-full rounded-xl bg-[var(--vanta-gold)] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[var(--vanta-gold-bright)]">
          Got it
        </button>
      </section>
    </div>
  );
}
