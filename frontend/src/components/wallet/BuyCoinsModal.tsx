'use client';
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import { getCoinPackages } from '@/lib/walletApi';
import { useWalletDialog } from './useWalletDialog';

interface BuyCoinsModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (coins: number) => void;
}
type CoinPackage = { id: string; coins: number; price: number };
export default function BuyCoinsModal({ open, onClose }: BuyCoinsModalProps) {
  const dialogRef = useWalletDialog<HTMLElement>(open, onClose);
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [gift, setGift] = useState(false);
  const [recipient, setRecipient] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(false); setPackages([]); setSelected(''); setGift(false); setRecipient('');
    getCoinPackages().then(data => {
      if (!active) return;
      if (!Array.isArray(data?.packages)) throw new Error('Invalid catalog');
      const list: CoinPackage[] = data.packages.filter((p: CoinPackage) => p && typeof p.id === 'string' && Number.isSafeInteger(p.coins) && p.coins > 0 && Number.isFinite(p.price) && p.price > 0);
      setPackages(list);
      if (!list.length) setError(true);
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);
  const pack = packages.find(p => p.id === selected);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/75 p-4" role="presentation" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="coin-shop-title" ref={dialogRef} tabIndex={-1} className="vanta-wallet-ui w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--text-primary)]" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 id="coin-shop-title" className="flex items-center gap-2 text-lg font-bold"><VantaCoinIcon size={26} decorative /> VANTA Coins</h2><button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center"><X size={18}/></button></div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={!gift} onClick={() => setGift(false)} className={'rounded-lg border p-3 ' + (!gift ? 'border-[var(--vanta-gold)]' : 'border-[var(--border)]')}>For myself</button>
          <button type="button" aria-pressed={gift} onClick={() => setGift(true)} className={'rounded-lg border p-3 ' + (gift ? 'border-[var(--vanta-gold)]' : 'border-[var(--border)]')}>Gift</button>
        </div>
        {gift && <label className="mt-3 block text-sm">Recipient username (preview only)<input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="@username" maxLength={30} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)] p-3"/></label>}
        <h3 className="mt-5 mb-2 font-semibold">Choose a coin package</h3>
        {loading && <p role="status">Loading packages…</p>}
        {error && <p role="alert">Coin catalog unavailable. Close and reopen to retry.</p>}
        <div className="grid grid-cols-2 gap-2">
          {packages.map(p => <button key={p.id} type="button" aria-pressed={selected === p.id} onClick={() => setSelected(p.id)} className={'rounded-xl border p-3 text-left ' + (selected === p.id ? 'border-[var(--vanta-gold)]' : 'border-[var(--border)]')}><span className="flex items-center gap-1 font-semibold"><VantaCoinIcon size={18} decorative/>{p.coins.toLocaleString()}</span><span className="mt-1 block text-sm text-[var(--text-secondary)]">USD {p.price.toFixed(2)}</span></button>)}
        </div>
        {pack && <div className="mt-4 rounded-lg border border-[var(--border)] p-3 text-sm"><p>Coins: {pack.coins.toLocaleString()}</p><p>Total: USD {pack.price.toFixed(2)}</p><p>Recipient: {gift ? recipient || 'Not selected' : 'My account'}</p></div>}
        <p role="status" className="mt-4 text-xs text-[var(--text-secondary)]">Shop preview · no payments or coin credits are processed here.</p>
        <button type="button" disabled className="mt-3 w-full rounded-xl bg-[var(--vanta-gold)] p-3 font-semibold text-black opacity-50">Pay{pack ? ' USD ' + pack.price.toFixed(2) : ''}</button>
      </section>
    </div>
  );
}
