'use client';

import VantaCoinIcon from '@/components/ui/VantaCoinIcon';

import React from 'react';
import { useWalletDialog } from './useWalletDialog';
import { X } from 'lucide-react';

interface BuyCoinsModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (coins: number) => void;
}

export default function BuyCoinsModal({ open, onClose }: BuyCoinsModalProps) {
  const dialogRef = useWalletDialog<HTMLElement>(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/75 p-4" role="presentation" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="coin-maintenance-title"
        ref={dialogRef}
        tabIndex={-1}
        className="vanta-wallet-ui w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><VantaCoinIcon size={24} decorative />VANTA Coins</span>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <h2 id="coin-maintenance-title" className="text-lg font-bold text-[var(--text-primary)]">Coin purchases paused</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          Buying coins is temporarily unavailable. Your existing balance and transaction history are unaffected.
        </p>
        <button type="button" onClick={onClose} className="mt-6 w-full rounded-xl bg-[var(--vanta-gold)] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[var(--vanta-gold-bright)]">
          Got it
        </button>
      </section>
    </div>
  );
}
